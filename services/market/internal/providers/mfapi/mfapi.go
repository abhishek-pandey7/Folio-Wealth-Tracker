// Package mfapi prices Indian mutual funds from mfapi.in, a free mirror of the
// daily NAVs AMFI (the industry body) publishes for every scheme.
package mfapi

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"github.com/abhishek-pandey7/folio/services/market/internal/analytics"
	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/upstream"
)

const (
	DefaultBaseURL = "https://api.mfapi.in"
	source         = "mfapi"
	maxResults     = 20
	navDateLayout  = "02-01-2006" // mfapi dates are DD-MM-YYYY
)

type Provider struct {
	client  *upstream.Client
	baseURL string
}

func New(client *upstream.Client, baseURL string) *Provider {
	return &Provider{client: client, baseURL: strings.TrimRight(baseURL, "/")}
}

type latestResponse struct {
	Meta struct {
		FundHouse      string `json:"fund_house"`
		SchemeCategory string `json:"scheme_category"`
		SchemeName     string `json:"scheme_name"`
	} `json:"meta"`
	Data []struct {
		Date string `json:"date"`
		Nav  string `json:"nav"`
	} `json:"data"`
}

func (p *Provider) Fund(ctx context.Context, schemeCode string) (market.Fund, error) {
	var res latestResponse
	if err := p.client.GetJSON(ctx, fmt.Sprintf("%s/mf/%s/latest", p.baseURL, url.PathEscape(schemeCode)), &res); err != nil {
		return market.Fund{}, err
	}
	// Unknown scheme codes come back as 200 with empty meta and data.
	if res.Meta.SchemeName == "" || len(res.Data) == 0 {
		return market.Fund{}, fmt.Errorf("%w: no mutual fund with scheme code %s", market.ErrNotFound, schemeCode)
	}

	latest := res.Data[0]
	nav, err := decimal.NewFromString(latest.Nav)
	if err != nil {
		return market.Fund{}, fmt.Errorf("%w: mfapi NAV %q: %v", market.ErrUpstream, latest.Nav, err)
	}
	navDate, err := time.Parse(navDateLayout, latest.Date)
	if err != nil {
		return market.Fund{}, fmt.Errorf("%w: mfapi NAV date %q: %v", market.ErrUpstream, latest.Date, err)
	}

	return market.Fund{
		SchemeCode: schemeCode,
		Name:       res.Meta.SchemeName,
		FundHouse:  res.Meta.FundHouse,
		Category:   res.Meta.SchemeCategory,
		Nav:        nav.String(),
		NavDate:    navDate.Format(time.DateOnly),
		Source:     source,
	}, nil
}

type searchResult struct {
	SchemeCode int64  `json:"schemeCode"`
	SchemeName string `json:"schemeName"`
}

func (p *Provider) SearchFunds(ctx context.Context, query string) ([]market.FundMatch, error) {
	var res []searchResult
	if err := p.client.GetJSON(ctx, fmt.Sprintf("%s/mf/search?q=%s", p.baseURL, url.QueryEscape(query)), &res); err != nil {
		return nil, err
	}

	matches := make([]market.FundMatch, 0, min(len(res), maxResults))
	for _, r := range res[:min(len(res), maxResults)] {
		matches = append(matches, market.FundMatch{SchemeCode: fmt.Sprint(r.SchemeCode), Name: r.SchemeName})
	}
	return matches, nil
}

// FundHistory returns a scheme's entire NAV history, oldest first. mfapi
// serves it newest first, as strings, with DD-MM-YYYY dates.
func (p *Provider) FundHistory(ctx context.Context, schemeCode string) (market.NavSeries, error) {
	var res latestResponse
	if err := p.client.GetJSON(ctx, fmt.Sprintf("%s/mf/%s", p.baseURL, url.PathEscape(schemeCode)), &res); err != nil {
		return market.NavSeries{}, err
	}
	if res.Meta.SchemeName == "" || len(res.Data) == 0 {
		return market.NavSeries{}, fmt.Errorf("%w: no mutual fund with scheme code %s", market.ErrNotFound, schemeCode)
	}

	points := make([]analytics.Point, 0, len(res.Data))
	for i := len(res.Data) - 1; i >= 0; i-- {
		d := res.Data[i]
		date, err := time.Parse(navDateLayout, d.Date)
		if err != nil {
			continue
		}
		nav, err := strconv.ParseFloat(d.Nav, 64)
		if err != nil || nav <= 0 {
			continue
		}
		if n := len(points); n > 0 && !date.After(points[n-1].Date) {
			continue // duplicate or out-of-order publication
		}
		points = append(points, analytics.Point{Date: date, Value: nav})
	}
	if len(points) == 0 {
		return market.NavSeries{}, fmt.Errorf("%w: mfapi history for %s had no usable NAVs", market.ErrUpstream, schemeCode)
	}

	latest, err := decimal.NewFromString(res.Data[0].Nav)
	if err != nil {
		return market.NavSeries{}, fmt.Errorf("%w: mfapi NAV %q: %v", market.ErrUpstream, res.Data[0].Nav, err)
	}
	return market.NavSeries{
		SchemeCode: schemeCode,
		Name:       res.Meta.SchemeName,
		FundHouse:  res.Meta.FundHouse,
		Category:   res.Meta.SchemeCategory,
		Nav:        latest.String(),
		NavDate:    points[len(points)-1].Date.Format(time.DateOnly),
		Points:     points,
	}, nil
}
