import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationsUrl = new URL('../weathered-mud-6ed5/migrations/', import.meta.url);
const integratedWorker = readFileSync(
  new URL('../weathered-mud-6ed5/src/integrated-worker.js', import.meta.url),
  'utf8'
);

test('active Worker migrations bootstrap the complete D1 schema', () => {
  const migrationFiles = readdirSync(migrationsUrl)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  assert.deepEqual(migrationFiles, [
    '0000_initial_schema.sql',
    '0001_rate_limits.sql',
    '0002_password_resets.sql',
    '0003_cj_catalog.sql',
    '0004_cj_offer_identity.sql',
    '0005_legacy_auth_compatibility.sql',
    '0006_identity_security.sql'
  ]);

  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrationFiles) {
    database.exec(readFileSync(new URL(file, migrationsUrl), 'utf8'));
  }

  const expectedColumns = {
    users: ['id', 'email', 'name', 'picture', 'password_hash', 'created_at', 'last_login', 'updated_at', 'email_verified_at'],
    user_sessions: ['id', 'user_id', 'token', 'expires_at', 'client_ip', 'user_agent', 'fingerprint', 'last_activity', 'created_at'],
    user_preferences: ['user_id', 'scent_categories', 'intensity', 'season', 'occasion', 'budget_range', 'sensitivities', 'created_at', 'updated_at'],
    user_favorites: ['id', 'user_id', 'fragrance_id', 'name', 'advertiserName', 'description', 'imageUrl', 'productUrl', 'price', 'currency', 'shippingCost', 'shipping_availability', 'user_notes', 'added_at'],
    rate_limits: ['id', 'identifier', 'endpoint', 'request_count', 'window_start', 'window_end', 'created_at'],
    password_reset_tokens: ['id', 'user_id', 'token_hash', 'expires_at', 'created_at', 'used_at'],
    cj_cache: ['cache_key', 'payload', 'expires_at', 'updated_at'],
    cj_sync_status: ['source', 'last_attempt_at', 'last_success_at', 'last_error', 'record_count', 'updated_at'],
    product_observations: ['id', 'product_key', 'product_id', 'advertiser_id', 'advertiser_name', 'title', 'brand', 'gtin', 'price', 'sale_price', 'currency', 'shipping_cost', 'availability', 'observed_on', 'observed_at'],
    product_offer_observations: ['id', 'product_key', 'offer_key', 'product_id', 'catalog_id', 'advertiser_id', 'advertiser_name', 'title', 'brand', 'gtin', 'normalized_size_ml', 'concentration', 'presentation', 'price', 'sale_price', 'currency', 'shipping_cost', 'availability', 'observed_on', 'observed_at'],
    outbound_clicks: ['id', 'user_id', 'product_id', 'advertiser_id', 'source', 'country', 'created_at'],
    user_deal_alerts: ['id', 'user_id', 'product_key', 'product_name', 'alert_type', 'target_price', 'currency', 'country', 'is_active', 'last_triggered_at', 'last_checked_at', 'last_error', 'created_at', 'updated_at'],
    user_identities: ['id', 'user_id', 'provider', 'provider_subject', 'email', 'email_verified_at', 'created_at', 'updated_at'],
    email_verification_tokens: ['id', 'user_id', 'token_hash', 'expires_at', 'created_at', 'used_at']
  };

  for (const [table, columns] of Object.entries(expectedColumns)) {
    const actualColumns = database.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name);
    assert.deepEqual(actualColumns, columns, `${table} columns do not match the Worker contract`);
  }

  const foreignKeyIssues = database.prepare('PRAGMA foreign_key_check').all();
  assert.deepEqual(foreignKeyIssues, []);
  database.close();
});

test('the complete pending sequence upgrades the legacy production schema safely', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      picture TEXT,
      password_hash TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_sessions (
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
    CREATE TABLE user_preferences (
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
    CREATE TABLE user_favorites (
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
    CREATE TABLE rate_limits (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 1,
      window_start DATETIME NOT NULL,
      window_end DATETIME NOT NULL,
      blocked_until DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_legacy_password_reset_token
      ON password_reset_tokens(token);
    INSERT INTO users (id, email, name)
      VALUES ('legacy-user', 'legacy@example.com', 'Legacy User');
    INSERT INTO user_sessions (id, user_id, token, expires_at)
      VALUES (
        'preserved-session',
        'legacy-user',
        'preserved-session-token',
        '2099-01-01T00:00:00.000Z'
      );
    INSERT INTO user_preferences (user_id, scent_categories)
      VALUES ('legacy-user', '["woody"]');
    INSERT INTO user_favorites (id, user_id, fragrance_id, name)
      VALUES ('favorite-1', 'legacy-user', 'legacy-fragrance', 'Legacy Fragrance');
    INSERT INTO rate_limits (
      id, identifier, endpoint, request_count, window_start, window_end
    ) VALUES (
      'rate-1',
      '192.0.2.1',
      '/api/login/email',
      1,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:15:00.000Z'
    );
    INSERT INTO password_reset_tokens (
      id, user_id, token, expires_at, used, ip_address, user_agent
    ) VALUES (
      'plaintext-reset',
      'legacy-user',
      'do-not-preserve-this-secret',
      '2099-01-01T00:00:00.000Z',
      0,
      '192.0.2.1',
      'legacy-test'
    );
  `);

  const migrationFiles = readdirSync(migrationsUrl)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    assert.doesNotThrow(
      () => database.exec(readFileSync(new URL(file, migrationsUrl), 'utf8')),
      `${file} must apply to the legacy production schema in order`
    );
  }

  assert.deepEqual(
    database.prepare('PRAGMA table_info(password_reset_tokens)').all().map(({ name }) => name),
    ['id', 'user_id', 'token_hash', 'expires_at', 'created_at', 'used_at']
  );
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get().count, 0);
  assert.equal(database.prepare('SELECT email FROM users WHERE id = ?').get('legacy-user').email, 'legacy@example.com');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM user_sessions').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM user_preferences').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM user_favorites').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rate_limits').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM user_deal_alerts').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM product_offer_observations').get().count, 0);
  assert.deepEqual(
    database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'password_reset_tokens'
      ORDER BY name
    `).all().map(({ name }) => name),
    ['idx_password_reset_token_hash', 'idx_password_reset_user_expiry', 'sqlite_autoindex_password_reset_tokens_1', 'sqlite_autoindex_password_reset_tokens_2']
  );
  assert.deepEqual(
    database.prepare('PRAGMA table_info(users)').all().map(({ name }) => name),
    ['id', 'email', 'name', 'picture', 'password_hash', 'created_at', 'updated_at', 'email_verified_at']
  );
  assert.doesNotMatch(
    integratedWorker,
    /\blast_login\b/,
    'the Worker must not require the optional legacy last_login column'
  );
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);

  // The identity cutover preserves account data while intentionally expiring
  // every bearer session created before tokens were guaranteed to be hashed.
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM user_sessions').get().count, 0);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  database.close();
});

test('only the integrated Worker remains as a deployment target', () => {
  assert.equal(existsSync(new URL('../auth-worker/', import.meta.url)), false);
  assert.equal(existsSync(new URL('../weathered-mud-6ed5/src/security-utils.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../weathered-mud-6ed5/src/security-headers.js', import.meta.url)), false);
});
