package amfi

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/market"
)

// Trimmed from the real file, keeping every shape the parser must handle.
const fixture = "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\r\n" +
	" \r\n" +
	"Open Ended Schemes(Equity Scheme - Large Cap Fund)\r\n" +
	" \r\n" +
	"Axis Mutual Fund\r\n" +
	" \r\n" +
	"120465;INF846K01DP8;-;Axis Large Cap Fund;Direct Plan;Growth Option;64.2100;17-Oct-2026\r\n" +
	"120466;INF846K01DQ6;-;Axis Large Cap Fund;Direct Plan;IDCW Option;21.50;17-Oct-2026\r\n" +
	"999001;-;-;Axis Wound Down Fund;Direct Plan;Growth Option;N.A.;01-Jan-2020\r\n" +
	"Open Ended Schemes(Equity Schemes - Small Cap Fund)\r\n" +
	"Nippon India Mutual Fund\r\n" +
	"118778;INF204K01K15;-;Nippon India Small Cap Fund - Direct Plan - Growth Option;174.2345;17-Oct-2026\r\n" +
	"Close Ended Schemes(Equity Scheme - Other)\r\n" +
	"Some Mutual Fund\r\n" +
	"555555;-;-;Some Fixed Term Plan;Direct Plan;Growth Option;10.0;17-Oct-2026\r\n"

func TestParseReadsCategoriesFundHousesAndBothRowFormats(t *testing.T) {
	schemes, err := Parse(strings.NewReader(fixture))
	if err != nil {
		t.Fatal(err)
	}

	if len(schemes) != 3 {
		t.Fatalf("parsed %d schemes, want 3 (N.A. NAV and close-ended skipped): %+v", len(schemes), schemes)
	}

	want := market.Scheme{
		Code: "120465", Name: "Axis Large Cap Fund", FundHouse: "Axis Mutual Fund",
		Category: "Equity Scheme - Large Cap Fund", Plan: "Direct Plan", Option: "Growth Option",
		Nav: "64.21", NavDate: time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC),
	}
	if schemes[0] != want {
		t.Errorf("got  %+v\nwant %+v", schemes[0], want)
	}

	old := schemes[2]
	if old.Code != "118778" || old.Plan != "" || old.FundHouse != "Nippon India Mutual Fund" ||
		old.Category != "Equity Schemes - Small Cap Fund" || old.Nav != "174.2345" {
		t.Errorf("old-format row parsed wrong: %+v", old)
	}
}

func TestParseFailsOnEmptyFile(t *testing.T) {
	if _, err := Parse(strings.NewReader("Scheme Code;Name\n")); !errors.Is(err, market.ErrUpstream) {
		t.Fatalf("err = %v, want ErrUpstream", err)
	}
}
