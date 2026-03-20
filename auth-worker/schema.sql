-- Users table
DROP TABLE IF EXISTS users;
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    picture TEXT,
    password_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User sessions table
DROP TABLE IF EXISTS user_sessions;
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    client_ip TEXT,
    user_agent TEXT,
    fingerprint TEXT,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User preferences table
DROP TABLE IF EXISTS user_preferences;
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    scent_categories TEXT, -- JSON array of preferred scent categories
    intensity TEXT, -- light, medium, strong
    season TEXT, -- spring, summer, fall, winter, all
    occasion TEXT, -- casual, formal, date, work, special
    budget_range TEXT, -- low, medium, high, luxury
    sensitivities TEXT, -- JSON array of sensitivities/allergies
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User favorites table
DROP TABLE IF EXISTS user_favorites;
CREATE TABLE IF NOT EXISTS user_favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    fragrance_id TEXT NOT NULL, -- Corresponds to a product ID from the CJ API
    name TEXT NOT NULL,
    advertiserName TEXT,
    description TEXT,
    imageUrl TEXT,
    productUrl TEXT,
    price REAL,
    currency TEXT,
    shippingCost REAL, -- Shipping cost in the original currency
    shipping_availability TEXT,
    user_notes TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, fragrance_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_fingerprint ON user_sessions(fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_fragrance_id ON user_favorites(fragrance_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_added_at ON user_favorites(added_at);