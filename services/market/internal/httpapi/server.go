// Package httpapi exposes the market service over HTTP. It is an internal
// service: only the NestJS API calls it, so it carries no auth and no CORS.
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/cache"
	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/universe"
)

type MarketService interface {
	Quote(ctx context.Context, symbol string) (market.Quote, error)
	Quotes(ctx context.Context, symbols []string) (market.BatchQuotes, error)
	History(ctx context.Context, symbol, rng string) (market.History, error)
	Search(ctx context.Context, query string) ([]market.SymbolMatch, error)
	FxRate(ctx context.Context, base, quote string) (market.FxRate, error)
	Fund(ctx context.Context, schemeCode string) (market.Fund, error)
	SearchFunds(ctx context.Context, query string) ([]market.FundMatch, error)
	Universes() []universe.Universe
	Stats(ctx context.Context, symbol string) (market.SymbolStats, error)
	Screen(ctx context.Context, q market.ScreenQuery) (market.ScreenResult, error)
	FundCategories(ctx context.Context) ([]market.FundCategoryInfo, error)
	FundStats(ctx context.Context, schemeCode string) (market.FundStats, error)
	FundHistory(ctx context.Context, schemeCode, rng string) (market.History, error)
	FundScreen(ctx context.Context, q market.FundScreenQuery) (market.FundScreenResult, error)
	CacheStats() map[string]cache.Stats
	WarmReports() map[string]market.WarmReport
}

type handler struct {
	svc    MarketService
	logger *slog.Logger
	mode   string
}

func NewHandler(svc MarketService, logger *slog.Logger, mode string) http.Handler {
	h := &handler{svc: svc, logger: logger, mode: mode}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.health)
	mux.HandleFunc("GET /v1/quotes", h.batchQuotes)
	mux.HandleFunc("GET /v1/quotes/{symbol}", h.quote)
	mux.HandleFunc("GET /v1/history/{symbol}", h.history)
	mux.HandleFunc("GET /v1/search", h.search)
	mux.HandleFunc("GET /v1/fx", h.fx)
	mux.HandleFunc("GET /v1/funds/search", h.searchFunds)
	mux.HandleFunc("GET /v1/funds/{code}", h.fund)

	mux.HandleFunc("GET /v1/universes", h.universes)
	mux.HandleFunc("GET /v1/screener", h.screener)
	mux.HandleFunc("GET /v1/stats/{symbol}", h.stats)
	mux.HandleFunc("GET /v1/funds/categories", h.fundCategories)
	mux.HandleFunc("GET /v1/funds/screener", h.fundScreener)
	mux.HandleFunc("GET /v1/funds/{code}/stats", h.fundStats)
	mux.HandleFunc("GET /v1/funds/{code}/history", h.fundHistory)

	return requestID(accessLog(logger, recoverPanics(logger, mux)))
}

func (h *handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"mode":   h.mode,
		"caches": h.svc.CacheStats(),
		"warm":   h.svc.WarmReports(),
	})
}

func (h *handler) universes(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, h.svc.Universes())
}

func (h *handler) screener(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	respond(w, r, h.logger)(h.svc.Screen(r.Context(), market.ScreenQuery{
		Universe: q.Get("universe"),
		Symbols:  splitList(q.Get("symbols")),
		Period:   q.Get("period"),
		Sort:     q.Get("sort"),
		Order:    q.Get("order"),
		Limit:    q.Get("limit"),
	}))
}

func (h *handler) stats(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.Stats(r.Context(), r.PathValue("symbol")))
}

func (h *handler) fundCategories(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.FundCategories(r.Context()))
}

func (h *handler) fundScreener(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	respond(w, r, h.logger)(h.svc.FundScreen(r.Context(), market.FundScreenQuery{
		Category: q.Get("category"),
		Codes:    splitList(q.Get("codes")),
		Period:   q.Get("period"),
		Sort:     q.Get("sort"),
		Order:    q.Get("order"),
		Limit:    q.Get("limit"),
	}))
}

func (h *handler) fundStats(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.FundStats(r.Context(), r.PathValue("code")))
}

func (h *handler) fundHistory(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.FundHistory(r.Context(), r.PathValue("code"), r.URL.Query().Get("range")))
}

func splitList(raw string) []string {
	var out []string
	for _, s := range strings.Split(raw, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func (h *handler) quote(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.Quote(r.Context(), r.PathValue("symbol")))
}

func (h *handler) batchQuotes(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.Quotes(r.Context(), splitList(r.URL.Query().Get("symbols"))))
}

func (h *handler) history(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.History(r.Context(), r.PathValue("symbol"), r.URL.Query().Get("range")))
}

func (h *handler) search(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.Search(r.Context(), r.URL.Query().Get("q")))
}

func (h *handler) fx(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	respond(w, r, h.logger)(h.svc.FxRate(r.Context(), q.Get("base"), q.Get("quote")))
}

func (h *handler) fund(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.Fund(r.Context(), r.PathValue("code")))
}

func (h *handler) searchFunds(w http.ResponseWriter, r *http.Request) {
	respond(w, r, h.logger)(h.svc.SearchFunds(r.Context(), r.URL.Query().Get("q")))
}

// respond writes either the value or a mapped error, so handlers stay one line.
func respond(w http.ResponseWriter, r *http.Request, logger *slog.Logger) func(any, error) {
	return func(value any, err error) {
		if err != nil {
			writeError(w, r, logger, err)
			return
		}
		writeJSON(w, http.StatusOK, value)
	}
}

type errorBody struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"requestId"`
	} `json:"error"`
}

func writeError(w http.ResponseWriter, r *http.Request, logger *slog.Logger, err error) {
	status, code := http.StatusInternalServerError, "internal"
	switch {
	case errors.Is(err, market.ErrInvalid):
		status, code = http.StatusBadRequest, "invalid_request"
	case errors.Is(err, market.ErrNotFound):
		status, code = http.StatusNotFound, "not_found"
	case errors.Is(err, market.ErrUnsupported):
		status, code = http.StatusUnprocessableEntity, "unsupported"
	case errors.Is(err, market.ErrUpstream):
		status, code = http.StatusBadGateway, "upstream_failure"
	case errors.Is(err, context.DeadlineExceeded):
		status, code = http.StatusGatewayTimeout, "timeout"
	case errors.Is(err, context.Canceled):
		status, code = 499, "client_closed_request"
	}

	message := err.Error()
	if status >= 500 {
		logger.Error("request failed", "request_id", requestIDFrom(r.Context()), "error", err)
		if status == http.StatusInternalServerError {
			message = "internal error" // never leak unexpected internals
		}
	}

	var body errorBody
	body.Error.Code = code
	body.Error.Message = message
	body.Error.RequestID = requestIDFrom(r.Context())
	writeJSON(w, status, body)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

type ctxKey struct{}

const requestIDHeader = "X-Request-Id"

// requestID propagates the caller's request ID (the NestJS API forwards its
// own) or mints one, so a single user action can be traced across services.
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestIDHeader)
		if id == "" || len(id) > 64 {
			buf := make([]byte, 8)
			_, _ = rand.Read(buf)
			id = hex.EncodeToString(buf)
		}
		w.Header().Set(requestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	})
}

func requestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(status int) {
	s.status = status
	s.ResponseWriter.WriteHeader(status)
}

func accessLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", requestIDFrom(r.Context()),
		)
	})
}

func recoverPanics(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				logger.Error("panic", "request_id", requestIDFrom(r.Context()), "panic", v)
				writeError(w, r, logger, errors.New("panic"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}
