package market

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

type fakeQuotes struct {
	calls   atomic.Int32
	failFor map[string]error
	delay   time.Duration
}

func (f *fakeQuotes) Quote(_ context.Context, symbol string) (Quote, error) {
	f.calls.Add(1)
	time.Sleep(f.delay)
	if err := f.failFor[symbol]; err != nil {
		return Quote{}, err
	}
	return Quote{Symbol: symbol, Currency: "INR", Price: "100"}, nil
}

func (f *fakeQuotes) History(context.Context, string, Range) (History, error) { return History{}, nil }
func (f *fakeQuotes) Search(context.Context, string) ([]SymbolMatch, error)   { return nil, nil }

func newTestService(q *fakeQuotes) *Service {
	return NewService(q, nil, nil, Config{QuoteTTL: 15 * time.Second, BatchConcurrency: 4})
}

func TestQuoteNormalizesAndValidatesSymbols(t *testing.T) {
	svc := newTestService(&fakeQuotes{})

	q, err := svc.Quote(t.Context(), "  reliance.ns ")
	if err != nil || q.Symbol != "RELIANCE.NS" {
		t.Fatalf("got (%+v, %v), want RELIANCE.NS", q, err)
	}
	if _, err := svc.Quote(t.Context(), "DROP TABLE;"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestBatchReportsPartialFailuresWithoutFailingTheBatch(t *testing.T) {
	q := &fakeQuotes{failFor: map[string]error{"DELISTED.NS": fmt.Errorf("%w: gone", ErrNotFound)}}
	svc := newTestService(q)

	got, err := svc.Quotes(t.Context(), []string{"TCS.NS", "DELISTED.NS", "bad symbol!", "INFY.NS", "tcs.ns"})
	if err != nil {
		t.Fatal(err)
	}

	if len(got.Quotes) != 2 || got.Quotes[0].Symbol != "TCS.NS" || got.Quotes[1].Symbol != "INFY.NS" {
		t.Fatalf("quotes = %+v, want TCS.NS then INFY.NS (deduplicated, in request order)", got.Quotes)
	}
	if _, ok := got.Errors["DELISTED.NS"]; !ok {
		t.Errorf("missing error for DELISTED.NS: %v", got.Errors)
	}
	if _, ok := got.Errors["bad symbol!"]; !ok {
		t.Errorf("missing error for invalid symbol: %v", got.Errors)
	}
	if n := q.calls.Load(); n != 3 {
		t.Errorf("upstream called %d times, want 3 (duplicates and invalid symbols skipped)", n)
	}
}

func TestBatchFetchesConcurrently(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		svc := newTestService(&fakeQuotes{delay: time.Second})
		symbols := []string{"A", "B", "C", "D", "E", "F", "G", "H"}

		start := time.Now()
		if _, err := svc.Quotes(t.Context(), symbols); err != nil {
			t.Fatal(err)
		}

		// 8 symbols, 1s each, 4 at a time: 2s, not 8s sequentially.
		if elapsed := time.Since(start); elapsed != 2*time.Second {
			t.Fatalf("batch took %v, want 2s with concurrency 4", elapsed)
		}
	})
}

func TestBatchRejectsOversizedRequests(t *testing.T) {
	svc := newTestService(&fakeQuotes{})
	symbols := make([]string, MaxBatchSymbols+1)
	for i := range symbols {
		symbols[i] = fmt.Sprintf("S%d", i)
	}

	if _, err := svc.Quotes(t.Context(), symbols); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestQuoteIsMarkedStaleWhenServedFromCacheAfterFailure(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		q := &fakeQuotes{failFor: map[string]error{}}
		svc := newTestService(q)
		svc.Quote(t.Context(), "AAPL")

		time.Sleep(time.Minute)
		q.failFor["AAPL"] = fmt.Errorf("%w: timeout", ErrUpstream)
		got, err := svc.Quote(t.Context(), "AAPL")

		if err != nil || !got.Stale {
			t.Fatalf("got (%+v, %v), want a stale quote", got, err)
		}
	})
}

func TestSameCurrencyFxNeedsNoUpstream(t *testing.T) {
	svc := newTestService(&fakeQuotes{}) // nil FxSource would panic if called

	rate, err := svc.FxRate(t.Context(), "inr", "INR")
	if err != nil || rate.Rate != "1" {
		t.Fatalf("got (%+v, %v), want rate 1", rate, err)
	}
}
