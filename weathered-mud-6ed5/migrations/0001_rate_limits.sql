CREATE TABLE IF NOT EXISTS rate_limits (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start DATETIME NOT NULL,
    window_end DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier_endpoint
    ON rate_limits(identifier, endpoint);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end
    ON rate_limits(window_end);
