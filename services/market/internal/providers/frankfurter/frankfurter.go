// Package frankfurter provides daily FX reference rates from frankfurter.dev,
// a free, keyless API over the European Central Bank's published rates.
package frankfurter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/shopspring/decimal"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/upstream"
)

const (
	DefaultBaseURL = "https://api.frankfurter.dev"
	source         = "frankfurter"
)

type Provider struct {
	client  *upstream.Client
	baseURL string
}

func New(client *upstream.Client, baseURL string) *Provider {
	return &Provider{client: client, baseURL: strings.TrimRight(baseURL, "/")}
}

type latestResponse struct {
	Base  string                 `json:"base"`
	Date  string                 `json:"date"`
	Rates map[string]json.Number `json:"rates"`
}

func (p *Provider) Rate(ctx context.Context, base, quote string) (market.FxRate, error) {
	u := fmt.Sprintf("%s/v1/latest?base=%s&symbols=%s", p.baseURL, url.QueryEscape(base), url.QueryEscape(quote))
	var res latestResponse
	if err := p.client.GetJSON(ctx, u, &res); err != nil {
		return market.FxRate{}, err
	}

	raw, ok := res.Rates[quote]
	if !ok {
		return market.FxRate{}, fmt.Errorf("%w: no %s/%s rate", market.ErrNotFound, base, quote)
	}
	rate, err := decimal.NewFromString(raw.String())
	if err != nil {
		return market.FxRate{}, fmt.Errorf("%w: frankfurter rate %q: %v", market.ErrUpstream, raw, err)
	}

	return market.FxRate{Base: base, Quote: quote, Rate: rate.String(), Date: res.Date, Source: source}, nil
}
