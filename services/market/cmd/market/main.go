// Command market runs the market data gateway: the only component that talks
// to external market data APIs.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/abhishek-pandey7/folio/services/market/internal/config"
	"github.com/abhishek-pandey7/folio/services/market/internal/httpapi"
	"github.com/abhishek-pandey7/folio/services/market/internal/market"
	"github.com/abhishek-pandey7/folio/services/market/internal/providers/amfi"
	"github.com/abhishek-pandey7/folio/services/market/internal/providers/frankfurter"
	"github.com/abhishek-pandey7/folio/services/market/internal/providers/mfapi"
	"github.com/abhishek-pandey7/folio/services/market/internal/providers/mock"
	"github.com/abhishek-pandey7/folio/services/market/internal/providers/yahoo"
	"github.com/abhishek-pandey7/folio/services/market/internal/upstream"
)

// Warm intervals sit inside the cache TTLs (stock stats 1h, fund stats 12h),
// so screens are always served from cache rather than waiting on upstreams.
const (
	stockWarmInterval = 45 * time.Minute
	fundWarmInterval  = 6 * time.Hour
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	svc := newService(cfg)

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.NewHandler(svc, logger, cfg.Mode),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		// Generous: a cold category screen can wait on dozens of rate-limited upstream calls.
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("market gateway listening", "addr", cfg.Addr, "mode", cfg.Mode)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	if cfg.Warm {
		go market.RunWarmer(ctx, logger, "stocks", stockWarmInterval, svc.WarmStocks)
		go market.RunWarmer(ctx, logger, "funds", fundWarmInterval, svc.WarmFunds)
	}

	<-ctx.Done()
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func newService(cfg config.Config) *market.Service {
	serviceCfg := market.Config{QuoteTTL: cfg.QuoteTTL, BatchConcurrency: 8}
	if cfg.Mode == "mock" {
		m := mock.New()
		return market.NewService(m, m, m, m, serviceCfg)
	}

	// Rate limits sit well under what each free API tolerates.
	yahooClient := upstream.New(upstream.Options{Name: "yahoo", Timeout: 8 * time.Second, RatePerSecond: 5, Burst: 10})
	mfClient := upstream.New(upstream.Options{Name: "mfapi", Timeout: 10 * time.Second, RatePerSecond: 5, Burst: 10})
	fxClient := upstream.New(upstream.Options{Name: "frankfurter", Timeout: 5 * time.Second, RatePerSecond: 2, Burst: 4})
	amfiClient := upstream.New(upstream.Options{Name: "amfi", Timeout: 30 * time.Second, RatePerSecond: 1, Burst: 1})

	return market.NewService(
		yahoo.New(yahooClient, yahoo.DefaultBaseURL),
		frankfurter.New(fxClient, frankfurter.DefaultBaseURL),
		mfapi.New(mfClient, mfapi.DefaultBaseURL),
		amfi.New(amfiClient, amfi.DefaultURL),
		serviceCfg,
	)
}
