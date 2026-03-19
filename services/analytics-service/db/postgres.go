package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ClickRecord holds all analytics data for a single redirect event.
type ClickRecord struct {
	Slug           string
	LongURL        string
	ClickedAt      time.Time
	IPAddress      string
	UserAgent      string
	Referrer       string
	Browser        string
	BrowserVersion string
	OS             string
	DeviceType     string
}

// PostgresDB wraps a pgxpool connection pool.
type PostgresDB struct {
	pool *pgxpool.Pool
}

// New creates a pgxpool and runs schema migrations.
func New(ctx context.Context, uri string) (*PostgresDB, error) {
	pool, err := pgxpool.New(ctx, uri)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}

	p := &PostgresDB{pool: pool}
	if err := p.migrate(ctx); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *PostgresDB) migrate(ctx context.Context) error {
	_, err := p.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS clicks (
			id              BIGSERIAL PRIMARY KEY,
			slug            VARCHAR(20)  NOT NULL,
			long_url        TEXT         NOT NULL,
			clicked_at      TIMESTAMPTZ  NOT NULL,
			ip_address      VARCHAR(45),
			user_agent      TEXT,
			referrer        TEXT,
			browser         VARCHAR(100),
			browser_version VARCHAR(50),
			os              VARCHAR(100),
			device_type     VARCHAR(20),
			created_at      TIMESTAMPTZ  DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_clicks_slug       ON clicks(slug);
		CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at DESC);
	`)
	return err
}

// InsertClick persists a click event to PostgreSQL.
func (p *PostgresDB) InsertClick(ctx context.Context, r ClickRecord) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO clicks
			(slug, long_url, clicked_at, ip_address, user_agent, referrer, browser, browser_version, os, device_type)
		VALUES
			($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`,
		r.Slug, r.LongURL, r.ClickedAt, r.IPAddress,
		r.UserAgent, r.Referrer, r.Browser, r.BrowserVersion,
		r.OS, r.DeviceType,
	)
	return err
}

// Close releases all pool connections.
func (p *PostgresDB) Close() {
	p.pool.Close()
}
