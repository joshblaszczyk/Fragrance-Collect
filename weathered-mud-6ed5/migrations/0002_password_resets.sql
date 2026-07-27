CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index creation is deliberately deferred to 0005. The production database may
-- already contain the legacy table, whose columns are `token` and `used` rather
-- than `token_hash` and `used_at`. Referencing `token_hash` here would stop the
-- ordered migration sequence before 0005 can replace that legacy table.
