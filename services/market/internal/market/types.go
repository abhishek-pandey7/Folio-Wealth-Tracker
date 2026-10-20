// Package market defines the gateway's domain types, errors and the caching
// service that sits between HTTP handlers and upstream data providers.
package market

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/analytics"
)

// Sentinel errors. Providers wrap these so the HTTP layer can map them to
// status codes without knowing anything about a specific upstream.
var (
	ErrInvalid     = errors.New("invalid request")
	ErrNotFound    = errors.New("not found")
	ErrUnsupported = errors.New("unsupported")
	ErrUpstream    = errors.New("upstream failure")
)

// Money and prices are decimal strings on the wire, never floats: the same
// contract the TypeScript side enforces with zod.
type Quote struct {
	Symbol        string    `json:"symbol"`
	Currency      string    `json:"currency"`
	Price         string    `json:"price"`
	Change        string    `json:"change"`
	ChangePercent string    `json:"changePercent"`
	PreviousClose string    `json:"previousClose"`
	AsOf          time.Time `json:"asOf"`
	Source        string    `json:"source"`
	// Stale is true when the upstream failed and a previously cached quote was served instead.
	Stale bool `json:"stale"`
}

type PricePoint struct {
	Date  string `json:"date"` // YYYY-MM-DD
	Close string `json:"close"`
}

type History struct {
	Symbol   string       `json:"symbol"`
	Currency string       `json:"currency"`
	Range    Range        `json:"range"`
	Interval string       `json:"interval"`
	Points   []PricePoint `json:"points"`
	Source   string       `json:"source"`
}

type SymbolMatch struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Exchange string `json:"exchange"`
	Type     string `json:"type"`
}

type FxRate struct {
	Base   string `json:"base"`
	Quote  string `json:"quote"`
	Rate   string `json:"rate"`
	Date   string `json:"date"`
	Source string `json:"source"`
	Stale  bool   `json:"stale"`
}

// Fund is an Indian mutual fund scheme, priced once a day by its NAV.
type Fund struct {
	SchemeCode string `json:"schemeCode"`
	Name       string `json:"name"`
	FundHouse  string `json:"fundHouse"`
	Category   string `json:"category"`
	Nav        string `json:"nav"`
	NavDate    string `json:"navDate"`
	Source     string `json:"source"`
	Stale      bool   `json:"stale"`
}

type FundMatch struct {
	SchemeCode string `json:"schemeCode"`
	Name       string `json:"name"`
}

// Range is a lookback window for price history.
type Range string

var rangeIntervals = map[Range]string{
	"1mo": "1d",
	"3mo": "1d",
	"6mo": "1d",
	"1y":  "1d",
	"5y":  "1wk",
}

func ParseRange(raw string) (Range, error) {
	if raw == "" {
		return "1y", nil
	}
	r := Range(raw)
	if _, ok := rangeIntervals[r]; !ok {
		return "", fmt.Errorf("%w: range must be one of 1mo, 3mo, 6mo, 1y, 5y", ErrInvalid)
	}
	return r, nil
}

// Interval is the bar size that keeps a range at a few hundred points at most.
func (r Range) Interval() string {
	return rangeIntervals[r]
}

// Yahoo-style notation covers every market with one format:
// AAPL, VTI, RELIANCE.NS (NSE), 500325.BO (BSE), M&M.NS, ^NSEI (index).
var symbolPattern = regexp.MustCompile(`^\^?[A-Z0-9][A-Z0-9.&-]{0,19}$`)

func NormalizeSymbol(raw string) (string, error) {
	symbol := strings.ToUpper(strings.TrimSpace(raw))
	if !symbolPattern.MatchString(symbol) {
		return "", fmt.Errorf("%w: invalid ticker symbol %q", ErrInvalid, raw)
	}
	return symbol, nil
}

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

func NormalizeCurrency(raw string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if !currencyPattern.MatchString(code) {
		return "", fmt.Errorf("%w: invalid currency code %q", ErrInvalid, raw)
	}
	return code, nil
}

// Portfolio math downstream only handles these; anything else is rejected
// explicitly rather than silently mixed into INR/USD totals.
var supportedQuoteCurrencies = map[string]bool{"INR": true, "USD": true}

func CheckQuoteCurrency(symbol, currency string) error {
	if !supportedQuoteCurrencies[currency] {
		return fmt.Errorf("%w: %s trades in %s; only INR and USD are supported", ErrUnsupported, symbol, currency)
	}
	return nil
}

var schemeCodePattern = regexp.MustCompile(`^\d{1,8}$`)

func NormalizeSchemeCode(raw string) (string, error) {
	code := strings.TrimSpace(raw)
	if !schemeCodePattern.MatchString(code) {
		return "", fmt.Errorf("%w: invalid mutual fund scheme code %q", ErrInvalid, raw)
	}
	return code, nil
}

// NormalizeQuery validates free-text search input.
func NormalizeQuery(raw string) (string, error) {
	q := strings.TrimSpace(raw)
	if len(q) < 2 || len(q) > 64 {
		return "", fmt.Errorf("%w: search query must be 2 to 64 characters", ErrInvalid)
	}
	return q, nil
}

// DailySeries is up to five years of daily closes for one symbol, adjusted for
// splits and dividends so that returns computed from it are total returns.
type DailySeries struct {
	Symbol   string
	Name     string
	Exchange string
	Currency string
	Price    string // latest traded price, decimal string
	High52w  *float64
	Low52w   *float64
	Points   []analytics.Point
}

// Scheme is one row of AMFI's NAV file.
type Scheme struct {
	Code      string
	Name      string
	FundHouse string
	Category  string // AMFI heading, e.g. "Equity Scheme - Large Cap Fund"
	Plan      string
	Option    string
	Nav       string
	NavDate   time.Time
}

// NavSeries is a mutual fund's full NAV history, oldest first.
type NavSeries struct {
	SchemeCode string
	Name       string
	FundHouse  string
	Category   string
	Nav        string
	NavDate    string
	Points     []analytics.Point
}

// SymbolStats is everything the screener and stock page show about a symbol.
type SymbolStats struct {
	Symbol   string   `json:"symbol"`
	Name     string   `json:"name"`
	Exchange string   `json:"exchange"`
	Currency string   `json:"currency"`
	Sector   string   `json:"sector"`
	Price    string   `json:"price"`
	High52w  *float64 `json:"high52w"`
	Low52w   *float64 `json:"low52w"`
	// FromHigh52w is how far the price is below its 52-week high, in percent (zero or negative).
	FromHigh52w *float64          `json:"fromHigh52w"`
	Metrics     analytics.Metrics `json:"metrics"`
}

// FundStats is everything the fund screener and fund page show about a scheme.
type FundStats struct {
	SchemeCode string            `json:"schemeCode"`
	Name       string            `json:"name"`
	FundHouse  string            `json:"fundHouse"`
	Category   string            `json:"category"`
	Nav        string            `json:"nav"`
	NavDate    string            `json:"navDate"`
	Metrics    analytics.Metrics `json:"metrics"`
}
