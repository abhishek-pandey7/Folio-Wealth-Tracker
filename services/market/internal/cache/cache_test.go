package cache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

// These tests run inside synctest bubbles: time is virtual, so TTL expiry is
// tested with time.Sleep instantly and deterministically.

func counter(value string) (*atomic.Int32, func(context.Context) (string, error)) {
	var calls atomic.Int32
	return &calls, func(context.Context) (string, error) {
		calls.Add(1)
		return value, nil
	}
}

func TestServesFreshEntriesFromCache(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := New[string](Options{TTL: 15 * time.Second})
		calls, load := counter("v1")

		c.Get(t.Context(), "AAPL", load)
		time.Sleep(14 * time.Second)
		got, stale, err := c.Get(t.Context(), "AAPL", load)

		if err != nil || got != "v1" || stale {
			t.Fatalf("got (%q, stale=%v, %v), want (v1, false, nil)", got, stale, err)
		}
		if n := calls.Load(); n != 1 {
			t.Fatalf("upstream called %d times, want 1", n)
		}
	})
}

func TestReloadsAfterTTL(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := New[string](Options{TTL: 15 * time.Second})
		calls, load := counter("v1")

		c.Get(t.Context(), "AAPL", load)
		time.Sleep(16 * time.Second)
		c.Get(t.Context(), "AAPL", load)

		if n := calls.Load(); n != 2 {
			t.Fatalf("upstream called %d times, want 2", n)
		}
	})
}

func TestCoalescesConcurrentMisses(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := New[string](Options{TTL: time.Minute})
		release := make(chan struct{})
		var calls atomic.Int32
		load := func(context.Context) (string, error) {
			calls.Add(1)
			<-release
			return "v1", nil
		}

		var wg sync.WaitGroup
		for range 10 {
			wg.Go(func() {
				if got, _, err := c.Get(t.Context(), "TCS.NS", load); err != nil || got != "v1" {
					t.Errorf("got (%q, %v)", got, err)
				}
			})
		}
		synctest.Wait() // every goroutine is now blocked: one in load, nine waiting on it
		close(release)
		wg.Wait()

		if n := calls.Load(); n != 1 {
			t.Fatalf("upstream called %d times for 10 concurrent requests, want 1", n)
		}
	})
}

func TestServesStaleValueWhenUpstreamFails(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := New[string](Options{TTL: 15 * time.Second, StaleFor: time.Hour})
		_, ok := counter("v1")
		c.Get(t.Context(), "INFY.NS", ok)

		time.Sleep(time.Minute)
		got, stale, err := c.Get(t.Context(), "INFY.NS", func(context.Context) (string, error) {
			return "", errors.New("upstream down")
		})

		if err != nil || got != "v1" || !stale {
			t.Fatalf("got (%q, stale=%v, %v), want (v1, true, nil)", got, stale, err)
		}
		if s := c.Stats(); s.StaleServed != 1 || s.LoadErrors != 1 {
			t.Fatalf("stats = %+v, want 1 stale serve and 1 load error", s)
		}
	})
}

func TestReturnsErrorOnceStaleWindowHasPassed(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := New[string](Options{TTL: 15 * time.Second, StaleFor: time.Hour})
		_, ok := counter("v1")
		c.Get(t.Context(), "INFY.NS", ok)

		time.Sleep(2 * time.Hour)
		upstreamErr := errors.New("upstream down")
		_, _, err := c.Get(t.Context(), "INFY.NS", func(context.Context) (string, error) { return "", upstreamErr })

		if !errors.Is(err, upstreamErr) {
			t.Fatalf("err = %v, want %v", err, upstreamErr)
		}
	})
}

func TestDoesNotCacheFailures(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := New[string](Options{TTL: time.Minute})
		c.Get(t.Context(), "AAPL", func(context.Context) (string, error) { return "", errors.New("boom") })

		calls, load := counter("v1")
		got, _, err := c.Get(t.Context(), "AAPL", load)

		if err != nil || got != "v1" || calls.Load() != 1 {
			t.Fatalf("got (%q, %v) after %d calls; a failure must not be cached", got, err, calls.Load())
		}
	})
}

func TestEvictsOldestEntryWhenFull(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := New[string](Options{TTL: time.Hour, MaxEntries: 2})
		_, load := counter("v")

		c.Get(t.Context(), "A", load)
		time.Sleep(time.Second)
		c.Get(t.Context(), "B", load)
		time.Sleep(time.Second)
		c.Get(t.Context(), "C", load)

		if size := c.Stats().Size; size != 2 {
			t.Fatalf("size = %d, want 2", size)
		}
		if _, found := c.lookup("A"); found {
			t.Fatal("oldest entry A should have been evicted")
		}
	})
}

func TestCallerCancellationDoesNotAbortSharedLoad(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		c := New[string](Options{TTL: time.Minute})
		release := make(chan struct{})
		var loadSawLiveContext atomic.Bool
		load := func(ctx context.Context) (string, error) {
			<-release
			loadSawLiveContext.Store(ctx.Err() == nil)
			return "v1", nil
		}

		ctx, cancel := context.WithCancel(t.Context())
		done := make(chan error)
		go func() {
			_, _, err := c.Get(ctx, "AAPL", load)
			done <- err
		}()
		synctest.Wait()
		cancel()
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled caller got %v, want context.Canceled", err)
		}

		close(release)
		synctest.Wait()
		if !loadSawLiveContext.Load() {
			t.Fatal("load saw a cancelled context; it should be detached from the caller")
		}
		if got, _, err := c.Get(t.Context(), "AAPL", load); err != nil || got != "v1" {
			t.Fatalf("value from the completed load should be cached, got (%q, %v)", got, err)
		}
	})
}
