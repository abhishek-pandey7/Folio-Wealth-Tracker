// Package amfi reads AMFI's daily NAV file, the industry body's official list
// of every mutual fund scheme with its SEBI category and latest NAV. It is the
// only free source that groups schemes by category, which the fund screener needs.
package amfi

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/upstream"
)

const DefaultURL = "https://portal.amfiindia.com/spages/NAVAll.txt"

type Provider struct {
	client *upstream.Client
	url    string
}

func New(client *upstream.Client, url string) *Provider {
	return &Provider{client: client, url: url}
}

func (p *Provider) Schemes(ctx context.Context) ([]market.Scheme, error) {
	body, err := p.client.Get(ctx, p.url)
	if err != nil {
		return nil, err
	}
	return Parse(bytes.NewReader(body))
}

var (
	openEndedHeading = regexp.MustCompile(`^Open Ended Schemes\((.+)\)$`)
	otherHeading     = regexp.MustCompile(`^(Close Ended|Interval Fund) Schemes\(`)
	schemeCode       = regexp.MustCompile(`^\d+$`)
)

// Parse reads the NAV file. Its layout is a sequence of category headings,
// fund house names, and semicolon-separated scheme rows:
//
//	Open Ended Schemes(Equity Scheme - Large Cap Fund)
//	Axis Mutual Fund
//	120465;INF846K01DP8;-;Axis Large Cap Fund;Direct Plan;Growth Option;64.21;17-Oct-2026
//
// Older rows omit the Plan and Option columns and carry them in the name.
// Close-ended and interval schemes are skipped: they cannot be bought anytime.
func Parse(r io.Reader) ([]market.Scheme, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	var (
		schemes   []market.Scheme
		category  string
		fundHouse string
		openEnded bool
	)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case line == "":
			continue
		case openEndedHeading.MatchString(line):
			category, fundHouse, openEnded = openEndedHeading.FindStringSubmatch(line)[1], "", true
			continue
		case otherHeading.MatchString(line):
			openEnded = false
			continue
		case !strings.Contains(line, ";"):
			fundHouse = line
			continue
		case !openEnded:
			continue
		}

		fields := strings.Split(line, ";")
		if len(fields) < 6 || !schemeCode.MatchString(fields[0]) {
			continue // the column header row, or a malformed line
		}
		nav, err := decimal.NewFromString(strings.TrimSpace(fields[len(fields)-2]))
		if err != nil {
			continue // "N.A." for schemes with no NAV today
		}
		navDate, err := time.Parse("02-Jan-2006", strings.TrimSpace(fields[len(fields)-1]))
		if err != nil {
			continue
		}

		s := market.Scheme{
			Code:      fields[0],
			Name:      strings.TrimSpace(fields[3]),
			FundHouse: fundHouse,
			Category:  category,
			Nav:       nav.String(),
			NavDate:   navDate,
		}
		if len(fields) >= 8 {
			s.Plan, s.Option = strings.TrimSpace(fields[4]), strings.TrimSpace(fields[5])
		}
		schemes = append(schemes, s)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("%w: amfi NAV file unreadable: %v", market.ErrUpstream, err)
	}
	if len(schemes) == 0 {
		return nil, fmt.Errorf("%w: amfi NAV file contained no schemes", market.ErrUpstream)
	}
	return schemes, nil
}
