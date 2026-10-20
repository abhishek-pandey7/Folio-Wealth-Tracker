// Package config reads the gateway's settings from environment variables.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"time"
)

type Config struct {
	// Addr defaults to loopback: the gateway is internal and only the API should reach it.
	Addr     string
	Mode     string // "live" or "mock"
	QuoteTTL time.Duration
	LogLevel slog.Level
}

func Load() (Config, error) {
	cfg := Config{
		Addr:     getenv("MARKET_ADDR", "127.0.0.1:8081"),
		Mode:     getenv("MARKET_DATA_MODE", "live"),
		QuoteTTL: 15 * time.Second,
	}

	if cfg.Mode != "live" && cfg.Mode != "mock" {
		return Config{}, fmt.Errorf("MARKET_DATA_MODE must be live or mock, got %q", cfg.Mode)
	}
	if raw := os.Getenv("MARKET_QUOTE_TTL"); raw != "" {
		ttl, err := time.ParseDuration(raw)
		if err != nil || ttl < 0 {
			return Config{}, fmt.Errorf("MARKET_QUOTE_TTL must be a duration like 15s, got %q", raw)
		}
		cfg.QuoteTTL = ttl
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(getenv("LOG_LEVEL", "info"))); err != nil {
		return Config{}, fmt.Errorf("LOG_LEVEL: %w", err)
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
