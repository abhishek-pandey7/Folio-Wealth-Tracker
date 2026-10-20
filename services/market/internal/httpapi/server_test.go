package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/providers/mock"
)

func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	m := mock.New()
	svc := market.NewService(m, m, m, m, market.Config{QuoteTTL: 15 * time.Second})
	srv := httptest.NewServer(NewHandler(svc, slog.New(slog.NewTextHandler(io.Discard, nil)), "mock"))
	t.Cleanup(srv.Close)
	return srv
}

func get(t *testing.T, srv *httptest.Server, path string, out any) *http.Response {
	t.Helper()
	resp, err := http.Get(srv.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatalf("decode %s: %v", path, err)
		}
	}
	return resp
}

func TestRoutes(t *testing.T) {
	srv := newServer(t)

	tests := []struct {
		path   string
		status int
	}{
		{"/healthz", http.StatusOK},
		{"/v1/quotes/RELIANCE.NS", http.StatusOK},
		{"/v1/quotes/%5ENSEI", http.StatusOK},
		{"/v1/quotes?symbols=AAPL,TCS.NS", http.StatusOK},
		{"/v1/history/AAPL?range=6mo", http.StatusOK},
		{"/v1/search?q=infosys", http.StatusOK},
		{"/v1/fx?base=USD&quote=INR", http.StatusOK},
		{"/v1/funds/search?q=parag", http.StatusOK},
		{"/v1/funds/122639", http.StatusOK},
		{"/v1/quotes/not%20a%20symbol", http.StatusBadRequest},
		{"/v1/history/AAPL?range=10y", http.StatusBadRequest},
		{"/v1/search?q=a", http.StatusBadRequest},
		{"/v1/funds/abc", http.StatusBadRequest},
		{"/v1/funds/999999", http.StatusNotFound},
		{"/v1/quotes", http.StatusBadRequest},
		{"/v1/universes", http.StatusOK},
		{"/v1/screener?universe=in-large&period=1m&sort=return&limit=5", http.StatusOK},
		{"/v1/screener?symbols=AAPL,TCS.NS&sort=risk_adjusted", http.StatusOK},
		{"/v1/screener?universe=nope", http.StatusNotFound},
		{"/v1/screener?universe=in-large&sort=vibes", http.StatusBadRequest},
		{"/v1/stats/INFY.NS", http.StatusOK},
		{"/v1/funds/categories", http.StatusOK},
		{"/v1/funds/screener?category=mid-cap&period=5y", http.StatusOK},
		{"/v1/funds/screener?codes=122639,900010", http.StatusOK},
		{"/v1/funds/screener?category=crypto", http.StatusNotFound},
		{"/v1/funds/122639/stats", http.StatusOK},
		{"/v1/funds/122639/history?range=3mo", http.StatusOK},
		{"/v1/funds/999999/stats", http.StatusNotFound},
		{"/v1/funds/122639/navs?on=2025-01-06,2025-02-05", http.StatusOK},
		{"/v1/funds/122639/navs?on=yesterday", http.StatusBadRequest},
		{"/v1/funds/122639/navs", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if resp := get(t, srv, tt.path, nil); resp.StatusCode != tt.status {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tt.status)
			}
		})
	}
}

func TestQuoteResponseShape(t *testing.T) {
	srv := newServer(t)

	var q market.Quote
	get(t, srv, "/v1/quotes/tcs.ns", &q)

	if q.Symbol != "TCS.NS" || q.Currency != "INR" || q.Price == "" || q.Source != "mock" {
		t.Fatalf("unexpected quote: %+v", q)
	}
}

func TestErrorsCarryCodeAndRequestID(t *testing.T) {
	srv := newServer(t)

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/funds/999999", nil)
	req.Header.Set("X-Request-Id", "trace-123")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var body errorBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "not_found" || body.Error.RequestID != "trace-123" {
		t.Fatalf("error body = %+v", body)
	}
	if got := resp.Header.Get("X-Request-Id"); got != "trace-123" {
		t.Fatalf("X-Request-Id = %q, want it echoed back", got)
	}
}

type panickingService struct{ MarketService }

func (panickingService) Quote(context.Context, string) (market.Quote, error) { panic("boom") }

func TestPanicsBecome500WithoutLeakingDetails(t *testing.T) {
	srv := httptest.NewServer(NewHandler(panickingService{}, slog.New(slog.NewTextHandler(io.Discard, nil)), "test"))
	defer srv.Close()

	var body errorBody
	resp := get(t, srv, "/v1/quotes/AAPL", &body)

	if resp.StatusCode != http.StatusInternalServerError || body.Error.Message != "internal error" {
		t.Fatalf("got %d %+v", resp.StatusCode, body)
	}
}
