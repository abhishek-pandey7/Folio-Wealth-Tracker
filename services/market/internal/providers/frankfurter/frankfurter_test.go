package frankfurter

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/upstream"
)

func newProvider(t *testing.T, body string) *Provider {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/latest" || r.URL.Query().Get("base") != "USD" || r.URL.Query().Get("symbols") != "INR" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return New(upstream.New(upstream.Options{Name: "frankfurter", Timeout: time.Second, RatePerSecond: 1000, Burst: 1000}), srv.URL)
}

func TestRateKeepsExactDecimal(t *testing.T) {
	p := newProvider(t, `{"amount":1.0,"base":"USD","date":"2026-10-19","rates":{"INR":94.93}}`)

	rate, err := p.Rate(t.Context(), "USD", "INR")
	if err != nil {
		t.Fatal(err)
	}

	want := market.FxRate{Base: "USD", Quote: "INR", Rate: "94.93", Date: "2026-10-19", Source: "frankfurter"}
	if rate != want {
		t.Fatalf("got %+v, want %+v", rate, want)
	}
}

func TestMissingRateIsNotFound(t *testing.T) {
	p := newProvider(t, `{"amount":1.0,"base":"USD","date":"2026-10-19","rates":{}}`)

	if _, err := p.Rate(t.Context(), "USD", "INR"); !errors.Is(err, market.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
