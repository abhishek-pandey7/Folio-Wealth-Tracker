// Package mock implements every data source with deterministic fake data, so
// the whole stack runs offline, in CI, and in demos without network access.
package mock

import (
	"context"
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"github.com/abhishek-pandey7/folio/services/market/internal/analytics"
	"github.com/abhishek-pandey7/folio/services/market/internal/market"
)

const source = "mock"

type Provider struct{}

func New() *Provider { return &Provider{} }

func (p *Provider) Quote(_ context.Context, symbol string) (market.Quote, error) {
	seed := hash(symbol)
	prev := basePrice(symbol, seed)
	minutes := float64(time.Now().Unix()) / 60
	price := prev.Mul(decimal.NewFromFloat(1 + 0.02*math.Sin(minutes/30+float64(seed%100)))).Round(2)
	change := price.Sub(prev)

	return market.Quote{
		Symbol:        symbol,
		Currency:      currencyOf(symbol),
		Price:         price.StringFixed(2),
		Change:        change.StringFixed(2),
		ChangePercent: change.Div(prev).Mul(decimal.NewFromInt(100)).StringFixed(2),
		PreviousClose: prev.StringFixed(2),
		AsOf:          time.Now().UTC(),
		Source:        source,
	}, nil
}

var pointsPerRange = map[market.Range]int{"1mo": 22, "3mo": 66, "6mo": 130, "1y": 252, "5y": 260}

func (p *Provider) History(_ context.Context, symbol string, rng market.Range) (market.History, error) {
	seed := hash(symbol)
	rnd := rand.New(rand.NewPCG(seed, seed>>7))
	count := pointsPerRange[rng]
	step := 24 * time.Hour
	if rng.Interval() == "1wk" {
		step = 7 * 24 * time.Hour
	}

	// A seeded random walk ending near today's mock price.
	price, _ := basePrice(symbol, seed).Float64()
	closes := make([]float64, count)
	for i := count - 1; i >= 0; i-- {
		closes[i] = price
		price /= 1 + rnd.NormFloat64()*0.012 + 0.0003
	}

	points := make([]market.PricePoint, count)
	day := time.Now().UTC().Truncate(24 * time.Hour)
	for i := count - 1; i >= 0; i-- {
		for step == 24*time.Hour && (day.Weekday() == time.Saturday || day.Weekday() == time.Sunday) {
			day = day.Add(-24 * time.Hour)
		}
		points[i] = market.PricePoint{Date: day.Format(time.DateOnly), Close: decimal.NewFromFloat(closes[i]).StringFixed(2)}
		day = day.Add(-step)
	}

	return market.History{
		Symbol: symbol, Currency: currencyOf(symbol), Range: rng, Interval: rng.Interval(), Points: points, Source: source,
	}, nil
}

var catalog = []market.SymbolMatch{
	{Symbol: "RELIANCE.NS", Name: "Reliance Industries Limited", Exchange: "NSE", Type: "equity"},
	{Symbol: "TCS.NS", Name: "Tata Consultancy Services Limited", Exchange: "NSE", Type: "equity"},
	{Symbol: "INFY.NS", Name: "Infosys Limited", Exchange: "NSE", Type: "equity"},
	{Symbol: "HDFCBANK.NS", Name: "HDFC Bank Limited", Exchange: "NSE", Type: "equity"},
	{Symbol: "NIFTYBEES.NS", Name: "Nippon India ETF Nifty 50 BeES", Exchange: "NSE", Type: "etf"},
	{Symbol: "AAPL", Name: "Apple Inc.", Exchange: "NASDAQ", Type: "equity"},
	{Symbol: "MSFT", Name: "Microsoft Corporation", Exchange: "NASDAQ", Type: "equity"},
	{Symbol: "VTI", Name: "Vanguard Total Stock Market ETF", Exchange: "NYSEArca", Type: "etf"},
}

func (p *Provider) Search(_ context.Context, query string) ([]market.SymbolMatch, error) {
	q := strings.ToLower(query)
	matches := []market.SymbolMatch{}
	for _, m := range catalog {
		if strings.Contains(strings.ToLower(m.Symbol), q) || strings.Contains(strings.ToLower(m.Name), q) {
			matches = append(matches, m)
		}
	}
	return matches, nil
}

var usdRates = map[string]decimal.Decimal{"USD": decimal.NewFromInt(1), "INR": decimal.RequireFromString("88.25")}

func (p *Provider) Rate(_ context.Context, base, quote string) (market.FxRate, error) {
	b, okBase := usdRates[base]
	q, okQuote := usdRates[quote]
	if !okBase || !okQuote {
		return market.FxRate{}, fmt.Errorf("%w: mock has no %s/%s rate", market.ErrNotFound, base, quote)
	}
	return market.FxRate{
		Base: base, Quote: quote, Rate: q.DivRound(b, 6).String(), Date: time.Now().UTC().Format(time.DateOnly), Source: source,
	}, nil
}

var funds = []struct {
	market.FundMatch
	house string
}{
	{market.FundMatch{SchemeCode: "122639", Name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth"}, "PPFAS Mutual Fund"},
	{market.FundMatch{SchemeCode: "120716", Name: "UTI Nifty 50 Index Fund - Direct Plan - Growth"}, "UTI Mutual Fund"},
	{market.FundMatch{SchemeCode: "118989", Name: "HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth"}, "HDFC Mutual Fund"},
}

func (p *Provider) Fund(ctx context.Context, code string) (market.Fund, error) {
	series, err := p.FundHistory(ctx, code)
	if err != nil {
		return market.Fund{}, err
	}
	return market.Fund{
		SchemeCode: code, Name: series.Name, FundHouse: series.FundHouse, Category: series.Category,
		Nav: series.Nav, NavDate: series.NavDate, Source: source,
	}, nil
}

// DailySeries is a seeded random walk over five years of weekdays, ending at
// the symbol's mock price, so screens have realistic-looking spread.
func (p *Provider) DailySeries(_ context.Context, symbol string) (market.DailySeries, error) {
	seed := hash(symbol)
	end := time.Now().UTC().Truncate(24 * time.Hour)
	points := walk(seed, end.AddDate(-5, 0, 0), end, 100)

	last := points[len(points)-1].Value
	hi, lo := last, last
	for _, pt := range points {
		if pt.Date.After(end.AddDate(-1, 0, 0)) {
			hi, lo = math.Max(hi, pt.Value), math.Min(lo, pt.Value)
		}
	}
	name := symbol
	for _, m := range catalog {
		if m.Symbol == symbol {
			name = m.Name
		}
	}
	return market.DailySeries{
		Symbol: symbol, Name: name, Exchange: "Mock", Currency: currencyOf(symbol),
		Price: decimal.NewFromFloat(last).StringFixed(2), High52w: &hi, Low52w: &lo, Points: points,
	}, nil
}

// Mock fund schemes use AMFI-style headings, so the real category matching runs against them.
var mockCategories = []struct{ heading, label string }{
	{"Equity Scheme - Flexi Cap Fund", "Flexi Cap"},
	{"Equity Scheme - Large Cap Fund", "Large Cap"},
	{"Equity Scheme - Mid Cap Fund", "Mid Cap"},
	{"Equity Scheme - Small Cap Fund", "Small Cap"},
	{"Equity Scheme - Large & Mid Cap Fund", "Large & Mid Cap"},
	{"Equity Scheme - Multi Cap Fund", "Multi Cap"},
	{"Equity Scheme - ELSS", "ELSS Tax Saver"},
	{"Equity Scheme - Value Fund", "Value"},
	{"Other Scheme - Index Funds", "Nifty 50 Index"},
	{"Hybrid Scheme - Aggressive Hybrid Fund", "Aggressive Hybrid"},
	{"Hybrid Scheme - Balanced Advantage", "Balanced Advantage"},
}

var mockHouses = []string{"Aurora Mutual Fund", "Banyan Mutual Fund", "Cedar Mutual Fund"}

type mockScheme struct {
	code, name, house, category string
}

func allMockSchemes() []mockScheme {
	var out []mockScheme
	for i, c := range mockCategories {
		for j, house := range mockHouses {
			out = append(out, mockScheme{
				code:     fmt.Sprint(900000 + i*10 + j),
				name:     fmt.Sprintf("%s %s Fund - Direct Plan - Growth", strings.TrimSuffix(house, " Mutual Fund"), c.label),
				house:    house,
				category: c.heading,
			})
		}
	}
	for _, f := range funds {
		out = append(out, mockScheme{code: f.SchemeCode, name: f.Name, house: f.house, category: "Equity Scheme - Flexi Cap Fund"})
	}
	return out
}

func (p *Provider) Schemes(ctx context.Context) ([]market.Scheme, error) {
	var out []market.Scheme
	for _, s := range allMockSchemes() {
		series, err := p.FundHistory(ctx, s.code)
		if err != nil {
			return nil, err
		}
		navDate, _ := time.Parse(time.DateOnly, series.NavDate)
		out = append(out, market.Scheme{
			Code: s.code, Name: s.name, FundHouse: s.house, Category: s.category,
			Plan: "Direct Plan", Option: "Growth Option", Nav: series.Nav, NavDate: navDate,
		})
	}
	return out, nil
}

func (p *Provider) FundHistory(_ context.Context, code string) (market.NavSeries, error) {
	for _, s := range allMockSchemes() {
		if s.code != code {
			continue
		}
		end := time.Now().UTC().Truncate(24 * time.Hour)
		points := walk(hash(code), end.AddDate(-6, 0, 0), end, 10)
		last := points[len(points)-1]
		return market.NavSeries{
			SchemeCode: code, Name: s.name, FundHouse: s.house, Category: s.category,
			Nav: decimal.NewFromFloat(last.Value).StringFixed(4), NavDate: last.Date.Format(time.DateOnly), Points: points,
		}, nil
	}
	return market.NavSeries{}, fmt.Errorf("%w: no mutual fund with scheme code %s", market.ErrNotFound, code)
}

// walk generates a seeded weekday random walk with a per-seed drift and volatility.
func walk(seed uint64, start, end time.Time, startValue float64) []analytics.Point {
	rnd := rand.New(rand.NewPCG(seed, seed>>7))
	drift := (-0.05 + 0.30*rnd.Float64()) / 252 // -5% to +25% a year
	vol := (0.008 + 0.017*rnd.Float64())        // 0.8% to 2.5% a day
	value := startValue
	var points []analytics.Point
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			continue
		}
		value *= math.Exp(drift + vol*rnd.NormFloat64())
		points = append(points, analytics.Point{Date: d, Value: value})
	}
	return points
}

func (p *Provider) SearchFunds(_ context.Context, query string) ([]market.FundMatch, error) {
	q := strings.ToLower(query)
	matches := []market.FundMatch{}
	for _, f := range funds {
		if strings.Contains(strings.ToLower(f.Name), q) {
			matches = append(matches, f.FundMatch)
		}
	}
	return matches, nil
}

func basePrice(symbol string, seed uint64) decimal.Decimal {
	if currencyOf(symbol) == "INR" {
		return decimal.NewFromInt(int64(100 + seed%4900))
	}
	return decimal.NewFromInt(int64(20 + seed%480))
}

func currencyOf(symbol string) string {
	if strings.HasSuffix(symbol, ".NS") || strings.HasSuffix(symbol, ".BO") || strings.HasPrefix(symbol, "^NSE") {
		return "INR"
	}
	return "USD"
}

func hash(s string) uint64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return h.Sum64()
}
