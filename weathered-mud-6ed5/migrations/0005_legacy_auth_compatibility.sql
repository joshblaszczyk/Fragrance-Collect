-- Normalize the password-reset table used by the legacy production database.
--
-- The legacy table stored reset credentials in a plaintext `token` column and
-- tracked use with an integer `used` flag. Those credentials cannot be safely
-- converted to the SHA-512 hashes required by the current Worker. Reset links
-- are short-lived and recoverable, so deliberately invalidate every outstanding
-- link instead of copying plaintext credentials into the current schema.
--
-- This migration intentionally leaves `users` untouched. Some legacy databases
-- do not have the optional `last_login` column, and the active Worker neither
-- reads nor writes that column. Rebuilding a referenced parent table merely to
-- add an unused column could invoke ON DELETE actions against account data.

DROP TABLE IF EXISTS password_reset_tokens;

CREATE TABLE password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash
    ON password_reset_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_expiry
    ON password_reset_tokens(user_id, expires_at);
