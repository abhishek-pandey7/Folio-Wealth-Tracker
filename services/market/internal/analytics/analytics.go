// Package analytics computes performance and risk statistics from a price (or
// NAV) series. Statistics are float64 on purpose: returns, volatility and
// drawdowns are ratios and estimates, not money, and floating point is the
// right tool for them. Money itself stays in decimals everywhere else.
package analytics

import (
	"fmt"
	"math"
	"sort"
	"time"
)

type Point struct {
	Date  time.Time
	Value float64
}

type Period string

const (
	P1D  Period = "1d"
	P1W  Period = "1w"
	P1M  Period = "1m"
	P3M  Period = "3m"
	P6M  Period = "6m"
	PYTD Period = "ytd"
	P1Y  Period = "1y"
	P3Y  Period = "3y"
	P5Y  Period = "5y"
)

var Periods = []Period{P1D, P1W, P1M, P3M, P6M, PYTD, P1Y, P3Y, P5Y}

var ErrInvalidPeriod = fmt.Errorf("period must be one of 1d, 1w, 1m, 3m, 6m, ytd, 1y, 3y, 5y")

func ParsePeriod(raw string) (Period, error) {
	for _, p := range Periods {
		if string(p) == raw {
			return p, nil
		}
	}
	return "", ErrInvalidPeriod
}

// Annualized reports whether returns for this period are expressed as CAGR.
// Multi-year totals are misleading to compare, so 3y and 5y are per-year rates.
func (p Period) Annualized() bool { return p == P3Y || p == P5Y }

func (p Period) start(ref time.Time) time.Time {
	switch p {
	case P1W:
		return ref.AddDate(0, 0, -7)
	case P1M:
		return ref.AddDate(0, -1, 0)
	case P3M:
		return ref.AddDate(0, -3, 0)
	case P6M:
		return ref.AddDate(0, -6, 0)
	case PYTD:
		// The base is the last close of the previous year.
		return time.Date(ref.Year(), 1, 1, 0, 0, 0, 0, ref.Location()).Add(-time.Nanosecond)
	case P1Y:
		return ref.AddDate(-1, 0, 0)
	case P3Y:
		return ref.AddDate(-3, 0, 0)
	case P5Y:
		return ref.AddDate(-5, 0, 0)
	}
	return ref
}

// baseTolerance is how far after a period's start the first point may fall
// and still be used as the base (covers holidays and provider range edges).
const baseTolerance = 7 * 24 * time.Hour

// indexAtOrBefore returns the last index whose date is <= t, or -1.
func indexAtOrBefore(points []Point, t time.Time) int {
	return sort.Search(len(points), func(i int) bool { return points[i].Date.After(t) }) - 1
}

// Return is the percentage change over p, ending at the last point. ok is
// false when the series does not reach back far enough to measure it.
func Return(points []Point, p Period) (float64, bool) {
	n := len(points)
	if n < 2 {
		return 0, false
	}
	last := points[n-1]

	var base Point
	if p == P1D {
		base = points[n-2]
	} else {
		start := p.start(last.Date)
		switch i := indexAtOrBefore(points, start); {
		case i >= 0:
			base = points[i]
		case points[0].Date.Sub(start) <= baseTolerance:
			// Providers' "5y" ranges often begin a few days after the exact
			// mark. CAGR below uses the real base date, so this stays accurate.
			base = points[0]
		default:
			return 0, false
		}
	}
	if base.Value <= 0 || !base.Date.Before(last.Date) {
		return 0, false
	}

	growth := last.Value / base.Value
	if p.Annualized() {
		years := last.Date.Sub(base.Date).Hours() / 24 / 365.25
		return (math.Pow(growth, 1/years) - 1) * 100, true
	}
	return (growth - 1) * 100, true
}

// lastYear returns the points from (one year before the last point) onward,
// including the base point at or before that date. It returns nil when the
// series does not cover a full year: a fund launched four months ago must not
// be ranked "steadiest" against funds measured over twelve.
func lastYear(points []Point) []Point {
	if len(points) == 0 {
		return nil
	}
	yearAgo := points[len(points)-1].Date.AddDate(-1, 0, 0)
	if points[0].Date.Sub(yearAgo) > baseTolerance {
		return nil
	}
	i := max(indexAtOrBefore(points, yearAgo), 0)
	return points[i:]
}

// tradingDaysPerYear annualizes daily volatility. Indian and US markets both
// trade roughly 250 days a year, and so do daily NAV publications.
const tradingDaysPerYear = 252

// minPointsForStats keeps volatility and drawdown from being reported on a
// handful of points, where they would be noise.
const minPointsForStats = 40

// Volatility is the annualized standard deviation of daily log returns over
// the last year, in percent. Higher means a bumpier ride.
func Volatility(points []Point) (float64, bool) {
	w := lastYear(points)
	if len(w) < minPointsForStats {
		return 0, false
	}
	returns := make([]float64, 0, len(w)-1)
	for i := 1; i < len(w); i++ {
		if w[i-1].Value > 0 && w[i].Value > 0 {
			returns = append(returns, math.Log(w[i].Value/w[i-1].Value))
		}
	}
	if len(returns) < 2 {
		return 0, false
	}
	var mean float64
	for _, r := range returns {
		mean += r
	}
	mean /= float64(len(returns))
	var variance float64
	for _, r := range returns {
		variance += (r - mean) * (r - mean)
	}
	variance /= float64(len(returns) - 1)
	return math.Sqrt(variance) * math.Sqrt(tradingDaysPerYear) * 100, true
}

// MaxDrawdown is the worst peak-to-trough fall over the last year, in percent
// (zero or negative): "the most you would have been down at any point".
func MaxDrawdown(points []Point) (float64, bool) {
	w := lastYear(points)
	if len(w) < minPointsForStats {
		return 0, false
	}
	peak, worst := w[0].Value, 0.0
	for _, p := range w {
		peak = math.Max(peak, p.Value)
		if peak > 0 {
			worst = math.Min(worst, p.Value/peak-1)
		}
	}
	return worst * 100, true
}

// UpMonths counts how many of the last n calendar months closed higher than
// the month before. The current, partial month counts as a month.
func UpMonths(points []Point, n int) (up, total int) {
	var ends []Point
	for _, p := range points {
		if k := len(ends); k > 0 && ends[k-1].Date.Year() == p.Date.Year() && ends[k-1].Date.Month() == p.Date.Month() {
			ends[k-1] = p
		} else {
			ends = append(ends, p)
		}
	}
	for i := max(1, len(ends)-n); i < len(ends); i++ {
		total++
		if ends[i].Value > ends[i-1].Value {
			up++
		}
	}
	return up, total
}

// Metrics is everything the screener and detail pages show about one series.
// Pointers are nil when the series is too short to measure that statistic.
type Metrics struct {
	AsOf string `json:"asOf"`
	// Returns maps each period to a percentage; 3y and 5y are annualized (CAGR).
	Returns       map[Period]*float64 `json:"returns"`
	Volatility1y  *float64            `json:"volatility1y"`
	MaxDrawdown1y *float64            `json:"maxDrawdown1y"`
	// RiskAdjusted1y is the 1-year return divided by 1-year volatility: return per unit of risk.
	RiskAdjusted1y *float64 `json:"riskAdjusted1y"`
	UpMonths       int      `json:"upMonths"`
	Months         int      `json:"months"`
}

func Compute(points []Point) Metrics {
	m := Metrics{Returns: make(map[Period]*float64, len(Periods))}
	if len(points) > 0 {
		m.AsOf = points[len(points)-1].Date.Format(time.DateOnly)
	}
	for _, p := range Periods {
		if r, ok := Return(points, p); ok {
			m.Returns[p] = round(r, 2)
		} else {
			m.Returns[p] = nil
		}
	}
	vol, volOK := Volatility(points)
	if volOK {
		m.Volatility1y = round(vol, 2)
	}
	if dd, ok := MaxDrawdown(points); ok {
		m.MaxDrawdown1y = round(dd, 2)
	}
	if r1y := m.Returns[P1Y]; r1y != nil && volOK && vol > 0 {
		m.RiskAdjusted1y = round(*r1y/vol, 2)
	}
	m.UpMonths, m.Months = UpMonths(points, 12)
	return m
}

func round(v float64, places int) *float64 {
	f := math.Pow(10, float64(places))
	r := math.Round(v*f) / f
	return &r
}
