-- Analytics database schema for URL Shortener

CREATE TABLE IF NOT EXISTS clicks (
    id          BIGSERIAL PRIMARY KEY,
    slug        VARCHAR(20)  NOT NULL,
    long_url    TEXT         NOT NULL,
    clicked_at  TIMESTAMPTZ  NOT NULL,
    ip_address  VARCHAR(45),
    user_agent  TEXT,
    referrer    TEXT,
    browser     VARCHAR(100),
    browser_version VARCHAR(50),
    os          VARCHAR(100),
    device_type VARCHAR(20),   -- mobile | desktop | tablet | bot
    created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clicks_slug       ON clicks(slug);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at DESC);

-- Materialized view for per-slug analytics summary (refresh periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS slug_stats AS
SELECT
    slug,
    COUNT(*)                                        AS total_clicks,
    COUNT(DISTINCT ip_address)                      AS unique_visitors,
    MAX(clicked_at)                                 AS last_clicked_at,
    COUNT(*) FILTER (WHERE device_type = 'mobile')  AS mobile_clicks,
    COUNT(*) FILTER (WHERE device_type = 'desktop') AS desktop_clicks,
    COUNT(*) FILTER (WHERE device_type = 'tablet')  AS tablet_clicks
FROM clicks
GROUP BY slug;

CREATE UNIQUE INDEX IF NOT EXISTS idx_slug_stats_slug ON slug_stats(slug);
