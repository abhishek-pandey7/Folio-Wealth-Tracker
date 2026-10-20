package market_test

import (
	"errors"
	"testing"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/analytics"
	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/providers/mock"
	"github.com/abhishek-pandey7/folio/services/market/internal/universe"
)

func newMockService() *market.Service {
	m := mock.New()
	return market.NewService(m, m, m, m, market.Config{QuoteTTL: 15 * time.Second})
}

func ret(row market.ScreenRow, p analytics.Period) float64 { return *row.Metrics.Returns[p] }

func TestScreenRanksBestFirstAndWorstFirst(t *testing.T) {
	svc := newMockService()
	u, _ := universe.Get("us-large")

	best, err := svc.Screen(t.Context(), market.ScreenQuery{Universe: "us-large", Period: "1y", Limit: "100"})
	if err != nil {
		t.Fatal(err)
	}
	if best.Total != u.Count || len(best.Rows) != u.Count {
		t.Fatalf("got %d of %d rows (total %d)", len(best.Rows), u.Count, best.Total)
	}
	for i := 1; i < len(best.Rows); i++ {
		if ret(best.Rows[i-1], analytics.P1Y) < ret(best.Rows[i], analytics.P1Y) {
			t.Fatalf("rows not sorted by 1y return descending at %d", i)
		}
	}

	worst, _ := svc.Screen(t.Context(), market.ScreenQuery{Universe: "us-large", Period: "1y", Order: "worst", Limit: "3"})
	if len(worst.Rows) != 3 || worst.Rows[0].Symbol != best.Rows[len(best.Rows)-1].Symbol {
		t.Fatalf("worst-first should start with the best list's last row; got %s", worst.Rows[0].Symbol)
	}
}

func TestLowestVolatilityIsBest(t *testing.T) {
	svc := newMockService()

	res, err := svc.Screen(t.Context(), market.ScreenQuery{Universe: "in-large", Sort: "volatility", Limit: "10"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < len(res.Rows); i++ {
		if *res.Rows[i-1].Metrics.Volatility1y > *res.Rows[i].Metrics.Volatility1y {
			t.Fatalf("steadiest-first should sort volatility ascending at %d", i)
		}
	}
}

func TestOneDayReturnComesFromTheLiveQuote(t *testing.T) {
	svc := newMockService()

	res, _ := svc.Screen(t.Context(), market.ScreenQuery{Symbols: []string{"TCS.NS", "AAPL"}, Period: "1d"})
	for _, row := range res.Rows {
		if row.ChangePercent == nil || *row.Metrics.Returns[analytics.P1D] != *row.ChangePercent {
			t.Errorf("%s: 1d return should equal the live change percent", row.Symbol)
		}
	}
}

func TestExplicitSymbolsReportInvalidOnesAsUnavailable(t *testing.T) {
	svc := newMockService()

	res, err := svc.Screen(t.Context(), market.ScreenQuery{Symbols: []string{"TCS.NS", "not a symbol", "tcs.ns"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 1 || res.Rows[0].Symbol != "TCS.NS" {
		t.Errorf("rows = %+v, want just TCS.NS (deduplicated)", res.Rows)
	}
	if _, ok := res.Unavailable["not a symbol"]; !ok {
		t.Errorf("unavailable = %v, want the invalid symbol listed", res.Unavailable)
	}
}

func TestScreenValidatesInput(t *testing.T) {
	svc := newMockService()

	tests := []struct {
		name string
		q    market.ScreenQuery
		want error
	}{
		{"unknown universe", market.ScreenQuery{Universe: "moon-stocks"}, market.ErrNotFound},
		{"bad sort", market.ScreenQuery{Universe: "us-large", Sort: "vibes"}, market.ErrInvalid},
		{"bad period", market.ScreenQuery{Universe: "us-large", Period: "10y"}, market.ErrInvalid},
		{"bad limit", market.ScreenQuery{Universe: "us-large", Limit: "1000"}, market.ErrInvalid},
		{"nothing to screen", market.ScreenQuery{}, market.ErrInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := svc.Screen(t.Context(), tt.q); !errors.Is(err, tt.want) {
				t.Errorf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestFundCategoriesCountActiveDirectGrowthSchemes(t *testing.T) {
	svc := newMockService()

	cats, err := svc.FundCategories(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cats {
		if c.Count < 3 {
			t.Errorf("%s has %d schemes; the mock provides at least 3 per category", c.ID, c.Count)
		}
	}
}

func TestFundScreenDefaultsToThreeYearReturns(t *testing.T) {
	svc := newMockService()

	res, err := svc.FundScreen(t.Context(), market.FundScreenQuery{Category: "large-cap"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Period != analytics.P3Y || len(res.Rows) != 3 {
		t.Fatalf("period %s, %d rows; want 3y and 3 rows", res.Period, len(res.Rows))
	}
	for i := 1; i < len(res.Rows); i++ {
		if *res.Rows[i-1].Metrics.Returns[analytics.P3Y] < *res.Rows[i].Metrics.Returns[analytics.P3Y] {
			t.Fatal("funds not sorted by 3y return descending")
		}
	}
}

func TestFundHistoryRanges(t *testing.T) {
	svc := newMockService()

	oneYear, err := svc.FundHistory(t.Context(), "900010", "1y")
	if err != nil {
		t.Fatal(err)
	}
	fiveYear, _ := svc.FundHistory(t.Context(), "900010", "5y")

	if n := len(oneYear.Points); n < 240 || n > 270 {
		t.Errorf("1y has %d daily points, want about 260", n)
	}
	if n := len(fiveYear.Points); n < 250 || n > 270 {
		t.Errorf("5y has %d points, want about 261 weekly points", n)
	}
	if fiveYear.Interval != "1wk" || oneYear.Currency != "INR" {
		t.Errorf("unexpected history metadata: %+v", oneYear)
	}
}

func TestWarmersRefreshEverything(t *testing.T) {
	svc := newMockService()

	stocks := svc.WarmStocks(t.Context())
	if stocks.Failed != 0 || stocks.Refreshed != len(universe.AllSymbols()) {
		t.Errorf("stock warm = %+v, want all %d symbols refreshed", stocks, len(universe.AllSymbols()))
	}
	funds := svc.WarmFunds(t.Context())
	if funds.Failed != 0 || funds.Refreshed == 0 {
		t.Errorf("fund warm = %+v, want every candidate refreshed", funds)
	}
	if _, ok := svc.WarmReports()["funds"]; !ok {
		t.Error("warm reports should include the funds job")
	}
}

func TestFundNavsOnUsesTheNextPublishedNav(t *testing.T) {
	svc := newMockService()
	// Mock NAVs are published on weekdays only. 2025-01-04 is a Saturday.
	navs, err := svc.FundNavsOn(t.Context(), "900010", []string{"2025-01-04", "2025-01-06", "2999-01-01"})
	if err != nil {
		t.Fatal(err)
	}

	if len(navs) != 2 {
		t.Fatalf("got %d navs, want 2 (the future date is not published yet): %+v", len(navs), navs)
	}
	if navs[0].Requested != "2025-01-04" || navs[0].Date != "2025-01-06" {
		t.Errorf("a Saturday SIP should take Monday's NAV, got %+v", navs[0])
	}
	if navs[1].Date != "2025-01-06" || navs[0].Nav != navs[1].Nav {
		t.Errorf("the Monday request should match Monday's NAV, got %+v", navs[1])
	}
}

func TestFundNavsOnValidatesDates(t *testing.T) {
	svc := newMockService()

	if _, err := svc.FundNavsOn(t.Context(), "900010", []string{"05-01-2025"}); !errors.Is(err, market.ErrInvalid) {
		t.Errorf("err = %v, want ErrInvalid for a non-ISO date", err)
	}
	if _, err := svc.FundNavsOn(t.Context(), "900010", nil); !errors.Is(err, market.ErrInvalid) {
		t.Errorf("err = %v, want ErrInvalid for no dates", err)
	}
}
