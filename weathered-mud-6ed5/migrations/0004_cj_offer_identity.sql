-- Preserve each retailer offer independently while retaining a shared product
-- entity key for defensible GTIN or brand+MPN comparisons. The legacy
-- product_observations table remains untouched for rollback compatibility.

CREATE TABLE IF NOT EXISTS product_offer_observations (
    id TEXT PRIMARY KEY,
    product_key TEXT NOT NULL,
    offer_key TEXT NOT NULL,
    product_id TEXT NOT NULL,
    catalog_id TEXT,
    advertiser_id TEXT,
    advertiser_name TEXT,
    title TEXT NOT NULL,
    brand TEXT,
    gtin TEXT,
    normalized_size_ml REAL,
    concentration TEXT,
    presentation TEXT,
    price REAL,
    sale_price REAL,
    currency TEXT,
    shipping_cost REAL,
    availability TEXT,
    observed_on TEXT NOT NULL,
    observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(offer_key, observed_on)
);

CREATE INDEX IF NOT EXISTS idx_product_offer_observations_product_date
    ON product_offer_observations(product_key, observed_on DESC);

CREATE INDEX IF NOT EXISTS idx_product_offer_observations_offer_date
    ON product_offer_observations(offer_key, observed_on DESC);

CREATE INDEX IF NOT EXISTS idx_product_offer_observations_gtin
    ON product_offer_observations(gtin, observed_on DESC);

CREATE INDEX IF NOT EXISTS idx_product_offer_observations_retention
    ON product_offer_observations(observed_at);
