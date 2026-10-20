package analytics

import (
	"math"
	"testing"
	"time"
)

// series builds one point per weekday from start to end with value f(t),
// where t is years since start.
func series(start, end time.Time, f func(years float64) float64) []Point {
	var points []Point
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			continue
		}
		points = append(points, Point{Date: d, Value: f(d.Sub(start).Hours() / 24 / 365.25)})
	}
	return points
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func approx(t *testing.T, name string, got, want, tol float64) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Errorf("%s = %.4f, want %.4f ± %.4f", name, got, want, tol)
	}
}

func TestCAGRForMultiYearPeriods(t *testing.T) {
	// Grows exactly 10% a year, compounding daily.
	points := series(day(2019, 1, 1), day(2025, 6, 30), func(y float64) float64 { return 100 * math.Pow(1.10, y) })

	r3, ok := Return(points, P3Y)
	if !ok {
		t.Fatal("3y return should be available")
	}
	approx(t, "3y CAGR", r3, 10, 0.05)

	r5, _ := Return(points, P5Y)
	approx(t, "5y CAGR", r5, 10, 0.05)

	r1, _ := Return(points, P1Y)
	approx(t, "1y return", r1, 10, 0.1)
}

func TestShortSeriesCannotReportLongPeriods(t *testing.T) {
	points := series(day(2025, 1, 1), day(2025, 6, 30), func(float64) float64 { return 100 })

	if _, ok := Return(points, P1Y); ok {
		t.Error("1y return must be unavailable for a 6-month series")
	}
	if _, ok := Return(points, P3M); !ok {
		t.Error("3m return should be available")
	}
}

func TestSeriesStartingJustAfterThePeriodMarkStillCounts(t *testing.T) {
	// Like a provider's "5y" range: begins three days after the exact five-year mark.
	end := day(2026, 10, 19)
	points := series(end.AddDate(-5, 0, 3), end, func(y float64) float64 { return 100 * math.Pow(1.12, y) })

	r5, ok := Return(points, P5Y)
	if !ok {
		t.Fatal("5y return should be available within the tolerance")
	}
	approx(t, "5y CAGR", r5, 12, 0.05)

	tooShort := series(end.AddDate(-5, 0, 30), end, func(float64) float64 { return 100 })
	if _, ok := Return(tooShort, P5Y); ok {
		t.Error("a series starting a month late must not report a 5y return")
	}
}

func TestYTDUsesLastCloseOfPreviousYear(t *testing.T) {
	points := []Point{
		{day(2024, 12, 30), 90},
		{day(2024, 12, 31), 100}, // base
		{day(2025, 1, 2), 104},
		{day(2025, 3, 3), 110},
	}

	r, ok := Return(points, PYTD)
	if !ok {
		t.Fatal("ytd should be available")
	}
	approx(t, "ytd", r, 10, 1e-9)
}

func TestOneDayReturnUsesPreviousPoint(t *testing.T) {
	points := []Point{{day(2025, 3, 3), 200}, {day(2025, 3, 4), 190}}

	r, _ := Return(points, P1D)
	approx(t, "1d", r, -5, 1e-9)
}

func TestSteadyGrowthHasNearZeroVolatility(t *testing.T) {
	points := series(day(2024, 1, 1), day(2025, 6, 30), func(y float64) float64 { return 100 * math.Pow(1.2, y) })

	vol, ok := Volatility(points)
	if !ok {
		t.Fatal("volatility should be available")
	}
	// Weekends make daily steps slightly uneven, so not exactly zero.
	if vol > 1 {
		t.Errorf("volatility = %.3f%%, want close to 0 for a smooth series", vol)
	}
}

func TestChoppySeriesHasHigherVolatilityThanSmoothOne(t *testing.T) {
	smooth := series(day(2024, 1, 1), day(2025, 6, 30), func(y float64) float64 { return 100 + 10*y })
	i := 0
	choppy := series(day(2024, 1, 1), day(2025, 6, 30), func(y float64) float64 {
		i++
		if i%2 == 0 {
			return 100 + 10*y + 3
		}
		return 100 + 10*y - 3
	})

	vs, _ := Volatility(smooth)
	vc, _ := Volatility(choppy)
	if vc <= vs*5 {
		t.Errorf("choppy volatility %.2f should dwarf smooth volatility %.2f", vc, vs)
	}
}

func TestMaxDrawdownIsWorstPeakToTrough(t *testing.T) {
	values := []float64{100, 120, 90, 130, 117}
	// A flat year, then the shape we care about.
	points := series(day(2024, 1, 1), day(2024, 12, 31), func(float64) float64 { return 100 })
	for i, v := range values {
		points = append(points, Point{day(2025, 1, 10).AddDate(0, 0, i), v})
	}

	dd, ok := MaxDrawdown(points)
	if !ok {
		t.Fatal("drawdown should be available")
	}
	approx(t, "max drawdown", dd, -25, 1e-9) // 120 -> 90
}

func TestUpMonthsCountsMonthEndCloses(t *testing.T) {
	// Month-end closes rise every month except March and July.
	closes := map[time.Month]float64{1: 100, 2: 105, 3: 101, 4: 106, 5: 110, 6: 112, 7: 108, 8: 115, 9: 118, 10: 120, 11: 125, 12: 130}
	var points []Point
	points = append(points, Point{day(2024, 12, 31), 95})
	for m := time.January; m <= time.December; m++ {
		points = append(points, Point{day(2025, m, 10), 1}) // mid-month noise is ignored
		points = append(points, Point{day(2025, m, 28), closes[m]})
	}

	up, total := UpMonths(points, 12)
	if up != 10 || total != 12 {
		t.Errorf("up months = %d/%d, want 10/12", up, total)
	}
}

func TestOneYearStatsNeedAFullYearOfHistory(t *testing.T) {
	i := 0
	young := series(day(2025, 6, 1), day(2025, 12, 31), func(y float64) float64 {
		i++
		return 100 + float64(i%5)
	})

	if _, ok := Volatility(young); ok {
		t.Error("volatility must be unavailable for a seven-month series")
	}
	if _, ok := MaxDrawdown(young); ok {
		t.Error("drawdown must be unavailable for a seven-month series")
	}
}

func TestComputeFillsEveryPeriodKey(t *testing.T) {
	points := series(day(2025, 1, 1), day(2025, 6, 30), func(y float64) float64 { return 100 + y })

	m := Compute(points)

	for _, p := range Periods {
		if _, present := m.Returns[p]; !present {
			t.Errorf("period %s missing from returns map", p)
		}
	}
	if m.Returns[P5Y] != nil {
		t.Error("5y should be nil for a half-year series")
	}
	if m.AsOf != "2025-06-30" {
		t.Errorf("asOf = %s", m.AsOf)
	}
}

func TestRiskAdjustedIsReturnOverVolatility(t *testing.T) {
	i := 0
	points := series(day(2024, 1, 1), day(2025, 6, 30), func(y float64) float64 {
		i++
		return 100*math.Pow(1.15, y) + float64(i%3)
	})

	m := Compute(points)

	if m.RiskAdjusted1y == nil || m.Volatility1y == nil || m.Returns[P1Y] == nil {
		t.Fatal("risk-adjusted inputs should be available")
	}
	approx(t, "risk adjusted", *m.RiskAdjusted1y, *m.Returns[P1Y] / *m.Volatility1y, 0.02)
}
