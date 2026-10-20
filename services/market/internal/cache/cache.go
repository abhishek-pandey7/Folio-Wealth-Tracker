// Package cache is a small generic read-through cache built for rate-limited
// upstream APIs. It provides three guarantees:
//
//   - Fresh entries (younger than TTL) are served without calling upstream.
//   - Concurrent misses for the same key share a single upstream call (singleflight).
//   - When upstream fails, an expired entry still inside its stale window is served
//     instead of an error (stale-if-error), and the caller is told it is stale.
package cache

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"
)

type Options struct {
	// TTL is how long an entry is served without asking upstream again.
	TTL time.Duration
	// StaleFor is how long past TTL an entry may still be served if upstream is failing.
	StaleFor time.Duration
	// MaxEntries bounds memory; 0 means unbounded.
	MaxEntries int
}

type Stats struct {
	Size        int    `json:"size"`
	Hits        uint64 `json:"hits"`
	Misses      uint64 `json:"misses"`
	StaleServed uint64 `json:"staleServed"`
	LoadErrors  uint64 `json:"loadErrors"`
	// Revalidated counts expired entries served at once while refreshing in the background.
	Revalidated uint64 `json:"revalidated"`
}

type entry[V any] struct {
	value     V
	fetchedAt time.Time
}

type Cache[V any] struct {
	opts Options

	mu      sync.Mutex
	entries map[string]entry[V]
	group   singleflight.Group

	hits, misses, staleServed, loadErrors, revalidated atomic.Uint64
}

func New[V any](opts Options) *Cache[V] {
	return &Cache[V]{opts: opts, entries: make(map[string]entry[V])}
}

// Get returns the cached value for key, calling load on a miss. The boolean
// reports whether the value is stale (served because load failed).
func (c *Cache[V]) Get(ctx context.Context, key string, load func(context.Context) (V, error)) (V, bool, error) {
	cached, found := c.lookup(key)
	if found && time.Since(cached.fetchedAt) < c.opts.TTL {
		c.hits.Add(1)
		return cached.value, false, nil
	}
	c.misses.Add(1)

	results := c.group.DoChan(key, func() (any, error) {
		// Detached from the first caller's context: one cancelled request must not
		// fail every other caller coalesced onto this load. Upstream clients carry
		// their own timeouts.
		value, err := load(context.WithoutCancel(ctx))
		if err != nil {
			return value, err
		}
		c.store(key, value)
		return value, nil
	})

	var zero V
	select {
	case <-ctx.Done():
		return zero, false, ctx.Err()
	case res := <-results:
		if res.Err == nil {
			return res.Val.(V), false, nil
		}
		c.loadErrors.Add(1)
		if found && time.Since(cached.fetchedAt) < c.opts.TTL+c.opts.StaleFor {
			c.staleServed.Add(1)
			return cached.value, true, nil
		}
		return zero, false, res.Err
	}
}

// GetFast never waits on upstream for a value it already has: an expired entry
// still inside its stale window is returned at once while a refresh runs in
// the background (stale-while-revalidate). Only a true miss loads in line.
// For callers that need speed over the last few seconds of freshness, like a
// ranking overlaying live prices on dozens of symbols at once.
func (c *Cache[V]) GetFast(ctx context.Context, key string, load func(context.Context) (V, error)) (V, error) {
	cached, found := c.lookup(key)
	if found {
		age := time.Since(cached.fetchedAt)
		if age < c.opts.TTL {
			c.hits.Add(1)
			return cached.value, nil
		}
		if age < c.opts.TTL+c.opts.StaleFor {
			c.revalidated.Add(1)
			// Refresh shares the in-flight load (singleflight), so a burst of
			// readers starts one upstream call per key, not one each.
			go func() { _, _ = c.Refresh(context.WithoutCancel(ctx), key, load) }()
			return cached.value, nil
		}
	}
	value, _, err := c.Get(ctx, key, load)
	return value, err
}

// Refresh reloads key unconditionally and stores the result, so a background
// job can renew entries before they expire instead of letting users hit
// misses. On failure the existing entry is kept, and stale-if-error still
// protects readers. Concurrent Gets for the same key share this load.
func (c *Cache[V]) Refresh(ctx context.Context, key string, load func(context.Context) (V, error)) (V, error) {
	res := <-c.group.DoChan(key, func() (any, error) {
		value, err := load(context.WithoutCancel(ctx))
		if err != nil {
			return value, err
		}
		c.store(key, value)
		return value, nil
	})
	if res.Err != nil {
		c.loadErrors.Add(1)
		var zero V
		return zero, res.Err
	}
	return res.Val.(V), nil
}

func (c *Cache[V]) Stats() Stats {
	c.mu.Lock()
	size := len(c.entries)
	c.mu.Unlock()
	return Stats{
		Size:        size,
		Hits:        c.hits.Load(),
		Misses:      c.misses.Load(),
		StaleServed: c.staleServed.Load(),
		LoadErrors:  c.loadErrors.Load(),
		Revalidated: c.revalidated.Load(),
	}
}

func (c *Cache[V]) lookup(key string) (entry[V], bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	return e, ok
}

func (c *Cache[V]) store(key string, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[key]; !exists && c.opts.MaxEntries > 0 && len(c.entries) >= c.opts.MaxEntries {
		c.evictLocked()
	}
	c.entries[key] = entry[V]{value: value, fetchedAt: time.Now()}
}

// evictLocked drops every entry past its stale window, then the oldest entry
// if the cache is still full. O(n), which is fine at the sizes this runs at.
func (c *Cache[V]) evictLocked() {
	var oldestKey string
	var oldestAt time.Time
	for key, e := range c.entries {
		if time.Since(e.fetchedAt) >= c.opts.TTL+c.opts.StaleFor {
			delete(c.entries, key)
			continue
		}
		if oldestKey == "" || e.fetchedAt.Before(oldestAt) {
			oldestKey, oldestAt = key, e.fetchedAt
		}
	}
	if len(c.entries) >= c.opts.MaxEntries && oldestKey != "" {
		delete(c.entries, oldestKey)
	}
}
