package mfapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/upstream"
)

const latestFixture = `{"meta":{"fund_house":"PPFAS Mutual Fund","scheme_type":"Open Ended Schemes",
"scheme_category":"Equity Scheme - Flexi Cap Fund","scheme_code":122639,
"scheme_name":"Parag Parikh Flexi Cap Fund - Direct Plan - Growth"},
"data":[{"date":"19-10-2026","nav":"90.35460"}],"status":"SUCCESS"}`

// mfapi answers unknown scheme codes with 200 and empty payloads, not 404.
const unknownFixture = `{"meta":{},"data":[],"status":"SUCCESS"}`

func newProvider(t *testing.T, routes map[string]string) *Provider {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if body, ok := routes[r.URL.Path]; ok {
			w.Write([]byte(body))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return New(upstream.New(upstream.Options{Name: "mfapi", Timeout: time.Second, RatePerSecond: 1000, Burst: 1000}), srv.URL)
}

func TestFundParsesNavAndIndianDateFormat(t *testing.T) {
	p := newProvider(t, map[string]string{"/mf/122639/latest": latestFixture})

	f, err := p.Fund(t.Context(), "122639")
	if err != nil {
		t.Fatal(err)
	}

	want := market.Fund{
		SchemeCode: "122639", Name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", FundHouse: "PPFAS Mutual Fund",
		Category: "Equity Scheme - Flexi Cap Fund", Nav: "90.3546", NavDate: "2026-10-19", Source: "mfapi",
	}
	if f != want {
		t.Fatalf("got  %+v\nwant %+v", f, want)
	}
}

func TestEmptyPayloadMeansNotFound(t *testing.T) {
	p := newProvider(t, map[string]string{"/mf/99999999/latest": unknownFixture})

	if _, err := p.Fund(t.Context(), "99999999"); !errors.Is(err, market.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestSearchCapsResults(t *testing.T) {
	items := make([]string, 30)
	for i := range items {
		items[i] = fmt.Sprintf(`{"schemeCode":%d,"schemeName":"Fund %d"}`, 100000+i, i)
	}
	p := newProvider(t, map[string]string{"/mf/search": "[" + strings.Join(items, ",") + "]"})

	matches, err := p.SearchFunds(t.Context(), "fund")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != maxResults || matches[0] != (market.FundMatch{SchemeCode: "100000", Name: "Fund 0"}) {
		t.Fatalf("got %d matches starting %+v", len(matches), matches[0])
	}
}
