// Package universe defines the lists the screener ranks: stock and ETF
// categories, sectors, and mutual fund categories.
//
// Two kinds of stock list. The curated ones (large and mid caps, ETFs,
// indices) are maintained by hand; every symbol was verified against live
// data when added. The Nifty 500 and S&P 500 memberships are generated into
// indexes_gen.go by scripts/index-lists.mjs from the published constituent
// files, since index compositions change at each rebalance and are not
// available from a free API. Anything that later stops resolving (renames,
// mergers, demergers) shows up in a screen's "unavailable" list rather than
// breaking it. Names come from the data provider, so only symbols and sectors
// are kept here.
package universe

import (
	"slices"
	"strings"
)

type Sector string

const (
	SectorIT          Sector = "it"
	SectorFinancials  Sector = "financials"
	SectorAuto        Sector = "auto"
	SectorHealthcare  Sector = "healthcare"
	SectorConsumer    Sector = "consumer"
	SectorEnergy      Sector = "energy"
	SectorMaterials   Sector = "materials"
	SectorIndustrials Sector = "industrials"
	SectorServices    Sector = "services"
	SectorTech        Sector = "tech"
	SectorFund        Sector = "fund" // ETFs and indices
)

var sectorNames = map[Sector]string{
	SectorIT:          "IT services",
	SectorFinancials:  "Banks and financials",
	SectorAuto:        "Auto",
	SectorHealthcare:  "Pharma and healthcare",
	SectorConsumer:    "Consumer",
	SectorEnergy:      "Energy and utilities",
	SectorMaterials:   "Metals and materials",
	SectorIndustrials: "Industrials and infra",
	SectorServices:    "Telecom, travel and services",
	SectorTech:        "Technology",
	SectorFund:        "Fund",
}

func (s Sector) Name() string { return sectorNames[s] }

type Member struct {
	Symbol string
	Sector Sector
}

type Universe struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Group       string `json:"group"`
	Region      string `json:"region"` // IN or US
	Count       int    `json:"count"`
	members     []Member
}

func (u Universe) Symbols() []string {
	out := make([]string, len(u.members))
	for i, m := range u.members {
		out[i] = m.Symbol
	}
	return out
}

func m(sector Sector, symbols ...string) []Member {
	out := make([]Member, len(symbols))
	for i, s := range symbols {
		out[i] = Member{Symbol: s, Sector: sector}
	}
	return out
}

func join(groups ...[]Member) []Member { return slices.Concat(groups...) }

// indexGroup is one sector's members of an index, as generated into indexes_gen.go.
type indexGroup struct {
	sector  Sector
	symbols []string
}

func fields(lines ...string) []string { return strings.Fields(strings.Join(lines, " ")) }

func expand(groups []indexGroup, suffix string) []Member {
	var out []Member
	for _, g := range groups {
		for _, s := range g.symbols {
			out = append(out, Member{Symbol: s + suffix, Sector: g.sector})
		}
	}
	return out
}

// union keeps the first entry for each symbol, so a curated member keeps its curated sector.
func union(groups ...[]Member) []Member {
	seen := map[string]bool{}
	var out []Member
	for _, mem := range slices.Concat(groups...) {
		if !seen[mem.Symbol] {
			seen[mem.Symbol] = true
			out = append(out, mem)
		}
	}
	return out
}

var indiaLargeCaps = join(
	m(SectorIT, "TCS.NS", "INFY.NS", "HCLTECH.NS", "WIPRO.NS", "TECHM.NS"),
	m(SectorFinancials, "HDFCBANK.NS", "ICICIBANK.NS", "KOTAKBANK.NS", "AXISBANK.NS", "SBIN.NS", "INDUSINDBK.NS",
		"BAJFINANCE.NS", "BAJAJFINSV.NS", "HDFCLIFE.NS", "SBILIFE.NS", "SHRIRAMFIN.NS", "JIOFIN.NS"),
	m(SectorAuto, "MARUTI.NS", "M&M.NS", "BAJAJ-AUTO.NS", "EICHERMOT.NS", "HEROMOTOCO.NS", "TMPV.NS"),
	m(SectorHealthcare, "SUNPHARMA.NS", "CIPLA.NS", "DRREDDY.NS", "APOLLOHOSP.NS", "DIVISLAB.NS", "MAXHEALTH.NS"),
	m(SectorConsumer, "HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "TATACONSUM.NS", "BRITANNIA.NS", "TITAN.NS",
		"ASIANPAINT.NS", "TRENT.NS", "DMART.NS", "PIDILITIND.NS"),
	m(SectorEnergy, "RELIANCE.NS", "ONGC.NS", "NTPC.NS", "POWERGRID.NS", "COALINDIA.NS", "BPCL.NS", "ADANIGREEN.NS"),
	m(SectorMaterials, "TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "ULTRACEMCO.NS", "GRASIM.NS"),
	m(SectorIndustrials, "LT.NS", "ADANIPORTS.NS", "ADANIENT.NS", "BEL.NS", "HAL.NS"),
	m(SectorServices, "BHARTIARTL.NS", "INDIGO.NS", "ETERNAL.NS"),
)

var indiaMidCaps = join(
	m(SectorIT, "PERSISTENT.NS", "MPHASIS.NS", "COFORGE.NS", "KPITTECH.NS", "TATAELXSI.NS"),
	m(SectorFinancials, "FEDERALBNK.NS", "IDFCFIRSTB.NS", "YESBANK.NS", "ABCAPITAL.NS"),
	m(SectorAuto, "ASHOKLEY.NS", "BHARATFORG.NS", "MRF.NS"),
	m(SectorHealthcare, "LUPIN.NS", "AUROPHARMA.NS"),
	m(SectorConsumer, "DIXON.NS", "VOLTAS.NS", "PAGEIND.NS"),
	m(SectorEnergy, "TORNTPOWER.NS", "SUZLON.NS"),
	m(SectorMaterials, "PIIND.NS", "ASTRAL.NS"),
	m(SectorIndustrials, "POLYCAB.NS", "CUMMINSIND.NS"),
	m(SectorServices, "INDHOTEL.NS", "IRCTC.NS"),
)

var usLargeCaps = join(
	m(SectorTech, "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AVGO", "ORCL", "CRM", "AMD", "ADBE"),
	m(SectorFinancials, "BRK-B", "JPM", "V", "MA", "BAC"),
	m(SectorHealthcare, "LLY", "UNH", "JNJ"),
	m(SectorConsumer, "AMZN", "TSLA", "PG", "COST", "HD", "KO", "PEP", "WMT", "NFLX"),
	m(SectorEnergy, "XOM"),
)

// LIQUIDBEES is deliberately absent: it pays returns as daily dividend units
// while its price stays flat, so price-based returns show it at 0%.
var indiaETFs = m(SectorFund,
	"NIFTYBEES.NS", "JUNIORBEES.NS", "MIDCAPETF.NS", "BANKBEES.NS", "PSUBNKBEES.NS", "ITBEES.NS", "CPSEETF.NS",
	"MON100.NS", "MAFANG.NS", "GOLDBEES.NS", "SILVERBEES.NS")

var usETFs = m(SectorFund, "VOO", "VTI", "QQQ", "SCHD", "IWM", "XLK", "VXUS", "VWO", "BND", "GLD")

var indices = m(SectorFund, "^NSEI", "^BSESN", "^NSEBANK", "^CNXIT", "^NSMIDCP", "^GSPC", "^IXIC", "^DJI")

var (
	all       []Universe
	curated   []string
	sectorsBy = map[string]Sector{}
)

func init() {
	niftyMembers := expand(nifty500, ".NS")
	spMembers := expand(sp500, "")

	add := func(u Universe, members []Member) {
		u.members = members
		u.Count = len(members)
		all = append(all, u)
	}

	add(Universe{ID: "in-large", Name: "India large caps", Group: "India", Region: "IN",
		Description: "The biggest, most traded companies on the NSE."}, indiaLargeCaps)
	add(Universe{ID: "in-mid", Name: "India mid caps", Group: "India", Region: "IN",
		Description: "Established mid-sized companies with more room to grow, and more volatility."}, indiaMidCaps)
	add(Universe{ID: "in-nifty500", Name: "Nifty 500", Group: "India", Region: "IN",
		Description: "The Nifty 500 index: India's 500 largest listed companies, across every sector."}, niftyMembers)
	add(Universe{ID: "in-etf", Name: "India ETFs", Group: "ETFs", Region: "IN",
		Description: "Exchange-traded funds on the NSE: index, sector, gold, silver and international."}, indiaETFs)
	add(Universe{ID: "us-large", Name: "US large caps", Group: "US", Region: "US",
		Description: "The largest US companies by market value."}, usLargeCaps)
	add(Universe{ID: "us-sp500", Name: "S&P 500", Group: "US", Region: "US",
		Description: "The S&P 500 index: 500 leading US companies, across every sector."}, spMembers)
	add(Universe{ID: "us-etf", Name: "US ETFs", Group: "ETFs", Region: "US",
		Description: "Popular low-cost US index, dividend, bond and gold ETFs."}, usETFs)
	add(Universe{ID: "indices", Name: "Market indices", Group: "Indices", Region: "IN",
		Description: "Headline Indian and US indices. Not directly investable; use an index fund or ETF."}, indices)

	indian := union(indiaLargeCaps, indiaMidCaps, niftyMembers)
	us := union(usLargeCaps, spMembers)
	for _, s := range []Sector{SectorIT, SectorFinancials, SectorAuto, SectorHealthcare, SectorConsumer,
		SectorEnergy, SectorMaterials, SectorIndustrials, SectorServices} {
		add(Universe{ID: "in-sector-" + string(s), Name: s.Name(), Group: "India sectors", Region: "IN",
			Description: "Nifty 500 companies in " + s.Name() + "."}, filter(indian, s))
	}
	for _, s := range []Sector{SectorTech, SectorFinancials, SectorHealthcare, SectorConsumer,
		SectorEnergy, SectorIndustrials, SectorMaterials} {
		add(Universe{ID: "us-sector-" + string(s), Name: s.Name(), Group: "US sectors", Region: "US",
			Description: "S&P 500 companies in " + s.Name() + "."}, filter(us, s))
	}

	for _, mem := range slices.Concat(indian, us) {
		sectorsBy[mem.Symbol] = mem.Sector
	}
	for _, mem := range union(indiaLargeCaps, indiaMidCaps, indiaETFs, usLargeCaps, usETFs, indices) {
		curated = append(curated, mem.Symbol)
	}
}

func filter(members []Member, s Sector) []Member {
	var out []Member
	for _, mem := range members {
		if mem.Sector == s {
			out = append(out, mem)
		}
	}
	return out
}

// All returns every stock universe, in display order.
func All() []Universe { return slices.Clone(all) }

func Get(id string) (Universe, bool) {
	for _, u := range all {
		if u.ID == id {
			return u, true
		}
	}
	return Universe{}, false
}

// AllSymbols is every distinct symbol across universes, for cache warming.
func AllSymbols() []string {
	seen := map[string]bool{}
	var out []string
	for _, u := range all {
		for _, mem := range u.members {
			if !seen[mem.Symbol] {
				seen[mem.Symbol] = true
				out = append(out, mem.Symbol)
			}
		}
	}
	return out
}

// CuratedSymbols is every hand-curated symbol, warmed often.
func CuratedSymbols() []string { return slices.Clone(curated) }

// IndexOnlySymbols is every Nifty 500 or S&P 500 member that is not curated, warmed daily.
func IndexOnlySymbols() []string {
	var out []string
	for _, s := range AllSymbols() {
		if !slices.Contains(curated, s) {
			out = append(out, s)
		}
	}
	return out
}

// SectorOf reports the sector name for a listed company, or "" for funds, indices and unknown symbols.
func SectorOf(symbol string) string {
	if s, ok := sectorsBy[symbol]; ok {
		return s.Name()
	}
	return ""
}
