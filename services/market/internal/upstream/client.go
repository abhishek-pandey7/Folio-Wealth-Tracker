// Package upstream is the one place the gateway talks to third-party HTTP APIs:
// per-provider timeouts, client-side rate limiting, and mapping of transport
// and status failures onto the market package's sentinel errors.
package upstream

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"golang.org/x/time/rate"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
)

const (
	userAgent    = "Mozilla/5.0 (compatible; folio-market-gateway/0.1)"
	maxBodyBytes = 5 << 20
)

type Options struct {
	Name    string
	Timeout time.Duration
	// RatePerSecond and Burst throttle outgoing calls so a burst of cache
	// misses cannot get us blocked by a free API.
	RatePerSecond float64
	Burst         int
}

type Client struct {
	name    string
	http    *http.Client
	limiter *rate.Limiter
}

func New(opts Options) *Client {
	return &Client{
		name:    opts.Name,
		http:    &http.Client{Timeout: opts.Timeout},
		limiter: rate.NewLimiter(rate.Limit(opts.RatePerSecond), opts.Burst),
	}
}

// GetJSON fetches url and decodes the JSON body into out.
func (c *Client) GetJSON(ctx context.Context, url string, out any) error {
	if err := c.limiter.Wait(ctx); err != nil {
		return fmt.Errorf("%w: %s rate limit wait: %v", market.ErrUpstream, c.name, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("%w: %s request: %v", market.ErrUpstream, c.name, err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %s unreachable: %v", market.ErrUpstream, c.name, err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%w: %s has no data for this request", market.ErrNotFound, c.name)
	case resp.StatusCode >= 400:
		return fmt.Errorf("%w: %s returned HTTP %d", market.ErrUpstream, c.name, resp.StatusCode)
	}

	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(out); err != nil {
		return fmt.Errorf("%w: %s sent an unreadable response: %v", market.ErrUpstream, c.name, err)
	}
	return nil
}
