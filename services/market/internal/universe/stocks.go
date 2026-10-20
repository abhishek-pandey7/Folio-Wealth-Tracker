// Package universe defines the curated lists the screener ranks: stock and
// ETF categories, sectors, and mutual fund categories.
//
// Stock lists are hand-curated, not official index memberships (index
// compositions change twice a year and are not available from a free API).
// Every symbol was verified against live data when added; anything that later
// stops resolving (renames, mergers, demergers) shows up in a screen's
// "unavailable" list rather than breaking it. Names come from the data
// provider, so only symbols and sectors are maintained here.
package universe

import "slices"

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

var all []Universe

func init() {
	add := func(u Universe, members []Member) {
		u.members = members
		u.Count = len(members)
		all = append(all, u)
	}

	add(Universe{ID: "in-large", Name: "India large caps", Group: "India", Region: "IN",
		Description: "The biggest, most traded companies on the NSE."}, indiaLargeCaps)
	add(Universe{ID: "in-mid", Name: "India mid caps", Group: "India", Region: "IN",
		Description: "Established mid-sized companies with more room to grow, and more volatility."}, indiaMidCaps)
	add(Universe{ID: "in-etf", Name: "India ETFs", Group: "ETFs", Region: "IN",
		Description: "Exchange-traded funds on the NSE: index, sector, gold, silver and international."}, indiaETFs)
	add(Universe{ID: "us-large", Name: "US large caps", Group: "US", Region: "US",
		Description: "The largest US companies by market value."}, usLargeCaps)
	add(Universe{ID: "us-etf", Name: "US ETFs", Group: "ETFs", Region: "US",
		Description: "Popular low-cost US index, dividend, bond and gold ETFs."}, usETFs)
	add(Universe{ID: "indices", Name: "Market indices", Group: "Indices", Region: "IN",
		Description: "Headline Indian and US indices. Not directly investable; use an index fund or ETF."}, indices)

	indian := slices.Concat(indiaLargeCaps, indiaMidCaps)
	for _, s := range []Sector{SectorIT, SectorFinancials, SectorAuto, SectorHealthcare, SectorConsumer,
		SectorEnergy, SectorMaterials, SectorIndustrials, SectorServices} {
		add(Universe{ID: "in-sector-" + string(s), Name: s.Name(), Group: "India sectors", Region: "IN",
			Description: "Indian large and mid caps in " + s.Name() + "."}, filter(indian, s))
	}
	for _, s := range []Sector{SectorTech, SectorFinancials, SectorHealthcare, SectorConsumer} {
		add(Universe{ID: "us-sector-" + string(s), Name: s.Name(), Group: "US sectors", Region: "US",
			Description: "US large caps in " + s.Name() + "."}, filter(usLargeCaps, s))
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

// SectorOf reports the sector name for a curated symbol, or "" if unknown.
func SectorOf(symbol string) string {
	for _, group := range [][]Member{indiaLargeCaps, indiaMidCaps, usLargeCaps} {
		for _, mem := range group {
			if mem.Symbol == symbol {
				return mem.Sector.Name()
			}
		}
	}
	return ""
}
