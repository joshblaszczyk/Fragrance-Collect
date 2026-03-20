-- Migration to add security columns to user_sessions table
-- Add new security columns to existing user_sessions table
ALTER TABLE user_sessions ADD COLUMN client_ip TEXT;
ALTER TABLE user_sessions ADD COLUMN user_agent TEXT;
ALTER TABLE user_sessions ADD COLUMN fingerprint TEXT;
ALTER TABLE user_sessions ADD COLUMN last_activity DATETIME;

-- Create indexes for the new security columns
CREATE INDEX IF NOT EXISTS idx_user_sessions_fingerprint ON user_sessions(fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity);

-- Migration to add shipping cost column to user_favorites table
-- Add shipping cost column to existing user_favorites table
ALTER TABLE user_favorites ADD COLUMN shippingCost REAL;
