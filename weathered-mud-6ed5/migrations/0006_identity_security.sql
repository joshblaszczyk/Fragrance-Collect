-- Bind sign-in providers to stable identities, make mailbox assurance explicit,
-- and invalidate sessions issued before the hashed-session security cutover.

-- Refuse to continue if historical data contains case-only email collisions.
-- This is intentionally fail-safe: an operator must resolve ambiguous owners
-- instead of silently merging or deleting accounts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase
    ON users(email COLLATE NOCASE);

UPDATE users
SET email = lower(trim(email));

ALTER TABLE users ADD COLUMN email_verified_at DATETIME;

CREATE TABLE user_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('password', 'google')),
    provider_subject TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    email_verified_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (provider, provider_subject),
    UNIQUE (user_id, provider)
);

CREATE INDEX idx_user_identities_user
    ON user_identities(user_id);

CREATE INDEX idx_user_identities_verified_email
    ON user_identities(email COLLATE NOCASE, email_verified_at);

-- Historical password accounts are identified but remain unverified. Their
-- owner can establish mailbox assurance through verification or password reset.
INSERT INTO user_identities (
    id, user_id, provider, provider_subject, email, email_verified_at
)
SELECT 'legacy-password:' || id, id, 'password', lower(email), lower(email), NULL
FROM users
WHERE password_hash IS NOT NULL;

CREATE TABLE email_verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_email_verification_token_hash
    ON email_verification_tokens(token_hash);

CREATE INDEX idx_email_verification_user_expiry
    ON email_verification_tokens(user_id, expires_at);

-- Cover the authenticated export, watch scheduler, favorites, and retention
-- queries that otherwise degrade into full scans as local history grows.
CREATE INDEX IF NOT EXISTS idx_outbound_clicks_user_date
    ON outbound_clicks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_clicks_created_at
    ON outbound_clicks(created_at);

CREATE INDEX IF NOT EXISTS idx_user_deal_alerts_scheduler
    ON user_deal_alerts(is_active, last_checked_at);

CREATE INDEX IF NOT EXISTS idx_user_deal_alerts_user_date
    ON user_deal_alerts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user_date
    ON user_favorites(user_id, added_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_observations_retention
    ON product_observations(observed_at);

CREATE INDEX IF NOT EXISTS idx_cj_cache_updated_at
    ON cj_cache(updated_at DESC);

CREATE TRIGGER users_email_must_be_normalized_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.email COLLATE BINARY <> lower(trim(NEW.email)) COLLATE BINARY
BEGIN
    SELECT RAISE(ABORT, 'users.email must be normalized');
END;

CREATE TRIGGER users_email_must_be_normalized_update
BEFORE UPDATE OF email ON users
FOR EACH ROW
WHEN NEW.email COLLATE BINARY <> lower(trim(NEW.email)) COLLATE BINARY
BEGIN
    SELECT RAISE(ABORT, 'users.email must be normalized');
END;

CREATE TRIGGER identities_email_must_be_normalized_insert
BEFORE INSERT ON user_identities
FOR EACH ROW
WHEN NEW.email COLLATE BINARY <> lower(trim(NEW.email)) COLLATE BINARY
BEGIN
    SELECT RAISE(ABORT, 'user_identities.email must be normalized');
END;

CREATE TRIGGER identities_email_must_be_normalized_update
BEFORE UPDATE OF email ON user_identities
FOR EACH ROW
WHEN NEW.email COLLATE BINARY <> lower(trim(NEW.email)) COLLATE BINARY
BEGIN
    SELECT RAISE(ABORT, 'user_identities.email must be normalized');
END;

-- Sessions created by older Workers may contain unhashed bearer credentials.
-- A one-time global logout is safer than trying to infer storage format.
DELETE FROM user_sessions;
