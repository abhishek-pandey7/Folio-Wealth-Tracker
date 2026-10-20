package universe_test

import (
	"strings"
	"testing"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/universe"
)

func TestEverySymbolIsValidAndUniquePerUniverse(t *testing.T) {
	for _, u := range universe.All() {
		seen := map[string]bool{}
		for _, s := range u.Symbols() {
			if norm, err := market.NormalizeSymbol(s); err != nil || norm != s {
				t.Errorf("%s: %q is not a normalized symbol", u.ID, s)
			}
			if seen[s] {
				t.Errorf("%s: duplicate symbol %s", u.ID, s)
			}
			seen[s] = true
		}
		if u.Count == 0 || u.Count != len(u.Symbols()) {
			t.Errorf("%s: count %d does not match members", u.ID, u.Count)
		}
	}
}

func TestUniverseIDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, u := range universe.All() {
		if seen[u.ID] {
			t.Errorf("duplicate universe id %s", u.ID)
		}
		seen[u.ID] = true
	}
}

func TestSectorUniversesAreDerivedFromMembers(t *testing.T) {
	it, ok := universe.Get("in-sector-it")
	if !ok {
		t.Fatal("in-sector-it missing")
	}
	for _, s := range it.Symbols() {
		if universe.SectorOf(s) != universe.SectorIT.Name() {
			t.Errorf("%s is in the IT universe but tagged %q", s, universe.SectorOf(s))
		}
	}
	if !strings.Contains(strings.Join(it.Symbols(), ","), "PERSISTENT.NS") {
		t.Error("India IT should include mid caps too")
	}
}

func TestFundCategoryMatchesBothAMFISpellings(t *testing.T) {
	large, _ := universe.GetFundCategory("large-cap")

	for _, heading := range []string{"Equity Scheme - Large Cap Fund", "Equity Schemes - Large Cap Fund"} {
		if !large.Matches(heading, "Any Large Cap Fund") {
			t.Errorf("large-cap should match %q", heading)
		}
	}
	if large.Matches("Equity Scheme - Large & Mid Cap Fund", "Some Fund") {
		t.Error("large-cap must not match large & mid cap")
	}
}

func TestIndexCategoryFiltersByName(t *testing.T) {
	idx, _ := universe.GetFundCategory("index-nifty50")

	if !idx.Matches("Other Scheme - Index Funds", "UTI Nifty 50 Index Fund") {
		t.Error("should match a Nifty 50 index fund")
	}
	if idx.Matches("Other Scheme - Index Funds", "UTI Nifty Next 50 Index Fund") {
		t.Error("Nifty Next 50 is a different index")
	}
}

func TestDirectGrowthFilter(t *testing.T) {
	tests := []struct {
		name, plan, option string
		want               bool
	}{
		{"Axis Bluechip Fund", "Direct Plan", "Growth Option", true},
		{"Axis Bluechip Fund - Direct Plan - Growth", "", "", true},
		{"Axis Bluechip Fund", "Regular Plan", "Growth Option", false},
		{"Axis Bluechip Fund", "Direct Plan", "IDCW Option", false},
		{"Axis Bluechip Fund - Direct Plan - Growth - Bonus", "", "", false},
	}
	for _, tt := range tests {
		if got := universe.IsDirectGrowth(tt.name, tt.plan, tt.option); got != tt.want {
			t.Errorf("IsDirectGrowth(%q, %q, %q) = %v, want %v", tt.name, tt.plan, tt.option, got, tt.want)
		}
	}
}
