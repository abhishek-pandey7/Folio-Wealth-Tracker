// Package yahoo prices stocks, ETFs and indices from Yahoo Finance's public
// endpoints. They are unofficial (no SLA, undocumented), but free, keyless, and
// cover NSE, BSE and US listings with one symbol format, which no free official
// API does. The gateway's cache and stale-if-error behaviour absorb its flakiness.
package yahoo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/upstream"
)

const (
	DefaultBaseURL = "https://query1.finance.yahoo.com"
	source         = "yahoo"
)

type Provider struct {
	client  *upstream.Client
	baseURL string
}

func New(client *upstream.Client, baseURL string) *Provider {
	return &Provider{client: client, baseURL: strings.TrimRight(baseURL, "/")}
}

type chartResponse struct {
	Chart struct {
		Result []chartResult `json:"result"`
	} `json:"chart"`
}

type chartResult struct {
	Meta struct {
		Symbol             string      `json:"symbol"`
		Currency           string      `json:"currency"`
		RegularMarketPrice json.Number `json:"regularMarketPrice"`
		ChartPreviousClose json.Number `json:"chartPreviousClose"`
		RegularMarketTime  int64       `json:"regularMarketTime"`
	} `json:"meta"`
	Timestamp  []int64 `json:"timestamp"`
	Indicators struct {
		Quote []struct {
			Close []*json.Number `json:"close"`
		} `json:"quote"`
	} `json:"indicators"`
}

func (p *Provider) chart(ctx context.Context, symbol, rng, interval string) (chartResult, error) {
	u := fmt.Sprintf("%s/v8/finance/chart/%s?range=%s&interval=%s", p.baseURL, url.PathEscape(symbol), rng, interval)
	var res chartResponse
	if err := p.client.GetJSON(ctx, u, &res); err != nil {
		return chartResult{}, err
	}
	if len(res.Chart.Result) == 0 {
		return chartResult{}, fmt.Errorf("%w: no market data for %s", market.ErrNotFound, symbol)
	}
	result := res.Chart.Result[0]
	if err := market.CheckQuoteCurrency(symbol, result.Meta.Currency); err != nil {
		return chartResult{}, err
	}
	return result, nil
}

func (p *Provider) Quote(ctx context.Context, symbol string) (market.Quote, error) {
	r, err := p.chart(ctx, symbol, "1d", "1d")
	if err != nil {
		return market.Quote{}, err
	}

	price, err := parseNumber(r.Meta.RegularMarketPrice)
	if err != nil {
		return market.Quote{}, fmt.Errorf("%w: yahoo price for %s: %v", market.ErrUpstream, symbol, err)
	}
	prev, err := parseNumber(r.Meta.ChartPreviousClose)
	if err != nil {
		return market.Quote{}, fmt.Errorf("%w: yahoo previous close for %s: %v", market.ErrUpstream, symbol, err)
	}

	change := price.Sub(prev)
	changePercent := decimal.Zero
	if !prev.IsZero() {
		changePercent = change.Div(prev).Mul(decimal.NewFromInt(100))
	}

	return market.Quote{
		Symbol:        r.Meta.Symbol,
		Currency:      r.Meta.Currency,
		Price:         price.String(),
		Change:        change.String(),
		ChangePercent: changePercent.StringFixed(2),
		PreviousClose: prev.String(),
		AsOf:          time.Unix(r.Meta.RegularMarketTime, 0).UTC(),
		Source:        source,
	}, nil
}

func (p *Provider) History(ctx context.Context, symbol string, rng market.Range) (market.History, error) {
	r, err := p.chart(ctx, symbol, string(rng), rng.Interval())
	if err != nil {
		return market.History{}, err
	}

	var closes []*json.Number
	if len(r.Indicators.Quote) > 0 {
		closes = r.Indicators.Quote[0].Close
	}

	points := make([]market.PricePoint, 0, len(r.Timestamp))
	for i, ts := range r.Timestamp {
		// Yahoo pads holidays and halts with null closes.
		if i >= len(closes) || closes[i] == nil {
			continue
		}
		price, err := parseNumber(*closes[i])
		if err != nil {
			continue
		}
		point := market.PricePoint{Date: time.Unix(ts, 0).UTC().Format(time.DateOnly), Close: price.String()}
		// The live bar can share a date with the last completed one; keep the latest.
		if n := len(points); n > 0 && points[n-1].Date == point.Date {
			points[n-1] = point
			continue
		}
		points = append(points, point)
	}

	return market.History{
		Symbol:   r.Meta.Symbol,
		Currency: r.Meta.Currency,
		Range:    rng,
		Interval: rng.Interval(),
		Points:   points,
		Source:   source,
	}, nil
}

type searchResponse struct {
	Quotes []struct {
		Symbol    string `json:"symbol"`
		ShortName string `json:"shortname"`
		LongName  string `json:"longname"`
		Exchange  string `json:"exchange"`
		ExchDisp  string `json:"exchDisp"`
		QuoteType string `json:"quoteType"`
	} `json:"quotes"`
}

var searchableTypes = map[string]string{
	"EQUITY":     "equity",
	"ETF":        "etf",
	"MUTUALFUND": "mutual_fund",
	"INDEX":      "index",
}

func (p *Provider) Search(ctx context.Context, query string) ([]market.SymbolMatch, error) {
	u := fmt.Sprintf("%s/v1/finance/search?q=%s&quotesCount=10&newsCount=0", p.baseURL, url.QueryEscape(query))
	var res searchResponse
	if err := p.client.GetJSON(ctx, u, &res); err != nil {
		return nil, err
	}

	matches := make([]market.SymbolMatch, 0, len(res.Quotes))
	for _, q := range res.Quotes {
		kind, ok := searchableTypes[q.QuoteType]
		if !ok || q.Symbol == "" {
			continue
		}
		matches = append(matches, market.SymbolMatch{
			Symbol:   q.Symbol,
			Name:     firstNonEmpty(q.LongName, q.ShortName, q.Symbol),
			Exchange: firstNonEmpty(q.ExchDisp, q.Exchange),
			Type:     kind,
		})
	}
	return matches, nil
}

// parseNumber converts Yahoo's float JSON numbers to decimals, rounded to 4
// places to drop binary floating-point noise like 2845.300048828125.
func parseNumber(n json.Number) (decimal.Decimal, error) {
	d, err := decimal.NewFromString(n.String())
	if err != nil {
		return decimal.Decimal{}, err
	}
	return d.Round(4), nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
