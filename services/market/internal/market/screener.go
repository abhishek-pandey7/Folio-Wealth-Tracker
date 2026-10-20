package market

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/abhishek-pandey7/folio/services/market/internal/analytics"
	"github.com/abhishek-pandey7/folio/services/market/internal/universe"
)

// SortKey is what a screen ranks by. Each key has a natural "best" direction:
// higher returns, risk-adjusted returns and consistency are better; lower
// volatility is better; drawdowns are negative, so closer to zero is better.
type SortKey string

const (
	SortReturn       SortKey = "return"
	SortRiskAdjusted SortKey = "risk_adjusted"
	SortVolatility   SortKey = "volatility"
	SortDrawdown     SortKey = "drawdown"
	SortConsistency  SortKey = "consistency"
)

func parseSortKey(raw string) (SortKey, error) {
	switch k := SortKey(raw); k {
	case "":
		return SortReturn, nil
	case SortReturn, SortRiskAdjusted, SortVolatility, SortDrawdown, SortConsistency:
		return k, nil
	}
	return "", fmt.Errorf("%w: sort must be one of return, risk_adjusted, volatility, drawdown, consistency", ErrInvalid)
}

func parseOrder(raw string) (string, error) {
	switch raw {
	case "", "best":
		return "best", nil
	case "worst":
		return "worst", nil
	}
	return "", fmt.Errorf("%w: order must be best or worst", ErrInvalid)
}

func parsePeriod(raw string, fallback analytics.Period) (analytics.Period, error) {
	if raw == "" {
		return fallback, nil
	}
	p, err := analytics.ParsePeriod(raw)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return p, nil
}

func parseLimit(raw string) (int, error) {
	if raw == "" {
		return 20, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 100 {
		return 0, fmt.Errorf("%w: limit must be between 1 and 100", ErrInvalid)
	}
	return n, nil
}

// sortValue extracts the ranked number from metrics; nil sorts last either way.
func sortValue(m analytics.Metrics, key SortKey, period analytics.Period) *float64 {
	switch key {
	case SortReturn:
		return m.Returns[period]
	case SortRiskAdjusted:
		return m.RiskAdjusted1y
	case SortVolatility:
		return m.Volatility1y
	case SortDrawdown:
		return m.MaxDrawdown1y
	case SortConsistency:
		if m.Months == 0 {
			return nil
		}
		v := float64(m.UpMonths) / float64(m.Months) * 100
		return &v
	}
	return nil
}

func rank[T any](rows []T, metrics func(T) analytics.Metrics, id func(T) string, key SortKey, period analytics.Period, order string) {
	bestHigh := key != SortVolatility
	if order == "worst" {
		bestHigh = !bestHigh
	}
	slices.SortStableFunc(rows, func(a, b T) int {
		va, vb := sortValue(metrics(a), key, period), sortValue(metrics(b), key, period)
		switch {
		case va == nil && vb == nil:
			return cmp.Compare(id(a), id(b))
		case va == nil:
			return 1
		case vb == nil:
			return -1
		}
		c := cmp.Compare(*va, *vb)
		if bestHigh {
			c = -c
		}
		if c == 0 {
			return cmp.Compare(id(a), id(b))
		}
		return c
	})
}

// Stock statistics.

func (s *Service) loadStats(symbol string) func(context.Context) (SymbolStats, error) {
	return func(ctx context.Context) (SymbolStats, error) {
		series, err := s.quotes.DailySeries(ctx, symbol)
		if err != nil {
			return SymbolStats{}, err
		}
		if len(series.Points) < 2 {
			return SymbolStats{}, fmt.Errorf("%w: not enough price history for %s", ErrNotFound, symbol)
		}
		stats := SymbolStats{
			Symbol:   series.Symbol,
			Name:     series.Name,
			Exchange: series.Exchange,
			Currency: series.Currency,
			Sector:   universe.SectorOf(symbol),
			Price:    series.Price,
			High52w:  series.High52w,
			Low52w:   series.Low52w,
			Metrics:  analytics.Compute(series.Points),
		}
		if price, err := strconv.ParseFloat(series.Price, 64); err == nil && series.High52w != nil && *series.High52w > 0 {
			from := (price / *series.High52w - 1) * 100
			from = math.Round(from*100) / 100
			stats.FromHigh52w = &from
		}
		return stats, nil
	}
}

func (s *Service) Stats(ctx context.Context, rawSymbol string) (SymbolStats, error) {
	symbol, err := NormalizeSymbol(rawSymbol)
	if err != nil {
		return SymbolStats{}, err
	}
	stats, _, err := s.statsCache.Get(ctx, symbol, s.loadStats(symbol))
	return stats, err
}

// ScreenRow is one ranked symbol: its statistics plus today's live move.
type ScreenRow struct {
	SymbolStats
	ChangePercent *float64 `json:"changePercent"`
}

type ScreenResult struct {
	Universe *universe.Universe `json:"universe"`
	Period   analytics.Period   `json:"period"`
	Sort     SortKey            `json:"sort"`
	Order    string             `json:"order"`
	Total    int                `json:"total"`
	Rows     []ScreenRow        `json:"rows"`
	// Unavailable lists members that could not be priced (delisted, renamed, upstream errors).
	Unavailable map[string]string `json:"unavailable"`
}

type ScreenQuery struct {
	Universe string
	Symbols  []string
	Period   string
	Sort     string
	Order    string
	Limit    string
}

// Screen ranks a universe (or an explicit symbol list, such as a user's
// starred symbols) by the requested metric. Statistics come from cached
// daily history; price and today's change are overlaid from live quotes.
func (s *Service) Screen(ctx context.Context, q ScreenQuery) (ScreenResult, error) {
	period, err := parsePeriod(q.Period, analytics.P1Y)
	if err != nil {
		return ScreenResult{}, err
	}
	key, err := parseSortKey(q.Sort)
	if err != nil {
		return ScreenResult{}, err
	}
	order, err := parseOrder(q.Order)
	if err != nil {
		return ScreenResult{}, err
	}
	limit, err := parseLimit(q.Limit)
	if err != nil {
		return ScreenResult{}, err
	}

	result := ScreenResult{Period: period, Sort: key, Order: order, Unavailable: map[string]string{}}
	var symbols []string
	switch {
	case q.Universe != "":
		u, ok := universe.Get(q.Universe)
		if !ok {
			return ScreenResult{}, fmt.Errorf("%w: no universe %q", ErrNotFound, q.Universe)
		}
		result.Universe = &u
		symbols = u.Symbols()
	case len(q.Symbols) > 0:
		if len(q.Symbols) > MaxBatchSymbols {
			return ScreenResult{}, fmt.Errorf("%w: at most %d symbols per screen", ErrInvalid, MaxBatchSymbols)
		}
		seen := map[string]bool{}
		for _, raw := range q.Symbols {
			sym, err := NormalizeSymbol(raw)
			if err != nil {
				result.Unavailable[strings.TrimSpace(raw)] = err.Error()
				continue
			}
			if !seen[sym] {
				seen[sym] = true
				symbols = append(symbols, sym)
			}
		}
	default:
		return ScreenResult{}, fmt.Errorf("%w: universe or symbols is required", ErrInvalid)
	}

	rows := make([]*ScreenRow, len(symbols))
	var mu sync.Mutex
	var g errgroup.Group
	g.SetLimit(s.cfg.BatchConcurrency)
	for i, sym := range symbols {
		g.Go(func() error {
			stats, err := s.Stats(ctx, sym)
			if err != nil {
				mu.Lock()
				result.Unavailable[sym] = err.Error()
				mu.Unlock()
				return nil
			}
			row := ScreenRow{SymbolStats: stats}
			// Live overlay; the statistics are still useful if the quote fails.
			if quote, err := s.Quote(ctx, sym); err == nil {
				row.Price = quote.Price
				if pct, err := strconv.ParseFloat(quote.ChangePercent, 64); err == nil {
					row.ChangePercent = &pct
					row.Metrics.Returns = withLiveDay(row.Metrics.Returns, pct)
				}
			}
			rows[i] = &row
			return nil
		})
	}
	_ = g.Wait() // per-symbol failures are reported in Unavailable

	for _, r := range rows {
		if r != nil {
			result.Rows = append(result.Rows, *r)
		}
	}
	rank(result.Rows, func(r ScreenRow) analytics.Metrics { return r.Metrics }, func(r ScreenRow) string { return r.Symbol }, key, period, order)
	result.Total = len(result.Rows)
	if len(result.Rows) > limit {
		result.Rows = result.Rows[:limit]
	}
	if result.Rows == nil {
		result.Rows = []ScreenRow{}
	}
	return result, nil
}

// withLiveDay copies the returns map with the 1-day return replaced by the
// live quote, which is fresher than the cached daily series.
func withLiveDay(returns map[analytics.Period]*float64, pct float64) map[analytics.Period]*float64 {
	out := make(map[analytics.Period]*float64, len(returns))
	for k, v := range returns {
		out[k] = v
	}
	out[analytics.P1D] = &pct
	return out
}

func (s *Service) Universes() []universe.Universe { return universe.All() }

// Mutual funds.

func (s *Service) schemeList(ctx context.Context) ([]Scheme, error) {
	list, _, err := s.schemeListCache.Get(ctx, "all", s.schemes.Schemes)
	return list, err
}

// fundCandidates applies the category, Direct/Growth and active filters.
func fundCandidates(schemes []Scheme, cat universe.FundCategory) []Scheme {
	var newest time.Time
	for _, sc := range schemes {
		if sc.NavDate.After(newest) {
			newest = sc.NavDate
		}
	}
	// A scheme whose NAV is more than a week older than the file's newest is wound down or merged.
	activeSince := newest.AddDate(0, 0, -7)

	var out []Scheme
	for _, sc := range schemes {
		if cat.Matches(sc.Category, sc.Name) && universe.IsDirectGrowth(sc.Name, sc.Plan, sc.Option) && !sc.NavDate.Before(activeSince) {
			out = append(out, sc)
		}
	}
	slices.SortFunc(out, func(a, b Scheme) int { return cmp.Compare(a.Name, b.Name) })
	return out
}

type FundCategoryInfo struct {
	universe.FundCategory
	Count int `json:"count"`
}

func (s *Service) FundCategories(ctx context.Context) ([]FundCategoryInfo, error) {
	schemes, err := s.schemeList(ctx)
	if err != nil {
		return nil, err
	}
	cats := universe.FundCategories()
	out := make([]FundCategoryInfo, len(cats))
	for i, c := range cats {
		out[i] = FundCategoryInfo{FundCategory: c, Count: len(fundCandidates(schemes, c))}
	}
	return out, nil
}

func (s *Service) navSeries(ctx context.Context, code string) (NavSeries, error) {
	series, _, err := s.navSeriesCache.Get(ctx, code, func(ctx context.Context) (NavSeries, error) {
		return s.funds.FundHistory(ctx, code)
	})
	return series, err
}

func (s *Service) loadFundStats(code string) func(context.Context) (FundStats, error) {
	return func(ctx context.Context) (FundStats, error) {
		series, err := s.navSeries(ctx, code)
		if err != nil {
			return FundStats{}, err
		}
		if len(series.Points) < 2 {
			return FundStats{}, fmt.Errorf("%w: not enough NAV history for %s", ErrNotFound, code)
		}
		return FundStats{
			SchemeCode: series.SchemeCode,
			Name:       series.Name,
			FundHouse:  series.FundHouse,
			Category:   series.Category,
			Nav:        series.Nav,
			NavDate:    series.NavDate,
			Metrics:    analytics.Compute(series.Points),
		}, nil
	}
}

func (s *Service) FundStats(ctx context.Context, rawCode string) (FundStats, error) {
	code, err := NormalizeSchemeCode(rawCode)
	if err != nil {
		return FundStats{}, err
	}
	stats, _, err := s.fundStatsCache.Get(ctx, code, s.loadFundStats(code))
	return stats, err
}

// FundHistory returns NAV points for a chart, cut to the requested range.
func (s *Service) FundHistory(ctx context.Context, rawCode, rawRange string) (History, error) {
	code, err := NormalizeSchemeCode(rawCode)
	if err != nil {
		return History{}, err
	}
	rng, err := ParseRange(rawRange)
	if err != nil {
		return History{}, err
	}
	series, err := s.navSeries(ctx, code)
	if err != nil {
		return History{}, err
	}

	years := map[Range]float64{"1mo": 1.0 / 12, "3mo": 0.25, "6mo": 0.5, "1y": 1, "5y": 5}[rng]
	var from time.Time
	if n := len(series.Points); n > 0 {
		from = series.Points[n-1].Date.Add(-time.Duration(years * 365.25 * 24 * float64(time.Hour)))
	}
	points := []PricePoint{}
	weekly := rng.Interval() == "1wk"
	var lastWeek int
	for _, p := range series.Points {
		if p.Date.Before(from) {
			continue
		}
		// Thin five years of daily NAVs to one point a week, like stock charts.
		if _, week := p.Date.ISOWeek(); weekly && week == lastWeek && len(points) > 0 {
			points[len(points)-1] = PricePoint{Date: p.Date.Format(time.DateOnly), Close: strconv.FormatFloat(p.Value, 'f', -1, 64)}
			continue
		} else {
			lastWeek = week
		}
		points = append(points, PricePoint{Date: p.Date.Format(time.DateOnly), Close: strconv.FormatFloat(p.Value, 'f', -1, 64)})
	}
	return History{Symbol: code, Currency: "INR", Range: rng, Interval: rng.Interval(), Points: points, Source: "mfapi"}, nil
}

type FundScreenQuery struct {
	Category string
	Codes    []string
	Period   string
	Sort     string
	Order    string
	Limit    string
}

type FundScreenResult struct {
	Category    *FundCategoryInfo `json:"category"`
	Period      analytics.Period  `json:"period"`
	Sort        SortKey           `json:"sort"`
	Order       string            `json:"order"`
	Total       int               `json:"total"`
	Rows        []FundStats       `json:"rows"`
	Unavailable map[string]string `json:"unavailable"`
}

// fundScreenConcurrency is lower than stocks': mfapi is a small community service.
const fundScreenConcurrency = 4

func (s *Service) FundScreen(ctx context.Context, q FundScreenQuery) (FundScreenResult, error) {
	// Funds are long-term holdings, so the default comparison is 3-year annualized.
	period, err := parsePeriod(q.Period, analytics.P3Y)
	if err != nil {
		return FundScreenResult{}, err
	}
	key, err := parseSortKey(q.Sort)
	if err != nil {
		return FundScreenResult{}, err
	}
	order, err := parseOrder(q.Order)
	if err != nil {
		return FundScreenResult{}, err
	}
	limit, err := parseLimit(q.Limit)
	if err != nil {
		return FundScreenResult{}, err
	}

	result := FundScreenResult{Period: period, Sort: key, Order: order, Unavailable: map[string]string{}}
	var codes []string
	switch {
	case q.Category != "":
		cat, ok := universe.GetFundCategory(q.Category)
		if !ok {
			return FundScreenResult{}, fmt.Errorf("%w: no fund category %q", ErrNotFound, q.Category)
		}
		schemes, err := s.schemeList(ctx)
		if err != nil {
			return FundScreenResult{}, err
		}
		candidates := fundCandidates(schemes, cat)
		result.Category = &FundCategoryInfo{FundCategory: cat, Count: len(candidates)}
		for _, sc := range candidates {
			codes = append(codes, sc.Code)
		}
	case len(q.Codes) > 0:
		if len(q.Codes) > MaxBatchSymbols {
			return FundScreenResult{}, fmt.Errorf("%w: at most %d funds per screen", ErrInvalid, MaxBatchSymbols)
		}
		for _, raw := range q.Codes {
			code, err := NormalizeSchemeCode(raw)
			if err != nil {
				result.Unavailable[strings.TrimSpace(raw)] = err.Error()
				continue
			}
			if !slices.Contains(codes, code) {
				codes = append(codes, code)
			}
		}
	default:
		return FundScreenResult{}, fmt.Errorf("%w: category or codes is required", ErrInvalid)
	}

	rows := make([]*FundStats, len(codes))
	var mu sync.Mutex
	var g errgroup.Group
	g.SetLimit(fundScreenConcurrency)
	for i, code := range codes {
		g.Go(func() error {
			stats, err := s.FundStats(ctx, code)
			if err != nil {
				mu.Lock()
				result.Unavailable[code] = err.Error()
				mu.Unlock()
				return nil
			}
			rows[i] = &stats
			return nil
		})
	}
	_ = g.Wait()

	for _, r := range rows {
		if r != nil {
			result.Rows = append(result.Rows, *r)
		}
	}
	rank(result.Rows, func(r FundStats) analytics.Metrics { return r.Metrics }, func(r FundStats) string { return r.SchemeCode }, key, period, order)
	result.Total = len(result.Rows)
	if len(result.Rows) > limit {
		result.Rows = result.Rows[:limit]
	}
	if result.Rows == nil {
		result.Rows = []FundStats{}
	}
	return result, nil
}

// Background warming.

type WarmReport struct {
	Started    time.Time `json:"started"`
	DurationMs int64     `json:"durationMs"`
	Refreshed  int       `json:"refreshed"`
	Failed     int       `json:"failed"`
}

func (s *Service) WarmReports() map[string]WarmReport {
	s.warmMu.Lock()
	defer s.warmMu.Unlock()
	out := make(map[string]WarmReport, len(s.warm))
	for k, v := range s.warm {
		out[k] = v
	}
	return out
}

func (s *Service) recordWarm(name string, r WarmReport) {
	s.warmMu.Lock()
	s.warm[name] = r
	s.warmMu.Unlock()
}

// WarmStocks refreshes statistics for every curated symbol, so screens are
// served from cache. Refresh (not Get) renews entries before they expire.
func (s *Service) WarmStocks(ctx context.Context) WarmReport {
	report := WarmReport{Started: time.Now()}
	var mu sync.Mutex
	var g errgroup.Group
	g.SetLimit(4) // leave headroom in the upstream rate limit for user requests
	for _, sym := range universe.AllSymbols() {
		g.Go(func() error {
			_, err := s.statsCache.Refresh(ctx, sym, s.loadStats(sym))
			mu.Lock()
			if err != nil {
				report.Failed++
			} else {
				report.Refreshed++
			}
			mu.Unlock()
			return nil
		})
	}
	_ = g.Wait()
	report.DurationMs = time.Since(report.Started).Milliseconds()
	s.recordWarm("stocks", report)
	return report
}

// WarmFunds refreshes the scheme list and every category's fund statistics.
func (s *Service) WarmFunds(ctx context.Context) (report WarmReport) {
	// Named result: the deferred duration must land in the value returned.
	report = WarmReport{Started: time.Now()}
	defer func() {
		report.DurationMs = time.Since(report.Started).Milliseconds()
		s.recordWarm("funds", report)
	}()

	schemes, err := s.schemeListCache.Refresh(ctx, "all", s.schemes.Schemes)
	if err != nil {
		report.Failed++
		return report
	}
	var mu sync.Mutex
	var g errgroup.Group
	g.SetLimit(fundScreenConcurrency)
	for _, cat := range universe.FundCategories() {
		for _, sc := range fundCandidates(schemes, cat) {
			g.Go(func() error {
				if ctx.Err() != nil {
					return nil
				}
				_, err := s.navSeriesCache.Refresh(ctx, sc.Code, func(ctx context.Context) (NavSeries, error) {
					return s.funds.FundHistory(ctx, sc.Code)
				})
				if err == nil {
					_, err = s.fundStatsCache.Refresh(ctx, sc.Code, s.loadFundStats(sc.Code))
				}
				mu.Lock()
				if err != nil {
					report.Failed++
				} else {
					report.Refreshed++
				}
				mu.Unlock()
				return nil
			})
		}
	}
	_ = g.Wait()
	return report
}

// RunWarmer warms immediately and then on each interval until ctx is done.
func RunWarmer(ctx context.Context, logger *slog.Logger, name string, every time.Duration, warm func(context.Context) WarmReport) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		r := warm(ctx)
		if !errors.Is(ctx.Err(), context.Canceled) {
			logger.Info("cache warmed", "job", name, "refreshed", r.Refreshed, "failed", r.Failed, "duration_ms", r.DurationMs)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
