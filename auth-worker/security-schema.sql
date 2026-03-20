-- =====================================================
-- COMPREHENSIVE SECURITY SCHEMA FOR FRAGRANCE COLLECT
-- =====================================================

-- =====================================================
-- 1. PASSWORD SECURITY ENHANCEMENTS
-- =====================================================

-- Password history table to prevent reuse
DROP TABLE IF EXISTS password_history;
CREATE TABLE IF NOT EXISTS password_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Password policy table
DROP TABLE IF EXISTS password_policies;
CREATE TABLE IF NOT EXISTS password_policies (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    last_password_change DATETIME DEFAULT CURRENT_TIMESTAMP,
    password_expires_at DATETIME,
    force_change_on_next_login BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- 2. ACCOUNT LOCKOUT PROTECTION
-- =====================================================

-- Failed login attempts tracking
DROP TABLE IF EXISTS failed_login_attempts;
CREATE TABLE IF NOT EXISTS failed_login_attempts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    attempt_count INTEGER DEFAULT 1,
    first_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    locked_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Account lockout history
DROP TABLE IF EXISTS account_lockouts;
CREATE TABLE IF NOT EXISTS account_lockouts (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    email TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    reason TEXT NOT NULL, -- 'failed_attempts', 'suspicious_activity', 'manual'
    locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    unlocked_at DATETIME,
    unlocked_by TEXT, -- admin or 'automatic'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 3. CSRF PROTECTION
-- =====================================================

-- CSRF tokens table
DROP TABLE IF EXISTS csrf_tokens;
CREATE TABLE IF NOT EXISTS csrf_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- 4. SESSION SECURITY ENHANCEMENTS
-- =====================================================

-- Enhanced session tracking
DROP TABLE IF EXISTS session_events;
CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL, -- 'login', 'logout', 'activity', 'suspicious', 'expired'
    ip_address TEXT,
    user_agent TEXT,
    location TEXT, -- country/city if available
    details TEXT, -- JSON with additional event details
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE
);

-- =====================================================
-- 5. RATE LIMITING
-- =====================================================

-- Rate limiting table
DROP TABLE IF EXISTS rate_limits;
CREATE TABLE IF NOT EXISTS rate_limits (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL, -- 'ip:endpoint' or 'user:endpoint'
    endpoint TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    window_start DATETIME DEFAULT CURRENT_TIMESTAMP,
    window_end DATETIME,
    blocked_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 6. AUDIT LOGGING
-- =====================================================

-- Comprehensive audit log
DROP TABLE IF EXISTS audit_logs;
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT, -- NULL for anonymous actions
    action TEXT NOT NULL, -- 'login', 'logout', 'password_change', 'profile_update', etc.
    resource_type TEXT, -- 'user', 'session', 'favorite', etc.
    resource_id TEXT, -- ID of the affected resource
    ip_address TEXT,
    user_agent TEXT,
    details TEXT, -- JSON with action details
    success BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 7. TWO-FACTOR AUTHENTICATION
-- =====================================================

-- 2FA settings
DROP TABLE IF EXISTS two_factor_settings;
CREATE TABLE IF NOT EXISTS two_factor_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    secret_key TEXT, -- TOTP secret
    backup_codes TEXT, -- JSON array of backup codes
    last_used_backup_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2FA verification attempts
DROP TABLE IF EXISTS two_factor_attempts;
CREATE TABLE IF NOT EXISTS two_factor_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    code TEXT NOT NULL,
    success BOOLEAN DEFAULT FALSE,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE
);

-- =====================================================
-- 8. PASSWORD RESET SECURITY
-- =====================================================

-- Password reset tokens
DROP TABLE IF EXISTS password_reset_tokens;
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- 9. DATA ENCRYPTION KEYS
-- =====================================================

-- Encryption keys management
DROP TABLE IF EXISTS encryption_keys;
CREATE TABLE IF NOT EXISTS encryption_keys (
    id TEXT PRIMARY KEY,
    key_id TEXT UNIQUE NOT NULL,
    key_data TEXT NOT NULL, -- Encrypted key data
    algorithm TEXT NOT NULL, -- 'AES-256-GCM', etc.
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    active BOOLEAN DEFAULT TRUE
);

-- =====================================================
-- 10. SECURITY SETTINGS
-- =====================================================

-- Global security settings
DROP TABLE IF EXISTS security_settings;
CREATE TABLE IF NOT EXISTS security_settings (
    id TEXT PRIMARY KEY,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default security settings
INSERT OR REPLACE INTO security_settings (id, setting_key, setting_value, description) VALUES
('1', 'max_failed_attempts', '5', 'Maximum failed login attempts before lockout'),
('2', 'lockout_duration_minutes', '15', 'Account lockout duration in minutes'),
('3', 'password_min_length', '8', 'Minimum password length'),
('4', 'password_require_uppercase', 'true', 'Password must contain uppercase letter'),
('5', 'password_require_lowercase', 'true', 'Password must contain lowercase letter'),
('6', 'password_require_numbers', 'true', 'Password must contain number'),
('7', 'password_require_special', 'true', 'Password must contain special character'),
('8', 'password_expiry_days', '90', 'Password expires after this many days'),
('9', 'session_timeout_minutes', '30', 'Session timeout after inactivity'),
('10', 'max_concurrent_sessions', '3', 'Maximum concurrent sessions per user'),
('11', 'csrf_token_expiry_minutes', '60', 'CSRF token expiry time'),
('12', 'rate_limit_requests_per_minute', '60', 'Rate limit requests per minute per IP'),
('13', 'backup_code_count', '10', 'Number of backup codes for 2FA'),
('14', 'password_reset_token_expiry_minutes', '60', 'Password reset token expiry time');

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Password history indexes
CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id);
CREATE INDEX IF NOT EXISTS idx_password_history_created_at ON password_history(created_at);

-- Failed login attempts indexes
CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_email ON failed_login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_ip ON failed_login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_locked_until ON failed_login_attempts(locked_until);

-- Account lockouts indexes
CREATE INDEX IF NOT EXISTS idx_account_lockouts_user_id ON account_lockouts(user_id);
CREATE INDEX IF NOT EXISTS idx_account_lockouts_email ON account_lockouts(email);
CREATE INDEX IF NOT EXISTS idx_account_lockouts_locked_at ON account_lockouts(locked_at);

-- CSRF tokens indexes
CREATE INDEX IF NOT EXISTS idx_csrf_tokens_user_id ON csrf_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_csrf_tokens_token ON csrf_tokens(token);
CREATE INDEX IF NOT EXISTS idx_csrf_tokens_expires_at ON csrf_tokens(expires_at);

-- Session events indexes
CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_event_type ON session_events(event_type);
CREATE INDEX IF NOT EXISTS idx_session_events_created_at ON session_events(created_at);

-- Rate limits indexes
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier);
CREATE INDEX IF NOT EXISTS idx_rate_limits_endpoint ON rate_limits(endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end ON rate_limits(window_end);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs(ip_address);

-- Two-factor indexes
CREATE INDEX IF NOT EXISTS idx_two_factor_settings_user_id ON two_factor_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_two_factor_attempts_user_id ON two_factor_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_two_factor_attempts_session_id ON two_factor_attempts(session_id);

-- Password reset indexes
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- Encryption keys indexes
CREATE INDEX IF NOT EXISTS idx_encryption_keys_key_id ON encryption_keys(key_id);
CREATE INDEX IF NOT EXISTS idx_encryption_keys_active ON encryption_keys(active);
