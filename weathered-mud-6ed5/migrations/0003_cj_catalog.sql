-- Cached CJ data, observed offer history, outbound attribution, and user alerts.
-- All tables are additive and safe to apply to an existing production database.

CREATE TABLE IF NOT EXISTS cj_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cj_cache_expiry
    ON cj_cache(expires_at);

CREATE TABLE IF NOT EXISTS cj_sync_status (
    source TEXT PRIMARY KEY,
    last_attempt_at DATETIME,
    last_success_at DATETIME,
    last_error TEXT,
    record_count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_observations (
    id TEXT PRIMARY KEY,
    product_key TEXT NOT NULL,
    product_id TEXT NOT NULL,
    advertiser_id TEXT,
    advertiser_name TEXT,
    title TEXT NOT NULL,
    brand TEXT,
    gtin TEXT,
    price REAL,
    sale_price REAL,
    currency TEXT,
    shipping_cost REAL,
    availability TEXT,
    observed_on TEXT NOT NULL,
    observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_key, observed_on)
);

CREATE INDEX IF NOT EXISTS idx_product_observations_product_date
    ON product_observations(product_key, observed_on DESC);

CREATE INDEX IF NOT EXISTS idx_product_observations_gtin
    ON product_observations(gtin, observed_on DESC);

CREATE TABLE IF NOT EXISTS outbound_clicks (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    product_id TEXT NOT NULL,
    advertiser_id TEXT,
    source TEXT NOT NULL DEFAULT 'catalog',
    country TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_outbound_clicks_product_date
    ON outbound_clicks(product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_clicks_advertiser_date
    ON outbound_clicks(advertiser_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_deal_alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    product_key TEXT NOT NULL,
    product_name TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    target_price REAL,
    currency TEXT,
    country TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_triggered_at DATETIME,
    last_checked_at DATETIME,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, product_key, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_user_deal_alerts_user
    ON user_deal_alerts(user_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_deal_alerts_product
    ON user_deal_alerts(product_key, is_active);
