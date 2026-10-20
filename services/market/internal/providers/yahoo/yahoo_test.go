package yahoo

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/upstream"
)

// Fixtures are trimmed copies of real responses; tests never touch the network.
const quoteFixture = `{"chart":{"result":[{"meta":{"currency":"INR","symbol":"RELIANCE.NS","regularMarketPrice":1202.0,
"chartPreviousClose":1211.2,"regularMarketTime":1792403978},"timestamp":[1792403978],
"indicators":{"quote":[{"close":[1202.0]}]}}],"error":null}}`

const historyFixture = `{"chart":{"result":[{"meta":{"currency":"INR","symbol":"NIFTYBEES.NS","regularMarketPrice":270.1,
"chartPreviousClose":267.0,"regularMarketTime":1792403978},
"timestamp":[1790400000,1790486400,1790572800,1790659200,1790676000],
"indicators":{"quote":[{"close":[267.760009765625,null,267.59,263.99,264.13]}]}}],"error":null}}`

const jpyFixture = `{"chart":{"result":[{"meta":{"currency":"JPY","symbol":"7203.T","regularMarketPrice":2900,
"chartPreviousClose":2890,"regularMarketTime":1792403978}}],"error":null}}`

const searchFixture = `{"quotes":[
{"symbol":"HDFCBANK.NS","shortname":"HDFC BANK LTD","longname":"HDFC Bank Limited","exchange":"NSI","exchDisp":"NSE","quoteType":"EQUITY"},
{"symbol":"HDFCBANK-FUT","shortname":"HDFC future","exchange":"NSI","quoteType":"FUTURE"},
{"symbol":"NIFTYBEES.NS","shortname":"NIP IND ETF NIFTY BEES","exchange":"NSI","exchDisp":"NSE","quoteType":"ETF"}]}`

func newProvider(t *testing.T, routes map[string]string) *Provider {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := routes[r.URL.Path]
		if !ok {
			http.Error(w, `{"chart":{"result":null,"error":{"code":"Not Found"}}}`, http.StatusNotFound)
			return
		}
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	client := upstream.New(upstream.Options{Name: "yahoo", Timeout: time.Second, RatePerSecond: 1000, Burst: 1000})
	return New(client, srv.URL)
}

func TestQuoteComputesChangeWithDecimals(t *testing.T) {
	p := newProvider(t, map[string]string{"/v8/finance/chart/RELIANCE.NS": quoteFixture})

	q, err := p.Quote(t.Context(), "RELIANCE.NS")
	if err != nil {
		t.Fatal(err)
	}

	want := market.Quote{
		Symbol: "RELIANCE.NS", Currency: "INR", Price: "1202", Change: "-9.2", ChangePercent: "-0.76",
		PreviousClose: "1211.2", AsOf: time.Unix(1792403978, 0).UTC(), Source: "yahoo",
	}
	if q != want {
		t.Fatalf("got  %+v\nwant %+v", q, want)
	}
}

func TestHistorySkipsNullsDedupesDatesAndRoundsFloatNoise(t *testing.T) {
	p := newProvider(t, map[string]string{"/v8/finance/chart/NIFTYBEES.NS": historyFixture})

	h, err := p.History(t.Context(), "NIFTYBEES.NS", "1mo")
	if err != nil {
		t.Fatal(err)
	}

	want := []market.PricePoint{
		{Date: "2026-09-26", Close: "267.76"}, // 267.760009765625 rounded
		{Date: "2026-09-28", Close: "267.59"}, // 09-27 was null
		{Date: "2026-09-29", Close: "264.13"}, // two bars on 09-29: the later one wins
	}
	if len(h.Points) != len(want) {
		t.Fatalf("points = %+v, want %+v", h.Points, want)
	}
	for i := range want {
		if h.Points[i] != want[i] {
			t.Errorf("point %d = %+v, want %+v", i, h.Points[i], want[i])
		}
	}
	if h.Interval != "1d" {
		t.Errorf("interval = %q, want 1d", h.Interval)
	}
}

func TestUnknownSymbolIsNotFound(t *testing.T) {
	p := newProvider(t, nil)

	if _, err := p.Quote(t.Context(), "NOPE.NS"); !errors.Is(err, market.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestUnsupportedCurrencyIsRejected(t *testing.T) {
	p := newProvider(t, map[string]string{"/v8/finance/chart/7203.T": jpyFixture})

	if _, err := p.Quote(t.Context(), "7203.T"); !errors.Is(err, market.ErrUnsupported) {
		t.Fatalf("err = %v, want ErrUnsupported", err)
	}
}

func TestSearchKeepsOnlyInvestableTypes(t *testing.T) {
	p := newProvider(t, map[string]string{"/v1/finance/search": searchFixture})

	matches, err := p.Search(t.Context(), "hdfc")
	if err != nil {
		t.Fatal(err)
	}

	want := []market.SymbolMatch{
		{Symbol: "HDFCBANK.NS", Name: "HDFC Bank Limited", Exchange: "NSE", Type: "equity"},
		{Symbol: "NIFTYBEES.NS", Name: "NIP IND ETF NIFTY BEES", Exchange: "NSE", Type: "etf"},
	}
	if len(matches) != len(want) || matches[0] != want[0] || matches[1] != want[1] {
		t.Fatalf("got %+v, want %+v", matches, want)
	}
}

func TestUpstreamOutageIsReportedAsUpstreamFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	p := New(upstream.New(upstream.Options{Name: "yahoo", Timeout: time.Second, RatePerSecond: 10, Burst: 1}), srv.URL)

	if _, err := p.Quote(t.Context(), "AAPL"); !errors.Is(err, market.ErrUpstream) {
		t.Fatalf("err = %v, want ErrUpstream", err)
	}
}

const dailyFixture = `{"chart":{"result":[{"meta":{"currency":"INR","symbol":"RELIANCE.NS","regularMarketPrice":1202.0,
"chartPreviousClose":1211.2,"regularMarketTime":1792403978,"longName":"Reliance Industries Limited",
"shortName":"RELIANCE INDUSTRIES LTD","fullExchangeName":"NSE","fiftyTwoWeekHigh":1611.8,"fiftyTwoWeekLow":1152.2},
"timestamp":[1790400000,1790486400,1790572800,1790659200,1790676000],
"indicators":{"quote":[{"close":[270.0,271.0,272.0,273.0,274.0]}],
"adjclose":[{"adjclose":[265.5,null,267.25,268.0,269.75]}]}}],"error":null}}`

func TestDailySeriesUsesAdjustedClosesAndMetadata(t *testing.T) {
	p := newProvider(t, map[string]string{"/v8/finance/chart/RELIANCE.NS": dailyFixture})

	s, err := p.DailySeries(t.Context(), "RELIANCE.NS")
	if err != nil {
		t.Fatal(err)
	}

	if s.Name != "Reliance Industries Limited" || s.Exchange != "NSE" || s.Price != "1202" || *s.High52w != 1611.8 {
		t.Errorf("metadata wrong: %+v", s)
	}
	// Adjusted closes, the null skipped, and two bars on 09-29 collapsed into the later one.
	want := []float64{265.5, 267.25, 269.75}
	if len(s.Points) != len(want) {
		t.Fatalf("got %d points, want %d: %+v", len(s.Points), len(want), s.Points)
	}
	for i, v := range want {
		if s.Points[i].Value != v {
			t.Errorf("point %d = %v, want %v", i, s.Points[i].Value, v)
		}
	}
}
