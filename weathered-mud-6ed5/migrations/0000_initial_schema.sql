-- Base schema for the active Fragrance Collect Worker.
-- This migration is intentionally non-destructive so it is safe for a fresh D1
-- database and for an existing database that was initialized from the legacy
-- auth-worker/schema.sql file.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    picture TEXT,
    password_hash TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    client_ip TEXT,
    user_agent TEXT,
    fingerprint TEXT,
    last_activity DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    scent_categories TEXT,
    intensity TEXT,
    season TEXT,
    occasion TEXT,
    budget_range TEXT,
    sensitivities TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    fragrance_id TEXT NOT NULL,
    name TEXT NOT NULL,
    advertiserName TEXT,
    description TEXT,
    imageUrl TEXT,
    productUrl TEXT,
    price REAL,
    currency TEXT,
    shippingCost REAL,
    shipping_availability TEXT,
    user_notes TEXT,
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, fragrance_id)
);

CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token
    ON user_sessions(token);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
    ON user_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
    ON user_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_fingerprint
    ON user_sessions(fingerprint);

CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity
    ON user_sessions(last_activity);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id
    ON user_favorites(user_id);

CREATE INDEX IF NOT EXISTS idx_user_favorites_fragrance_id
    ON user_favorites(fragrance_id);

CREATE INDEX IF NOT EXISTS idx_user_favorites_added_at
    ON user_favorites(added_at);
