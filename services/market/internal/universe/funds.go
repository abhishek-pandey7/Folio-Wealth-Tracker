package universe

import (
	"regexp"
	"slices"
	"strings"
)

// FundCategory is a SEBI mutual fund category, matched against the category
// headings in AMFI's daily NAV file. AMFI has published the same category
// under two spellings ("Equity Scheme - Large Cap Fund" and "Equity Schemes -
// Large Cap Fund"), so matching is by pattern, not exact string.
type FundCategory struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	heading     *regexp.Regexp
	name        *regexp.Regexp // optional extra filter on the scheme name
}

// Matches reports whether a scheme with this AMFI heading and name belongs here.
func (c FundCategory) Matches(heading, schemeName string) bool {
	return c.heading.MatchString(heading) && (c.name == nil || c.name.MatchString(schemeName))
}

var fundCategories = []FundCategory{
	{ID: "flexi-cap", Name: "Flexi cap", heading: re(`Equity Schemes? - Flexi Cap`),
		Description: "Free to invest across large, mid and small caps. A common core holding."},
	{ID: "large-cap", Name: "Large cap", heading: re(`Equity Schemes? - Large Cap`),
		Description: "At least 80% in the top 100 companies. Steadier, lower expected returns."},
	{ID: "mid-cap", Name: "Mid cap", heading: re(`Equity Schemes? - Mid Cap`),
		Description: "At least 65% in companies ranked 101 to 250."},
	{ID: "small-cap", Name: "Small cap", heading: re(`Equity Schemes? - Small Cap`),
		Description: "At least 65% in companies ranked 251 and below. Highest swings."},
	{ID: "large-mid-cap", Name: "Large and mid cap", heading: re(`Equity Schemes? - Large & Mid Cap`),
		Description: "At least 35% each in large and mid caps."},
	{ID: "multi-cap", Name: "Multi cap", heading: re(`Equity Schemes? - Multi Cap`),
		Description: "At least 25% each in large, mid and small caps."},
	{ID: "elss", Name: "ELSS (tax saver)", heading: re(`Equity Schemes? - ELSS`),
		Description: "Tax deduction under Section 80C (old regime), with a 3-year lock-in."},
	{ID: "value", Name: "Value", heading: re(`Equity Schemes? - Value`),
		Description: "Buys companies priced cheaply relative to their fundamentals."},
	{ID: "index-nifty50", Name: "Nifty 50 and Sensex index", heading: re(`Index Funds`),
		name:        re(`(?i)(nifty 50|sensex) index`),
		Description: "Passive funds that track the Nifty 50 or Sensex. Lowest cost."},
	{ID: "aggressive-hybrid", Name: "Aggressive hybrid", heading: re(`Hybrid Schemes? - Aggressive Hybrid`),
		Description: "65 to 80% equity, the rest debt."},
	{ID: "balanced-advantage", Name: "Balanced advantage", heading: re(`Hybrid Schemes? - (Balanced Advantage|Dynamic Asset Allocation)`),
		Description: "Shifts between equity and debt based on market valuations."},
}

func re(pattern string) *regexp.Regexp { return regexp.MustCompile(pattern) }

func FundCategories() []FundCategory { return slices.Clone(fundCategories) }

func GetFundCategory(id string) (FundCategory, bool) {
	for _, c := range fundCategories {
		if c.ID == id {
			return c, true
		}
	}
	return FundCategory{}, false
}

var excludedOptions = regexp.MustCompile(`(?i)idcw|dividend|bonus|payout|reinvest`)

// IsDirectGrowth keeps only the plan most investors should compare: Direct
// (no distributor commission, lower expense ratio) and Growth (gains stay
// invested, so NAV returns are total returns).
func IsDirectGrowth(name, plan, option string) bool {
	text := strings.Join([]string{name, plan, option}, " ")
	return strings.Contains(strings.ToLower(text), "direct") &&
		strings.Contains(strings.ToLower(text), "growth") &&
		!excludedOptions.MatchString(text)
}
