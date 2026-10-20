package market

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/abhishek-pandey7/folio/services/market/internal/cache"
)

// Data sources the service composes. Each is satisfied by a live provider and
// by the mock, so the mode switch is pure wiring in main.
type QuoteSource interface {
	Quote(ctx context.Context, symbol string) (Quote, error)
	History(ctx context.Context, symbol string, rng Range) (History, error)
	Search(ctx context.Context, query string) ([]SymbolMatch, error)
}

type FxSource interface {
	Rate(ctx context.Context, base, quote string) (FxRate, error)
}

type FundSource interface {
	Fund(ctx context.Context, schemeCode string) (Fund, error)
	SearchFunds(ctx context.Context, query string) ([]FundMatch, error)
}

type Config struct {
	QuoteTTL time.Duration
	// BatchConcurrency caps upstream calls in flight for one batch request.
	BatchConcurrency int
}

const MaxBatchSymbols = 50

// Service validates input, then serves every read through a cache sized to how
// often that data actually changes: quotes tick, NAVs and FX rates are daily.
type Service struct {
	quotes QuoteSource
	fx     FxSource
	funds  FundSource
	cfg    Config

	quoteCache      *cache.Cache[Quote]
	historyCache    *cache.Cache[History]
	searchCache     *cache.Cache[[]SymbolMatch]
	fxCache         *cache.Cache[FxRate]
	fundCache       *cache.Cache[Fund]
	fundSearchCache *cache.Cache[[]FundMatch]
}

func NewService(quotes QuoteSource, fx FxSource, funds FundSource, cfg Config) *Service {
	if cfg.BatchConcurrency <= 0 {
		cfg.BatchConcurrency = 8
	}
	return &Service{
		quotes: quotes,
		fx:     fx,
		funds:  funds,
		cfg:    cfg,

		quoteCache:      cache.New[Quote](cache.Options{TTL: cfg.QuoteTTL, StaleFor: 24 * time.Hour, MaxEntries: 5000}),
		historyCache:    cache.New[History](cache.Options{TTL: time.Hour, StaleFor: 24 * time.Hour, MaxEntries: 1000}),
		searchCache:     cache.New[[]SymbolMatch](cache.Options{TTL: 24 * time.Hour, MaxEntries: 2000}),
		fxCache:         cache.New[FxRate](cache.Options{TTL: time.Hour, StaleFor: 72 * time.Hour, MaxEntries: 100}),
		fundCache:       cache.New[Fund](cache.Options{TTL: time.Hour, StaleFor: 72 * time.Hour, MaxEntries: 5000}),
		fundSearchCache: cache.New[[]FundMatch](cache.Options{TTL: 24 * time.Hour, MaxEntries: 2000}),
	}
}

func (s *Service) Quote(ctx context.Context, rawSymbol string) (Quote, error) {
	symbol, err := NormalizeSymbol(rawSymbol)
	if err != nil {
		return Quote{}, err
	}
	q, stale, err := s.quoteCache.Get(ctx, symbol, func(ctx context.Context) (Quote, error) {
		return s.quotes.Quote(ctx, symbol)
	})
	q.Stale = stale
	return q, err
}

type BatchQuotes struct {
	Quotes []Quote `json:"quotes"`
	// Errors maps each symbol that could not be priced to the reason, so one
	// bad ticker never fails a whole portfolio valuation.
	Errors map[string]string `json:"errors"`
}

// Quotes prices many symbols concurrently, bounded by BatchConcurrency.
// Results keep the order symbols were requested in.
func (s *Service) Quotes(ctx context.Context, rawSymbols []string) (BatchQuotes, error) {
	if len(rawSymbols) == 0 {
		return BatchQuotes{}, fmt.Errorf("%w: at least one symbol is required", ErrInvalid)
	}
	if len(rawSymbols) > MaxBatchSymbols {
		return BatchQuotes{}, fmt.Errorf("%w: at most %d symbols per request", ErrInvalid, MaxBatchSymbols)
	}

	result := BatchQuotes{Quotes: []Quote{}, Errors: map[string]string{}}
	seen := make(map[string]bool, len(rawSymbols))
	symbols := make([]string, 0, len(rawSymbols))
	for _, raw := range rawSymbols {
		symbol, err := NormalizeSymbol(raw)
		if err != nil {
			result.Errors[strings.TrimSpace(raw)] = err.Error()
			continue
		}
		if !seen[symbol] {
			seen[symbol] = true
			symbols = append(symbols, symbol)
		}
	}

	quotes := make([]*Quote, len(symbols))
	var mu sync.Mutex
	var g errgroup.Group
	g.SetLimit(s.cfg.BatchConcurrency)
	for i, symbol := range symbols {
		g.Go(func() error {
			q, err := s.Quote(ctx, symbol)
			if err != nil {
				mu.Lock()
				result.Errors[symbol] = err.Error()
				mu.Unlock()
				return nil
			}
			quotes[i] = &q
			return nil
		})
	}
	_ = g.Wait() // goroutines never return errors; failures are reported per symbol

	for _, q := range quotes {
		if q != nil {
			result.Quotes = append(result.Quotes, *q)
		}
	}
	return result, nil
}

func (s *Service) History(ctx context.Context, rawSymbol, rawRange string) (History, error) {
	symbol, err := NormalizeSymbol(rawSymbol)
	if err != nil {
		return History{}, err
	}
	rng, err := ParseRange(rawRange)
	if err != nil {
		return History{}, err
	}
	h, _, err := s.historyCache.Get(ctx, symbol+"|"+string(rng), func(ctx context.Context) (History, error) {
		return s.quotes.History(ctx, symbol, rng)
	})
	return h, err
}

func (s *Service) Search(ctx context.Context, rawQuery string) ([]SymbolMatch, error) {
	query, err := NormalizeQuery(rawQuery)
	if err != nil {
		return nil, err
	}
	matches, _, err := s.searchCache.Get(ctx, strings.ToLower(query), func(ctx context.Context) ([]SymbolMatch, error) {
		return s.quotes.Search(ctx, query)
	})
	return matches, err
}

func (s *Service) FxRate(ctx context.Context, rawBase, rawQuote string) (FxRate, error) {
	base, err := NormalizeCurrency(rawBase)
	if err != nil {
		return FxRate{}, err
	}
	quote, err := NormalizeCurrency(rawQuote)
	if err != nil {
		return FxRate{}, err
	}
	if base == quote {
		return FxRate{Base: base, Quote: quote, Rate: "1", Date: time.Now().UTC().Format(time.DateOnly), Source: "identity"}, nil
	}
	rate, stale, err := s.fxCache.Get(ctx, base+"/"+quote, func(ctx context.Context) (FxRate, error) {
		return s.fx.Rate(ctx, base, quote)
	})
	rate.Stale = stale
	return rate, err
}

func (s *Service) Fund(ctx context.Context, rawCode string) (Fund, error) {
	code, err := NormalizeSchemeCode(rawCode)
	if err != nil {
		return Fund{}, err
	}
	f, stale, err := s.fundCache.Get(ctx, code, func(ctx context.Context) (Fund, error) {
		return s.funds.Fund(ctx, code)
	})
	f.Stale = stale
	return f, err
}

func (s *Service) SearchFunds(ctx context.Context, rawQuery string) ([]FundMatch, error) {
	query, err := NormalizeQuery(rawQuery)
	if err != nil {
		return nil, err
	}
	matches, _, err := s.fundSearchCache.Get(ctx, strings.ToLower(query), func(ctx context.Context) ([]FundMatch, error) {
		return s.funds.SearchFunds(ctx, query)
	})
	return matches, err
}

func (s *Service) CacheStats() map[string]cache.Stats {
	return map[string]cache.Stats{
		"quotes":     s.quoteCache.Stats(),
		"history":    s.historyCache.Stats(),
		"search":     s.searchCache.Stats(),
		"fx":         s.fxCache.Stats(),
		"funds":      s.fundCache.Stats(),
		"fundSearch": s.fundSearchCache.Stats(),
	}
}
