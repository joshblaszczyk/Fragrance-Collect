import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import bridgeWorker from '../weathered-mud-6ed5/src/compatibility-worker.js';

const API_ORIGIN = 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev';
const SITE_ORIGIN = 'https://fragrancecollect.com';
const ACTIVE_UNTIL = '2026-07-27T12:00:00Z';
const migrationDirectory = new URL('../weathered-mud-6ed5/migrations/', import.meta.url);

class D1StatementStub {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new D1StatementStub(this.database, this.sql, parameters);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) || null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.parameters) };
  }
}

function createD1Stub(database) {
  let batchQueue = Promise.resolve();
  return {
    prepare(sql) {
      return new D1StatementStub(database, sql);
    },
    batch(statements) {
      const task = batchQueue.then(async () => {
        database.exec('BEGIN IMMEDIATE');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          database.exec('COMMIT');
          return results;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      });
      batchQueue = task.catch(() => {});
      return task;
    }
  };
}

function applyMigrations(database) {
  for (const name of readdirSync(migrationDirectory).filter((value) => /^\d{4}_.+\.sql$/.test(value)).sort()) {
    database.exec(readFileSync(new URL(name, migrationDirectory), 'utf8'));
  }
}

function passwordRecord(password) {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const hash = pbkdf2Sync(password, salt, 240000, 64, 'sha512').toString('hex');
  return `pbkdf2-sha512-v1$240000$${salt.toString('hex')}$${hash}`;
}

function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  applyMigrations(database);
  const verifiedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (id, email, name, password_hash, email_verified_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('bridge-user', 'bridge@example.test', 'Bridge User', passwordRecord('Correct-Horse-9!'), verifiedAt);
  database.prepare(`
    INSERT INTO user_identities (
      id, user_id, provider, provider_subject, email, email_verified_at
    ) VALUES (?, ?, 'password', ?, ?, ?)
  `).run(
    'bridge-password-identity', 'bridge-user', 'bridge@example.test', 'bridge@example.test', verifiedAt
  );
  return {
    database,
    env: {
      DB: createD1Stub(database),
      ALLOWED_ORIGIN: SITE_ORIGIN,
      LEGACY_BROWSER_AUTH_BRIDGE_UNTIL: ACTIVE_UNTIL
    }
  };
}

function request(path, options = {}) {
  return new Request(`${API_ORIGIN}${path}`, {
    ...options,
    headers: {
      Origin: SITE_ORIGIN,
      'User-Agent': 'fragrance-bridge-test-agent',
      ...(options.headers || {})
    }
  });
}

test('bridge is exact-origin, path-limited, hard-expiring, and preserves hardened cookie auth', async () => {
  const { env } = createFixture();
  const login = await bridgeWorker.fetch(request('/api/login/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bridge@example.test', password: 'Correct-Horse-9!' })
  }), env, {});
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.match(loginBody.token, /^[A-Za-z0-9_-]{40,100}$/);
  const setCookies = typeof login.headers.getSetCookie === 'function'
    ? login.headers.getSetCookie().join('\n')
    : String(login.headers.get('Set-Cookie') || '');
  assert.match(setCookies, /__Host-fragrance_session=/);
  assert.match(setCookies, /HttpOnly/);
  assert.match(setCookies, /SameSite=None/);
  assert.match(setCookies, /Secure/);
  assert.match(setCookies, /Partitioned/);

  const preflight = await bridgeWorker.fetch(request('/api/status', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization'
    }
  }), env, {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /Authorization/);
  assert.equal(preflight.headers.get('Access-Control-Max-Age'), '300');

  const bearerStatus = await bridgeWorker.fetch(request('/api/status', {
    headers: { Authorization: `Bearer ${loginBody.token}` }
  }), env, {});
  assert.equal(bearerStatus.status, 200);

  const previewLogin = await bridgeWorker.fetch(new Request('https://preview.example.workers.dev/api/login/email', {
    method: 'POST',
    headers: {
      Origin: SITE_ORIGIN,
      'User-Agent': 'fragrance-bridge-test-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: 'bridge@example.test', password: 'Correct-Horse-9!' })
  }), env, {});
  assert.equal(previewLogin.status, 200);
  assert.equal(Object.hasOwn(await previewLogin.json(), 'token'), false);

  const cookie = `__Host-fragrance_session=${encodeURIComponent(loginBody.token)}`;
  const tokenResponse = await bridgeWorker.fetch(request('/api/token?v=2', {
    headers: { Cookie: cookie }
  }), env, {});
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResponse.headers.get('Cache-Control'), 'no-store');
  assert.equal((await tokenResponse.json()).token, loginBody.token);

  const missingToken = await bridgeWorker.fetch(request('/api/token'), env, {});
  assert.equal(missingToken.status, 401);
  assert.equal(missingToken.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN);
  assert.equal(missingToken.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(missingToken.headers.get('Vary') || '', /Origin/);
  assert.equal(missingToken.headers.get('X-Content-Type-Options'), 'nosniff');

  const nonLegacyPreflight = await bridgeWorker.fetch(request('/api/products', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization'
    }
  }), env, {});
  assert.equal(nonLegacyPreflight.status, 403);

  const attackerPreflight = await bridgeWorker.fetch(new Request(`${API_ORIGIN}/api/status`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://fragrancecollect.com.attacker.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization'
    }
  }), env, {});
  assert.equal(attackerPreflight.status, 403);
  assert.equal(attackerPreflight.headers.get('Access-Control-Allow-Origin'), null);

  const expiredEnv = { ...env, LEGACY_BROWSER_AUTH_BRIDGE_UNTIL: '2026-07-27T12:00:01Z' };
  const expiredBearer = await bridgeWorker.fetch(request('/api/status', {
    headers: { Authorization: `Bearer ${loginBody.token}` }
  }), expiredEnv, {});
  assert.equal(expiredBearer.status, 401);

  const cookieWins = await bridgeWorker.fetch(request('/api/status', {
    headers: {
      Cookie: cookie,
      Authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    }
  }), env, {});
  assert.equal(cookieWins.status, 200);
  const expiredTokenRoute = await bridgeWorker.fetch(request('/api/token', {
    headers: { Cookie: cookie }
  }), expiredEnv, {});
  assert.equal(expiredTokenRoute.status, 404);
  const lastingCookie = await bridgeWorker.fetch(request('/api/status', {
    headers: { Cookie: cookie }
  }), expiredEnv, {});
  assert.equal(lastingCookie.status, 200);
});

test('bridge entrypoint is isolated from the final production Worker configuration', () => {
  const bridgeSource = readFileSync(new URL('../weathered-mud-6ed5/src/compatibility-worker.js', import.meta.url), 'utf8');
  const bridgeConfig = readFileSync(new URL('../weathered-mud-6ed5/wrangler.bridge.toml', import.meta.url), 'utf8');
  const productionConfig = readFileSync(new URL('../weathered-mud-6ed5/wrangler.toml', import.meta.url), 'utf8');

  assert.match(bridgeSource, /PRODUCTION_SITE_ORIGIN = 'https:\/\/fragrancecollect\.com'/);
  assert.match(bridgeSource, /PRODUCTION_API_ORIGIN = 'https:\/\/weathered-mud-6ed5\.joshuablaszczyk\.workers\.dev'/);
  assert.match(bridgeSource, /BRIDGE_HARD_STOP_MS/);
  assert.match(bridgeSource, /hardenedWorker\.scheduled\(controller, env, ctx\)/);
  assert.match(bridgeConfig, /main = "src\/compatibility-worker\.js"/);
  assert.match(bridgeConfig, /LEGACY_BROWSER_AUTH_BRIDGE_UNTIL = "2026-07-27T12:00:00Z"/);
  assert.doesNotMatch(productionConfig, /compatibility-worker|LEGACY_BROWSER_AUTH_BRIDGE/);
});
