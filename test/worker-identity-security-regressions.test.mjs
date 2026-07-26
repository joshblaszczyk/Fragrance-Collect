import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import integratedWorker from '../weathered-mud-6ed5/src/integrated-worker.js';
import { createSessionCookie, isOriginAllowed } from '../weathered-mud-6ed5/src/http-security.js';

const root = new URL('../', import.meta.url);
const workerSource = readFileSync(new URL('weathered-mud-6ed5/src/integrated-worker.js', root), 'utf8');
const wranglerSource = readFileSync(new URL('weathered-mud-6ed5/wrangler.toml', root), 'utf8');
const migrationDirectory = new URL('weathered-mud-6ed5/migrations/', root);

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

function migrationNames() {
  return readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function applyMigrations(database, through = null) {
  for (const name of migrationNames()) {
    database.exec(readFileSync(new URL(name, migrationDirectory), 'utf8'));
    if (name === through) break;
  }
}

function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  applyMigrations(database);
  return {
    database,
    env: {
      DB: createD1Stub(database),
      ALLOWED_ORIGIN: 'https://fragrancecollect.com',
      ALLOW_LOCAL_ORIGINS: 'true',
      LOCAL_EMAIL_VERIFICATION_BYPASS: 'true',
      GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com'
    }
  };
}

function sha512(value) {
  return createHash('sha512').update(value).digest('hex');
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signGoogleToken(privateKey, kid, claims, clientId = 'test-client.apps.googleusercontent.com') {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: clientId,
    iat: now - 5,
    exp: now + 3600,
    email_verified: true,
    ...claims
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;
}

function cookieValue(response) {
  return response.headers.get('Set-Cookie')?.match(/__Host-fragrance_session=([^;]+)/)?.[1] || null;
}

function localJsonRequest(path, method, body, { cookie = null, ip = '192.0.2.10', userAgent = 'security-regression-agent' } = {}) {
  return new Request(`http://localhost:8787${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      'User-Agent': userAgent,
      ...(cookie ? { Cookie: `__Host-fragrance_session=${cookie}` } : {})
    },
    body: JSON.stringify(body)
  });
}

function createExecutionContext() {
  const tasks = [];
  return {
    waitUntil(task) {
      tasks.push(Promise.resolve(task));
    },
    get pendingTasks() {
      return tasks.length;
    },
    async drain() {
      while (tasks.length) await Promise.all(tasks.splice(0));
    }
  };
}

function pauseAfterFirstMatchingRead(binding, marker) {
  let releaseRead;
  let signalRead;
  let armed = true;
  const gate = new Promise((resolve) => { releaseRead = resolve; });
  const reached = new Promise((resolve) => { signalRead = resolve; });

  function wrap(statement, sql) {
    return {
      bind(...parameters) {
        return wrap(statement.bind(...parameters), sql);
      },
      async first() {
        const row = await statement.first();
        if (armed && sql.includes(marker)) {
          armed = false;
          signalRead();
          await gate;
        }
        return row;
      },
      run() {
        return statement.run();
      },
      all() {
        return statement.all();
      }
    };
  }

  return {
    binding: {
      prepare(sql) {
        return wrap(binding.prepare(sql), sql);
      },
      batch(statements) {
        return binding.batch(statements);
      }
    },
    reached,
    release() {
      releaseRead();
    }
  };
}

test('0006 normalizes identity data, fails closed on mixed-case writes, adds audited indexes, and invalidates old sessions', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys = ON');
    applyMigrations(database, '0005_legacy_auth_compatibility.sql');
    database.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)')
      .run('legacy-user', 'Mixed.Case@Example.COM', 'Legacy User', 'legacy-hash');
    database.prepare(`
      INSERT INTO user_sessions (id, user_id, token, expires_at, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `).run('legacy-session', 'legacy-user', 'raw-legacy-bearer', new Date(Date.now() + 60_000).toISOString(), 'old');

    database.exec(readFileSync(new URL('0006_identity_security.sql', migrationDirectory), 'utf8'));
    assert.equal(database.prepare('SELECT email FROM users WHERE id = ?').get('legacy-user').email, 'mixed.case@example.com');
    assert.equal(database.prepare('SELECT COUNT(*) AS total FROM user_sessions').get().total, 0);
    assert.deepEqual(
      { ...database.prepare('SELECT provider, provider_subject, email_verified_at FROM user_identities WHERE user_id = ?').get('legacy-user') },
      { provider: 'password', provider_subject: 'mixed.case@example.com', email_verified_at: null }
    );

    const indexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
    for (const name of [
      'idx_users_email_nocase', 'idx_outbound_clicks_user_date', 'idx_outbound_clicks_created_at',
      'idx_user_deal_alerts_scheduler', 'idx_user_deal_alerts_user_date',
      'idx_user_favorites_user_date', 'idx_product_observations_retention', 'idx_cj_cache_updated_at'
    ]) assert.ok(indexes.has(name), `${name} should exist`);

    assert.throws(() => database.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
      .run('mixed-write', 'Upper@Example.com', 'Mixed Write'), /normalized/i);
    assert.throws(() => database.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
      .run('duplicate-write', 'mixed.case@example.com', 'Duplicate'), /unique/i);
  } finally {
    database.close();
  }
});

test('origins are exact and configured, local trust is opt-in, and session cookies default to SameSite=Lax', () => {
  assert.equal(isOriginAllowed('https://fragrancecollect.com'), false);
  assert.equal(isOriginAllowed('https://fragrancecollect.com', 'https://fragrancecollect.com'), true);
  assert.equal(isOriginAllowed('https://fragrancecollect.com.attacker.test', 'https://fragrancecollect.com'), false);
  assert.equal(isOriginAllowed('http://localhost:3000', 'https://fragrancecollect.com'), false);
  assert.equal(isOriginAllowed('http://localhost:3000', '', { allowLocalOrigins: true }), true);
  assert.match(createSessionCookie('safe_token_value', 3600), /SameSite=Lax/);
  assert.doesNotMatch(createSessionCookie('safe_token_value', 3600), /Domain=/);
});

test('legacy /main.html requests redirect to the canonical root without dropping the query', async () => {
  const response = await integratedWorker.fetch(new Request(
    'https://fragrancecollect.com/main.html?q=chanel&brand=Chanel',
    { method: 'GET' }
  ), {}, {});
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), 'https://fragrancecollect.com/?q=chanel&brand=Chanel');
  assert.match(wranglerSource, /run_worker_first\s*=\s*true/);
  assert.doesNotMatch(wranglerSource, /LOCAL_EMAIL_VERIFICATION_BYPASS|ALLOW_LOCAL_ORIGINS/);
});

test('www traffic redirects permanently to the canonical apex and both hostnames are bound', async () => {
  const response = await integratedWorker.fetch(new Request(
    'https://www.fragrancecollect.com/account?tab=favorites',
    { method: 'GET' }
  ), {}, {});
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('Location'), 'https://fragrancecollect.com/account?tab=favorites');
  assert.match(response.headers.get('Strict-Transport-Security') || '', /max-age=31536000/);
  assert.match(wranglerSource, /pattern\s*=\s*"fragrancecollect\.com"\s*\ncustom_domain\s*=\s*true/);
  assert.match(wranglerSource, /pattern\s*=\s*"www\.fragrancecollect\.com"\s*\ncustom_domain\s*=\s*true/);
  assert.match(wranglerSource, /run_worker_first\s*=\s*true/);
});

test('local Wrangler custom-domain rewriting stays explicitly local and fails closed at the edge', async () => {
  const localEnvironment = {
    ALLOWED_ORIGIN: 'https://fragrancecollect.com',
    ALLOW_LOCAL_ORIGINS: 'true'
  };
  const localResponse = await integratedWorker.fetch(new Request(
    'http://fragrancecollect.com/api/signup/email',
    { method: 'OPTIONS', headers: { Origin: 'http://fragrancecollect.com' } }
  ), localEnvironment, {});
  assert.equal(localResponse.status, 204);

  const edgeResponse = await integratedWorker.fetch(new Request(
    'http://fragrancecollect.com/api/signup/email',
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://fragrancecollect.com',
        'CF-Connecting-IP': '203.0.113.10'
      }
    }
  ), localEnvironment, {});
  assert.equal(edgeResponse.status, 403);
});

test('password signup requires mailbox proof, normalizes email, bounds sessions, and deletion requires owner reauthentication', async () => {
  const fixture = createFixture();
  try {
    const password = 'Correct9!Pass';
    const signup = await integratedWorker.fetch(localJsonRequest('/api/signup/email', 'POST', {
      name: 'Case Owner',
      email: '  Case.Owner@Example.COM ',
      password
    }), fixture.env, {});
    assert.equal(signup.status, 202, await signup.clone().text());
    assert.equal(signup.headers.get('Set-Cookie'), null, 'signup must not create a session before mailbox proof');
    assert.match(signup.headers.get('Cache-Control') || '', /no-store/);
    const signupBody = await signup.json();
    assert.equal(signupBody.verificationRequired, true);
    assert.match(signupBody.verificationToken, /^[A-Za-z0-9_-]{40,100}$/);
    const storedUser = fixture.database.prepare('SELECT id, email, email_verified_at, password_hash FROM users').get();
    assert.equal(storedUser.email, 'case.owner@example.com');
    assert.equal(storedUser.email_verified_at, null);
    assert.match(storedUser.password_hash, /^pbkdf2-sha512-v1\$240000\$/);

    const unverifiedLogin = await integratedWorker.fetch(localJsonRequest('/api/login/email', 'POST', {
      email: 'CASE.OWNER@example.com', password
    }), fixture.env, {});
    assert.equal(unverifiedLogin.status, 403);
    assert.equal((await unverifiedLogin.json()).code, 'email_verification_required');

    const verify = await integratedWorker.fetch(localJsonRequest('/api/signup/verify', 'POST', {
      token: signupBody.verificationToken
    }), fixture.env, {});
    assert.equal(verify.status, 200, await verify.text());
    const verifiedCookie = cookieValue(verify);
    assert.ok(verifiedCookie);
    assert.match(verify.headers.get('Set-Cookie'), /SameSite=Lax/);

    const replay = await integratedWorker.fetch(localJsonRequest('/api/signup/verify', 'POST', {
      token: signupBody.verificationToken
    }), fixture.env, {});
    assert.equal(replay.status, 400, 'verification tokens must be single-use');

    const status = await integratedWorker.fetch(new Request('http://localhost:8787/api/status', {
      headers: {
        Origin: 'http://localhost:3000',
        Cookie: `__Host-fragrance_session=${verifiedCookie}`,
        'CF-Connecting-IP': '198.51.100.77',
        'User-Agent': 'security-regression-agent'
      }
    }), fixture.env, {});
    assert.equal(status.status, 200, 'an IP change should not invalidate the same browser session');
    assert.equal((await status.clone().json()).user.hasGoogleIdentity, false);
    const sessionRow = fixture.database.prepare('SELECT token, client_ip, user_agent FROM user_sessions').get();
    assert.notEqual(sessionRow.token, verifiedCookie, 'bearer token must be hashed at rest');
    assert.equal(sessionRow.client_ip, null);
    assert.equal(sessionRow.user_agent, null);

    for (let index = 0; index < 9; index += 1) {
      fixture.database.prepare(`
        INSERT INTO user_sessions (id, user_id, token, expires_at, fingerprint)
        VALUES (?, ?, ?, ?, ?)
      `).run(`extra-${index}`, storedUser.id, sha512(`extra-token-${index}`), new Date(Date.now() + 60_000).toISOString(), sha512('ua:security-regression-agent'));
    }
    const freshLogin = await integratedWorker.fetch(localJsonRequest('/api/login/email', 'POST', {
      email: 'case.owner@example.com', password
    }), fixture.env, {});
    assert.equal(freshLogin.status, 200, await freshLogin.text());
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS total FROM user_sessions WHERE user_id = ?').get(storedUser.id).total, 8);
    const currentCookie = cookieValue(freshLogin);

    fixture.database.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
      .run('unrelated-owner', 'unrelated@example.com', 'Unrelated Owner');
    const missingProof = await integratedWorker.fetch(localJsonRequest('/api/user/account', 'DELETE', {
      confirmation: 'DELETE'
    }, { cookie: currentCookie }), fixture.env, {});
    assert.equal(missingProof.status, 400);
    assert.equal((await missingProof.json()).code, 'password_reauthentication_required');

    const wrongProof = await integratedWorker.fetch(localJsonRequest('/api/user/account', 'DELETE', {
      confirmation: 'DELETE', currentPassword: 'Wrong9!Password'
    }, { cookie: currentCookie }), fixture.env, {});
    assert.equal(wrongProof.status, 401);
    assert.ok(fixture.database.prepare('SELECT id FROM users WHERE id = ?').get(storedUser.id));

    const deletion = await integratedWorker.fetch(localJsonRequest('/api/user/account', 'DELETE', {
      confirmation: 'DELETE', currentPassword: password
    }, { cookie: currentCookie }), fixture.env, {});
    assert.equal(deletion.status, 200, await deletion.text());
    assert.match(deletion.headers.get('Set-Cookie'), /Max-Age=-1/);
    assert.equal(fixture.database.prepare('SELECT id FROM users WHERE id = ?').get(storedUser.id), undefined);
    assert.ok(fixture.database.prepare('SELECT id FROM users WHERE id = ?').get('unrelated-owner'), 'deletion must remain owner-scoped');
  } finally {
    fixture.database.close();
  }
});

test('provider-only deletion requests fresh Google reauthentication and export fails honestly when schema data is unavailable', async () => {
  const fixture = createFixture();
  try {
    const verifiedAt = new Date().toISOString();
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, email_verified_at) VALUES (?, ?, ?, ?)
    `).run('google-owner', 'google.owner@example.com', 'Google Owner', verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'google', ?, ?, ?)
    `).run('google-identity', 'google-owner', 'immutable-google-subject', 'google.owner@example.com', verifiedAt);
    const sessionToken = 'provider_session_token_value_123456789012345';
    fixture.database.prepare(`
      INSERT INTO user_sessions (id, user_id, token, expires_at, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'google-session', 'google-owner', sha512(sessionToken),
      new Date(Date.now() + 60_000).toISOString(), sha512('ua:security-regression-agent')
    );

    fixture.database.exec('DROP TABLE outbound_clicks');
    const exportResponse = await integratedWorker.fetch(new Request('http://localhost:8787/api/user/export', {
      headers: {
        Origin: 'http://localhost:3000',
        Cookie: `__Host-fragrance_session=${sessionToken}`,
        'CF-Connecting-IP': '192.0.2.30',
        'User-Agent': 'security-regression-agent'
      }
    }), fixture.env, {});
    assert.equal(exportResponse.status, 500, 'export must not silently replace a failed dataset with []');

    const deletion = await integratedWorker.fetch(localJsonRequest('/api/user/account', 'DELETE', {
      confirmation: 'DELETE'
    }, { cookie: sessionToken, ip: '192.0.2.30' }), fixture.env, {});
    assert.equal(deletion.status, 400);
    assert.deepEqual(await deletion.json(), {
      error: 'Reauthenticate with Google to delete this account.',
      code: 'google_reauthentication_required',
      provider: 'google'
    });
    assert.ok(fixture.database.prepare('SELECT id FROM users WHERE id = ?').get('google-owner'));
  } finally {
    fixture.database.close();
  }
});

test('legacy password login lazily upgrades to the versioned 240k PBKDF2 record', async () => {
  const fixture = createFixture();
  try {
    const password = 'Legacy9!Password';
    const verifiedAt = new Date().toISOString();
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('legacy-login', 'legacy.login@example.com', 'Legacy Login', sha512(password), verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'password', ?, ?, ?)
    `).run('legacy-login-identity', 'legacy-login', 'legacy.login@example.com', 'legacy.login@example.com', verifiedAt);

    const response = await integratedWorker.fetch(localJsonRequest('/api/login/email', 'POST', {
      email: 'LEGACY.LOGIN@EXAMPLE.COM', password
    }), fixture.env, {});
    assert.equal(response.status, 200, await response.text());
    assert.match(
      fixture.database.prepare('SELECT password_hash FROM users WHERE id = ?').get('legacy-login').password_hash,
      /^pbkdf2-sha512-v1\$240000\$/
    );
  } finally {
    fixture.database.close();
  }
});

test('password recovery sends a fragment credential, consumes it once, and rotates existing sessions', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  let emailPayload = null;
  globalThis.fetch = async (input, options) => {
    assert.equal(String(input), 'https://api.resend.com/emails');
    emailPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'reset-email-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const oldPassword = 'OldPassword9!';
    const newPassword = 'NewPassword9!';
    const verifiedAt = new Date().toISOString();
    Object.assign(fixture.env, {
      RESEND_API_KEY: 're_test_only',
      RESEND_FROM: 'Fragrance Collect <support@fragrancecollect.com>'
    });
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('reset-owner', 'reset.owner@example.com', 'Reset Owner', sha512(oldPassword), verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'password', ?, ?, ?)
    `).run('reset-identity', 'reset-owner', 'reset.owner@example.com', 'reset.owner@example.com', verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_sessions (id, user_id, token, expires_at, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'old-reset-session', 'reset-owner', sha512('old_session_token_value_123456789012345'),
      new Date(Date.now() + 60_000).toISOString(), sha512('ua:security-regression-agent')
    );

    const emailContext = createExecutionContext();
    const forgot = await integratedWorker.fetch(localJsonRequest('/api/password/forgot', 'POST', {
      email: 'RESET.OWNER@example.com'
    }), fixture.env, emailContext);
    assert.equal(forgot.status, 200, await forgot.clone().text());
    assert.equal(emailContext.pendingTasks, 1);
    await emailContext.drain();
    assert.ok(emailPayload?.html);
    assert.doesNotMatch(emailPayload.html, /auth\.html\?reset_token=/);
    const token = emailPayload.html.match(/auth\.html#reset_token=([A-Za-z0-9_-]+)/)?.[1];
    assert.match(token, /^[A-Za-z0-9_-]{40,100}$/);
    assert.equal(
      fixture.database.prepare('SELECT token_hash FROM password_reset_tokens WHERE user_id = ?')
        .get('reset-owner').token_hash,
      sha512(token),
      'only the token digest may be stored'
    );

    const reset = await integratedWorker.fetch(localJsonRequest('/api/password/reset', 'POST', {
      token,
      password: newPassword
    }), fixture.env, {});
    assert.equal(reset.status, 200, await reset.clone().text());
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM user_sessions WHERE user_id = ?'
    ).get('reset-owner').total, 0, 'password reset must revoke every prior session');

    const replay = await integratedWorker.fetch(localJsonRequest('/api/password/reset', 'POST', {
      token,
      password: newPassword
    }), fixture.env, {});
    assert.equal(replay.status, 400);
    const login = await integratedWorker.fetch(localJsonRequest('/api/login/email', 'POST', {
      email: 'reset.owner@example.com', password: newPassword
    }), fixture.env, {});
    assert.equal(login.status, 200, await login.clone().text());
  } finally {
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('failed email delivery preserves older recovery links while one redemption revokes every sibling', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://api.resend.com/emails');
    providerCalls += 1;
    throw new Error('simulated delivery outage');
  };

  try {
    Object.assign(fixture.env, {
      LOCAL_EMAIL_VERIFICATION_BYPASS: 'false',
      RESEND_API_KEY: 're_test_only',
      RESEND_FROM: 'Fragrance Collect <support@fragrancecollect.com>'
    });
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();
    const oldVerificationToken = 'v'.repeat(48);
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash)
      VALUES (?, ?, ?, ?)
    `).run('verification-overlap', 'verification.overlap@example.com', 'Verification Overlap', sha512('OldPassword9!'));
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email)
      VALUES (?, ?, 'password', ?, ?)
    `).run(
      'verification-overlap-identity', 'verification-overlap',
      'verification.overlap@example.com', 'verification.overlap@example.com'
    );
    fixture.database.prepare(`
      INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('old-verification-row', 'verification-overlap', sha512(oldVerificationToken), expiresAt, createdAt);

    const verificationContext = createExecutionContext();
    const resend = await integratedWorker.fetch(localJsonRequest('/api/signup/verification/resend', 'POST', {
      email: 'verification.overlap@example.com'
    }, { ip: '192.0.2.171' }), fixture.env, verificationContext);
    assert.equal(resend.status, 202, await resend.clone().text());
    assert.equal(verificationContext.pendingTasks, 1);
    await verificationContext.drain();
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) AS total FROM email_verification_tokens
      WHERE user_id = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')
    `).get('verification-overlap').total, 2, 'a failed resend must not revoke a delivered link');

    const verified = await integratedWorker.fetch(localJsonRequest('/api/signup/verify', 'POST', {
      token: oldVerificationToken
    }, { ip: '192.0.2.172' }), fixture.env, {});
    assert.equal(verified.status, 200, await verified.clone().text());
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM email_verification_tokens WHERE user_id = ?'
    ).get('verification-overlap').total, 0, 'redeeming either sibling must revoke all verification links');

    const oldResetToken = 'r'.repeat(48);
    const verifiedAt = new Date().toISOString();
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('reset-overlap', 'reset.overlap@example.com', 'Reset Overlap', sha512('OldPassword9!'), verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'password', ?, ?, ?)
    `).run(
      'reset-overlap-identity', 'reset-overlap',
      'reset.overlap@example.com', 'reset.overlap@example.com', verifiedAt
    );
    fixture.database.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('old-reset-row', 'reset-overlap', sha512(oldResetToken), expiresAt, createdAt);

    const resetContext = createExecutionContext();
    const forgot = await integratedWorker.fetch(localJsonRequest('/api/password/forgot', 'POST', {
      email: 'reset.overlap@example.com'
    }, { ip: '192.0.2.173' }), fixture.env, resetContext);
    assert.equal(forgot.status, 200, await forgot.clone().text());
    assert.equal(resetContext.pendingTasks, 1);
    await resetContext.drain();
    assert.equal(fixture.database.prepare(`
      SELECT COUNT(*) AS total FROM password_reset_tokens
      WHERE user_id = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')
    `).get('reset-overlap').total, 2, 'a failed reset email must leave the older delivered link usable');

    const reset = await integratedWorker.fetch(localJsonRequest('/api/password/reset', 'POST', {
      token: oldResetToken,
      password: 'NewPassword9!'
    }, { ip: '192.0.2.174' }), fixture.env, {});
    assert.equal(reset.status, 200, await reset.clone().text());
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM password_reset_tokens WHERE user_id = ?'
    ).get('reset-overlap').total, 0, 'one successful reset must revoke every sibling reset link');
    assert.equal(providerCalls, 2);

    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash)
      VALUES (?, ?, ?, ?)
    `).run('verification-cap', 'verification.cap@example.com', 'Verification Cap', sha512('OldPassword9!'));
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email)
      VALUES (?, ?, 'password', ?, ?)
    `).run(
      'verification-cap-identity', 'verification-cap',
      'verification.cap@example.com', 'verification.cap@example.com'
    );
    const insertCappedToken = fixture.database.prepare(`
      INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, 'verification-cap', ?, ?, ?)
    `);
    for (let index = 0; index < 8; index += 1) {
      insertCappedToken.run(`cap-token-${index}`, sha512(`cap-token-${index}`), expiresAt, createdAt);
    }
    const cappedContext = createExecutionContext();
    const capped = await integratedWorker.fetch(localJsonRequest('/api/signup/verification/resend', 'POST', {
      email: 'verification.cap@example.com'
    }, { ip: '192.0.2.175' }), fixture.env, cappedContext);
    assert.equal(capped.status, 202, await capped.clone().text());
    assert.equal(cappedContext.pendingTasks, 0, 'the hard cap must not queue an email for an unstored token');
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM email_verification_tokens WHERE user_id = ?'
    ).get('verification-cap').total, 8);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('sibling verification and reset tokens are claimed account-atomically', async () => {
  const fixture = createFixture();
  try {
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash)
      VALUES (?, ?, ?, ?)
    `).run('verification-race', 'verification.race@example.com', 'Verification Race', sha512('OldPassword9!'));
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email)
      VALUES (?, ?, 'password', ?, ?)
    `).run(
      'verification-race-identity', 'verification-race',
      'verification.race@example.com', 'verification.race@example.com'
    );
    const verificationTokens = ['a'.repeat(48), 'b'.repeat(48)];
    const insertVerification = fixture.database.prepare(`
      INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, 'verification-race', ?, ?, ?)
    `);
    verificationTokens.forEach((token, index) => {
      insertVerification.run(`verification-race-${index}`, sha512(token), expiresAt, createdAt);
    });
    const verificationResponses = await Promise.all(verificationTokens.map((token, index) => integratedWorker.fetch(
      localJsonRequest('/api/signup/verify', 'POST', { token }, { ip: `192.0.2.${180 + index}` }),
      fixture.env,
      {}
    )));
    assert.deepEqual(verificationResponses.map(({ status }) => status).sort(), [200, 400]);
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM user_sessions WHERE user_id = ?'
    ).get('verification-race').total, 1);

    const verifiedAt = new Date().toISOString();
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('reset-race', 'reset.race@example.com', 'Reset Race', sha512('OldPassword9!'), verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'password', ?, ?, ?)
    `).run('reset-race-identity', 'reset-race', 'reset.race@example.com', 'reset.race@example.com', verifiedAt);
    const resetTokens = ['c'.repeat(48), 'd'.repeat(48)];
    const insertReset = fixture.database.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, 'reset-race', ?, ?, ?)
    `);
    resetTokens.forEach((token, index) => {
      insertReset.run(`reset-race-${index}`, sha512(token), expiresAt, createdAt);
    });
    const resetResponses = await Promise.all(resetTokens.map((token, index) => integratedWorker.fetch(
      localJsonRequest('/api/password/reset', 'POST', {
        token,
        password: index === 0 ? 'FirstWinner9!' : 'SecondWinner9!'
      }, { ip: `192.0.2.${182 + index}` }),
      fixture.env,
      {}
    )));
    assert.deepEqual(resetResponses.map(({ status }) => status).sort(), [200, 400]);
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM password_reset_tokens WHERE user_id = ?'
    ).get('reset-race').total, 0);
  } finally {
    fixture.database.close();
  }
});

test('in-flight issuance cannot recreate a token after verification or password rotation', async () => {
  const verificationFixture = createFixture();
  try {
    const oldToken = 'e'.repeat(48);
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    verificationFixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash)
      VALUES (?, ?, ?, ?)
    `).run('issuance-verify-race', 'issuance.verify@example.com', 'Issuance Verify', sha512('OldPassword9!'));
    verificationFixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email)
      VALUES (?, ?, 'password', ?, ?)
    `).run(
      'issuance-verify-identity', 'issuance-verify-race',
      'issuance.verify@example.com', 'issuance.verify@example.com'
    );
    verificationFixture.database.prepare(`
      INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run('issuance-verify-old', 'issuance-verify-race', sha512(oldToken), expiresAt);

    const paused = pauseAfterFirstMatchingRead(
      verificationFixture.env.DB,
      "AS verification_version"
    );
    verificationFixture.env.DB = paused.binding;
    const resendPromise = integratedWorker.fetch(localJsonRequest('/api/signup/verification/resend', 'POST', {
      email: 'issuance.verify@example.com'
    }, { ip: '192.0.2.190' }), verificationFixture.env, {});
    await paused.reached;

    const verified = await integratedWorker.fetch(localJsonRequest('/api/signup/verify', 'POST', {
      token: oldToken
    }, { ip: '192.0.2.191' }), verificationFixture.env, {});
    assert.equal(verified.status, 200, await verified.clone().text());
    paused.release();
    const resend = await resendPromise;
    assert.equal(resend.status, 202, await resend.clone().text());
    assert.equal(Object.hasOwn(await resend.json(), 'verificationToken'), false);
    assert.equal(verificationFixture.database.prepare(
      'SELECT COUNT(*) AS total FROM email_verification_tokens WHERE user_id = ?'
    ).get('issuance-verify-race').total, 0, 'the stale issuance snapshot must not recreate a verification link');
  } finally {
    verificationFixture.database.close();
  }

  const resetFixture = createFixture();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error('a stale issuance must not reach the email provider');
  };
  try {
    Object.assign(resetFixture.env, {
      RESEND_API_KEY: 're_test_only',
      RESEND_FROM: 'Fragrance Collect <support@fragrancecollect.com>'
    });
    const oldToken = 'f'.repeat(48);
    const oldPasswordHash = sha512('OldPassword9!');
    const verifiedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    resetFixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('issuance-reset-race', 'issuance.reset@example.com', 'Issuance Reset', oldPasswordHash, verifiedAt);
    resetFixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'password', ?, ?, ?)
    `).run(
      'issuance-reset-identity', 'issuance-reset-race',
      'issuance.reset@example.com', 'issuance.reset@example.com', verifiedAt
    );
    resetFixture.database.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('issuance-reset-old', 'issuance-reset-race', sha512(oldToken), expiresAt, verifiedAt);

    const paused = pauseAfterFirstMatchingRead(resetFixture.env.DB, 'AS password_version');
    resetFixture.env.DB = paused.binding;
    const forgotPromise = integratedWorker.fetch(localJsonRequest('/api/password/forgot', 'POST', {
      email: 'issuance.reset@example.com'
    }, { ip: '192.0.2.192' }), resetFixture.env, createExecutionContext());
    await paused.reached;

    const reset = await integratedWorker.fetch(localJsonRequest('/api/password/reset', 'POST', {
      token: oldToken,
      password: 'RotatedPassword9!'
    }, { ip: '192.0.2.193' }), resetFixture.env, {});
    assert.equal(reset.status, 200, await reset.clone().text());
    paused.release();
    const forgot = await forgotPromise;
    assert.equal(forgot.status, 200, await forgot.clone().text());
    assert.equal(providerCalls, 0);
    assert.equal(resetFixture.database.prepare(
      'SELECT COUNT(*) AS total FROM password_reset_tokens WHERE user_id = ?'
    ).get('issuance-reset-race').total, 0, 'the stale password version must block a post-reset token');
  } finally {
    globalThis.fetch = originalFetch;
    resetFixture.database.close();
  }
});

test('signup, verification resend, and password recovery hide provider latency and account existence', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  let releaseProvider;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  let providerCalls = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://api.resend.com/emails');
    providerCalls += 1;
    await providerGate;
    throw new Error('simulated provider outage');
  };

  try {
    Object.assign(fixture.env, {
      LOCAL_EMAIL_VERIFICATION_BYPASS: 'false',
      RESEND_API_KEY: 're_test_only',
      RESEND_FROM: 'Fragrance Collect <support@fragrancecollect.com>'
    });
    const verifiedAt = new Date().toISOString();
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('existing-owner', 'existing@example.com', 'Existing Owner', sha512('Existing9!Pass'), verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'password', ?, ?, ?)
    `).run('existing-identity', 'existing-owner', 'existing@example.com', 'existing@example.com', verifiedAt);

    const signupNewContext = createExecutionContext();
    const signupExistingContext = createExecutionContext();
    const signupPromise = Promise.all([
      integratedWorker.fetch(localJsonRequest('/api/signup/email', 'POST', {
        name: 'New Owner', email: 'new.owner@example.com', password: 'Correct9!Pass'
      }, { ip: '192.0.2.141' }), fixture.env, signupNewContext),
      integratedWorker.fetch(localJsonRequest('/api/signup/email', 'POST', {
        name: 'Existing Owner', email: 'existing@example.com', password: 'Correct9!Pass'
      }, { ip: '192.0.2.142' }), fixture.env, signupExistingContext)
    ]);
    const signupTimed = await Promise.race([
      signupPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 2_000))
    ]);
    assert.ok(signupTimed, 'signup responses must not wait for the email provider');
    const [newSignup, existingSignup] = signupTimed;
    assert.equal(newSignup.status, 202);
    assert.equal(existingSignup.status, 202);
    assert.deepEqual(await newSignup.json(), await existingSignup.json());
    assert.equal(signupNewContext.pendingTasks, 1);
    assert.equal(signupExistingContext.pendingTasks, 0);

    const resendEligibleContext = createExecutionContext();
    const resendAbsentContext = createExecutionContext();
    const [eligibleResend, absentResend] = await Promise.all([
      integratedWorker.fetch(localJsonRequest('/api/signup/verification/resend', 'POST', {
        email: 'new.owner@example.com'
      }, { ip: '192.0.2.143' }), fixture.env, resendEligibleContext),
      integratedWorker.fetch(localJsonRequest('/api/signup/verification/resend', 'POST', {
        email: 'absent.resend@example.com'
      }, { ip: '192.0.2.144' }), fixture.env, resendAbsentContext)
    ]);
    assert.equal(eligibleResend.status, 202);
    assert.equal(absentResend.status, 202);
    assert.deepEqual(await eligibleResend.json(), await absentResend.json());
    assert.equal(resendEligibleContext.pendingTasks, 1);
    assert.equal(resendAbsentContext.pendingTasks, 0);

    const forgotEligibleContext = createExecutionContext();
    const forgotAbsentContext = createExecutionContext();
    const [eligibleForgot, absentForgot] = await Promise.all([
      integratedWorker.fetch(localJsonRequest('/api/password/forgot', 'POST', {
        email: 'existing@example.com'
      }, { ip: '192.0.2.145' }), fixture.env, forgotEligibleContext),
      integratedWorker.fetch(localJsonRequest('/api/password/forgot', 'POST', {
        email: 'absent.forgot@example.com'
      }, { ip: '192.0.2.146' }), fixture.env, forgotAbsentContext)
    ]);
    assert.equal(eligibleForgot.status, 200);
    assert.equal(absentForgot.status, 200);
    assert.deepEqual(await eligibleForgot.json(), await absentForgot.json());
    assert.equal(forgotEligibleContext.pendingTasks, 1);
    assert.equal(forgotAbsentContext.pendingTasks, 0);
    assert.equal(providerCalls, 3, 'only eligible delivery work should be queued');

    releaseProvider();
    await Promise.all([
      signupNewContext.drain(), signupExistingContext.drain(),
      resendEligibleContext.drain(), resendAbsentContext.drain(),
      forgotEligibleContext.drain(), forgotAbsentContext.drain()
    ]);
  } finally {
    releaseProvider?.();
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('streamed oversized JSON is rejected, malformed cookies stay unauthenticated, and health attests the real schema', async () => {
  const fixture = createFixture();
  try {
    fixture.env.RESEND_API_KEY = 're_test_only';
    fixture.env.RESEND_FROM = 'Fragrance Collect <support@fragrancecollect.com>';
    fixture.env.CONTACT_RECIPIENT = 'support@fragrancecollect.com';
    fixture.env.CJ_PERSONAL_ACCESS_TOKEN = 'test-token';
    fixture.env.CJ_COMPANY_ID = '123';
    fixture.env.CJ_WEBSITE_ID = '456';

    const oversized = new Request('http://localhost:8787/api/signup/email', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.45'
      },
      body: JSON.stringify({ name: 'x'.repeat(17 * 1024), email: 'large@example.com', password: 'Correct9!Pass' })
    });
    assert.equal(oversized.headers.get('Content-Length'), null, 'test must exercise the streamed/no-length path');
    const oversizedResponse = await integratedWorker.fetch(oversized, fixture.env, {});
    assert.equal(oversizedResponse.status, 413);

    const malformedCookie = await integratedWorker.fetch(new Request('http://localhost:8787/api/status', {
      headers: { Cookie: '__Host-fragrance_session=%E0%A4%A' }
    }), fixture.env, {});
    assert.equal(malformedCookie.status, 401);

    const health = await integratedWorker.fetch(new Request('https://fragrancecollect.com/api/health'), fixture.env, {});
    assert.equal(health.status, 200, await health.clone().text());
    const healthBody = await health.json();
    assert.deepEqual(healthBody.schema, { ready: true, version: '0006_identity_security' });

    fixture.database.exec('DROP TRIGGER users_email_must_be_normalized_update');
    const degraded = await integratedWorker.fetch(new Request('https://fragrancecollect.com/api/health'), fixture.env, {});
    assert.equal(degraded.status, 503);
    assert.equal((await degraded.json()).schema.ready, false);
  } finally {
    fixture.database.close();
  }
});

test('a cold, high-fanout product search cannot exceed the durable global CJ upstream budget', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    upstreamCalls += 1;
    if (url.startsWith('https://advertiser-lookup.api.cj.com/')) {
      return new Response(`<?xml version="1.0"?><cj-api><advertisers total-matched="4">
        ${['101', '102', '103', '104'].map((id) => `<advertiser>
          <advertiser-id>${id}</advertiser-id><advertiser-name>Retailer ${id}</advertiser-name>
          <account-status>Active</account-status><relationship-status>Joined</relationship-status>
        </advertiser>`).join('')}
      </advertisers></cj-api>`, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    if (url === 'https://ads.api.cj.com/query') {
      return new Response(JSON.stringify({
        data: { shoppingProducts: { resultList: [], totalCount: 100 } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  };

  try {
    Object.assign(fixture.env, {
      CJ_PERSONAL_ACCESS_TOKEN: 'test-cj-token',
      CJ_COMPANY_ID: '123',
      CJ_WEBSITE_ID: '456',
      CJ_ADVERTISER_IDS: 'all',
      CJ_GLOBAL_UPSTREAM_REQUESTS_PER_MINUTE: '10'
    });
    const response = await integratedWorker.fetch(new Request(
      'https://fragrancecollect.com/api/products?q=Chanel&brand=Chanel',
      { headers: { 'CF-Connecting-IP': '192.0.2.90' } }
    ), fixture.env, {});
    assert.equal(response.status, 200, await response.text());
    assert.ok(upstreamCalls > 1, 'the fixture should exercise cold multi-branch discovery');
    assert.ok(upstreamCalls <= 10, `global limit was exceeded with ${upstreamCalls} upstream calls`);
    const budget = fixture.database.prepare(`
      SELECT request_count FROM rate_limits WHERE endpoint = 'cj-upstream-global-v1'
    `).get();
    assert.equal(budget.request_count, 11, 'the denied eleventh reservation is recorded but must not reach CJ');
  } finally {
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('public CJ feeds survive consecutive outages from a bounded stale-rescue window', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  const recentCacheKey = 'cj:deals:coupon:US:dior:1:100';
  const ancientCacheKey = 'cj:deals:coupon:US:ancient:1:100';
  const now = Date.now();
  const cachedPayload = JSON.stringify({
    deals: [{
      id: 'cached-coupon',
      advertiserId: '101',
      advertiserName: 'Joined Retailer',
      name: 'Cached fragrance coupon',
      clickUrl: 'https://example.test/cached-coupon'
    }],
    total: 1,
    page: 1,
    pageSize: 100
  });
  fixture.database.prepare(`
    INSERT INTO cj_cache (cache_key, payload, expires_at, updated_at)
    VALUES (?, ?, ?, ?), (?, ?, ?, ?)
  `).run(
    recentCacheKey,
    cachedPayload,
    new Date(now - 60_000).toISOString(),
    new Date(now - 120_000).toISOString(),
    ancientCacheKey,
    cachedPayload,
    new Date(now - (25 * 60 * 60 * 1000)).toISOString(),
    new Date(now - (25 * 60 * 60 * 1000)).toISOString()
  );
  const insertFiller = fixture.database.prepare(`
    INSERT INTO cj_cache (cache_key, payload, expires_at, updated_at) VALUES (?, ?, ?, ?)
  `);
  for (let index = 0; index < 55; index += 1) {
    insertFiller.run(
      `cj:test-filler:${index}`,
      '{}',
      new Date(now - 60_000).toISOString(),
      new Date(now - ((10 + index) * 60_000)).toISOString()
    );
  }
  Object.assign(fixture.env, {
    CJ_CACHE_MAX_ROWS: '50',
    CJ_COMPANY_ID: '123',
    CJ_WEBSITE_ID: '456',
    CJ_PERSONAL_ACCESS_TOKEN: 'test-cj-token'
  });

  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('simulated repeated CJ outage');
  };

  const requestDeals = (query, ip) => integratedWorker.fetch(new Request(
    `https://fragrancecollect.com/api/deals?type=coupon&country=US&q=${query}`,
    { headers: { 'CF-Connecting-IP': ip } }
  ), fixture.env, {});

  try {
    const first = await requestDeals('dior', '192.0.2.120');
    const second = await requestDeals('dior', '192.0.2.121');
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal(second.status, 200, await second.clone().text());
    for (const response of [first, second]) {
      const body = await response.json();
      assert.equal(body.stale, true);
      assert.equal(body.deals[0].id, 'cached-coupon');
      assert.match(body.warning, /last successful update/i);
    }
    assert.ok(fixture.database.prepare('SELECT 1 FROM cj_cache WHERE cache_key = ?').get(recentCacheKey));
    assert.ok(
      fixture.database.prepare('SELECT COUNT(*) AS total FROM cj_cache').get().total <= 50,
      'the stale-rescue window must remain subordinate to the global row cap'
    );

    const tooOld = await requestDeals('ancient', '192.0.2.122');
    assert.equal(tooOld.status, 503);
    assert.equal(fixture.database.prepare('SELECT 1 FROM cj_cache WHERE cache_key = ?').get(ancientCacheKey), undefined);
    assert.equal(upstreamCalls, 3, 'each cold retry may try CJ once but must retain recent stale rescue data');
  } finally {
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('catalog observations run only on cache misses, are globally capped, and popularity aggregation is cached', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  const baseDb = fixture.env.DB;
  let popularityQueries = 0;
  let observationBatches = 0;
  fixture.env.DB = {
    prepare(sql) {
      if (/GROUP BY product_id/i.test(sql)) popularityQueries += 1;
      return baseDb.prepare(sql);
    },
    batch(statements) {
      if (statements.some((statement) => /INSERT INTO product_offer_observations/i.test(statement.sql))) {
        observationBatches += 1;
      }
      return baseDb.batch(statements);
    }
  };
  let upstreamCalls = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://ads.api.cj.com/query');
    upstreamCalls += 1;
    return new Response(JSON.stringify({
      data: {
        shoppingProducts: {
          totalCount: 1,
          resultList: [{
            id: 'offer-1',
            catalogId: 'catalog-1',
            advertiserId: '1001',
            advertiserName: 'Example Retailer',
            title: 'Atlas Eau de Parfum Spray 3.4 oz',
            brand: 'Example House',
            description: 'A new wearable fragrance.',
            productType: ['Perfume & Cologne'],
            condition: 'NEW',
            link: 'https://retailer.example/atlas',
            imageLink: 'https://retailer.example/atlas.jpg',
            linkCode: { clickUrl: 'https://affiliate.example/atlas' },
            price: { amount: 100, currency: 'USD' },
            shipping: { price: { amount: 0, currency: 'USD' } },
            gtin: '123456789012'
          }]
        }
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    Object.assign(fixture.env, {
      CJ_PERSONAL_ACCESS_TOKEN: 'test-cj-token',
      CJ_COMPANY_ID: '123',
      CJ_WEBSITE_ID: '456',
      CJ_ADVERTISER_IDS: '1001',
      CJ_GLOBAL_UPSTREAM_REQUESTS_PER_MINUTE: '60',
      PRODUCT_OBSERVATION_BATCHES_PER_MINUTE: '5'
    });
    const productRequest = (suffix = '') => new Request(
      `https://fragrancecollect.com/api/products?q=Atlas${suffix}`,
      { headers: { 'CF-Connecting-IP': '192.0.2.155' } }
    );

    const coldContext = createExecutionContext();
    const cold = await integratedWorker.fetch(productRequest(), fixture.env, coldContext);
    assert.equal(cold.status, 200, await cold.clone().text());
    assert.equal((await cold.json()).products.length, 1);
    assert.equal(coldContext.pendingTasks, 1);
    await coldContext.drain();
    assert.equal(observationBatches, 1);
    assert.equal(popularityQueries, 1);

    const upstreamAfterCold = upstreamCalls;
    const hitContext = createExecutionContext();
    const hit = await integratedWorker.fetch(productRequest(), fixture.env, hitContext);
    assert.equal(hit.status, 200, await hit.clone().text());
    assert.equal(upstreamCalls, upstreamAfterCold, 'identical catalog request should use its cached CJ result');
    assert.equal(hitContext.pendingTasks, 0, 'a catalog cache hit must not schedule observation writes');
    assert.equal(observationBatches, 1);
    assert.equal(popularityQueries, 1, 'popularity aggregation should reuse its five-minute cache');
    assert.equal(fixture.database.prepare(`
      SELECT request_count FROM rate_limits WHERE endpoint = 'product-observation-global-v1'
    `).get().request_count, 1);

    for (let lowPrice = 1; lowPrice <= 5; lowPrice += 1) {
      const context = createExecutionContext();
      const response = await integratedWorker.fetch(productRequest(`&lowPrice=${lowPrice}`), fixture.env, context);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(context.pendingTasks, 1);
      await context.drain();
    }
    assert.equal(observationBatches, 5, 'only five observation batches may write in one minute');
    assert.equal(fixture.database.prepare(`
      SELECT request_count FROM rate_limits WHERE endpoint = 'product-observation-global-v1'
    `).get().request_count, 6, 'the denied sixth reservation is durable but must not write');
    assert.equal(popularityQueries, 1, 'distinct catalog cache misses must share the popularity aggregate');
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS total FROM product_offer_observations').get().total, 1);
  } finally {
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('watch and favorite collection caps remain atomic while existing records stay updateable', async () => {
  const fixture = createFixture();
  try {
    const verifiedAt = new Date().toISOString();
    fixture.env.RESEND_API_KEY = 're_test_only';
    fixture.env.RESEND_FROM = 'Fragrance Collect <support@fragrancecollect.com>';
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('bounded-owner', 'bounded@example.com', 'Bounded Owner', 'not-used', verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'password', ?, ?, ?)
    `).run('bounded-identity', 'bounded-owner', 'bounded@example.com', 'bounded@example.com', verifiedAt);
    const sessionToken = 'bounded_session_token_value_123456789012345';
    fixture.database.prepare(`
      INSERT INTO user_sessions (id, user_id, token, expires_at, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'bounded-session', 'bounded-owner', sha512(sessionToken),
      new Date(Date.now() + 60_000).toISOString(), sha512('ua:security-regression-agent')
    );

    for (let index = 0; index < 19; index += 1) {
      fixture.database.prepare(`
        INSERT INTO user_deal_alerts
          (id, user_id, product_key, product_name, alert_type, target_price, currency)
        VALUES (?, ?, ?, ?, 'price_drop', ?, 'USD')
      `).run(`watch-${index}`, 'bounded-owner', `retailer:test:${index}`, `Watch ${index}`, index + 1);
    }
    const watchResponses = await Promise.all([19, 20].map((index) => integratedWorker.fetch(
      localJsonRequest('/api/user/alerts', 'POST', {
        productKey: `retailer:test:${index}`,
        productName: `Watch ${index}`,
        alertType: 'price_drop',
        targetPrice: index + 1,
        currency: 'USD'
      }, { cookie: sessionToken, ip: `192.0.2.${100 + index}` }),
      fixture.env,
      {}
    )));
    assert.deepEqual(watchResponses.map((response) => response.status).sort(), [201, 409]);
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM user_deal_alerts WHERE user_id = ? AND is_active = 1'
    ).get('bounded-owner').total, 20);
    const updateWatch = await integratedWorker.fetch(localJsonRequest('/api/user/alerts', 'POST', {
      productKey: 'retailer:test:0',
      productName: 'Updated existing watch',
      alertType: 'price_drop',
      targetPrice: 0.5,
      currency: 'USD'
    }, { cookie: sessionToken, ip: '192.0.2.122' }), fixture.env, {});
    assert.equal(updateWatch.status, 201, await updateWatch.clone().text());

    const insertFavorite = fixture.database.prepare(`
      INSERT INTO user_favorites (id, user_id, fragrance_id, name)
      VALUES (?, 'bounded-owner', ?, ?)
    `);
    for (let index = 0; index < 199; index += 1) {
      insertFavorite.run(`favorite-${index}`, `fragrance-${index}`, `Favorite ${index}`);
    }
    const favoriteResponses = await Promise.all([199, 200].map((index) => integratedWorker.fetch(
      localJsonRequest('/api/user/favorites', 'POST', {
        fragrance_id: `fragrance-${index}`,
        name: `Favorite ${index}`
      }, { cookie: sessionToken, ip: `198.51.100.${index - 100}` }),
      fixture.env,
      {}
    )));
    assert.deepEqual(favoriteResponses.map((response) => response.status).sort(), [201, 409]);
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM user_favorites WHERE user_id = ?'
    ).get('bounded-owner').total, 200);
    const updateFavorite = await integratedWorker.fetch(localJsonRequest('/api/user/favorites', 'POST', {
      fragrance_id: 'fragrance-0',
      name: 'Updated existing favorite'
    }, { cookie: sessionToken, ip: '198.51.100.122' }), fixture.env, {});
    assert.equal(updateFavorite.status, 201, await updateFavorite.clone().text());
  } finally {
    fixture.database.close();
  }
});

test('global email and outbound-write budgets prevent aggregate upstream and database amplification', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  let emailProviderCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input) !== 'https://api.resend.com/emails') throw new Error(`Unexpected URL: ${String(input)}`);
    emailProviderCalls += 1;
    return new Response(JSON.stringify({ id: `email-${emailProviderCalls}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    Object.assign(fixture.env, {
      RESEND_API_KEY: 're_test_only',
      RESEND_FROM: 'Fragrance Collect <support@fragrancecollect.com>',
      CONTACT_RECIPIENT: 'support@fragrancecollect.com',
      EMAIL_GLOBAL_SENDS_PER_HOUR: '10',
      OUTBOUND_GLOBAL_WRITES_PER_MINUTE: '50'
    });
    let finalEmailResponse;
    for (let index = 0; index < 11; index += 1) {
      finalEmailResponse = await integratedWorker.fetch(localJsonRequest('/api/contact', 'POST', {
        name: 'Security Tester',
        email: 'tester@example.com',
        subject: 'feedback',
        message: 'This is a bounded delivery test message.'
      }, { ip: `203.0.113.${index + 1}` }), fixture.env, {});
    }
    assert.equal(emailProviderCalls, 10);
    assert.equal(finalEmailResponse.status, 503);
    assert.equal(finalEmailResponse.headers.get('Retry-After'), '3600');

    let finalOutboundResponse;
    for (let index = 0; index < 51; index += 1) {
      finalOutboundResponse = await integratedWorker.fetch(localJsonRequest('/api/outbound-click', 'POST', {
        productId: `catalog-product-${index}`,
        source: 'catalog'
      }, { ip: '198.51.100.200' }), fixture.env, {});
    }
    assert.equal(finalOutboundResponse.status, 503);
    assert.equal(finalOutboundResponse.headers.get('Retry-After'), '60');
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS total FROM outbound_clicks').get().total, 50);
  } finally {
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('Google ownership stays keyed to sub, email changes are consistent, conflicts fail closed, and fresh unknown kids do not refetch JWKS', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  Object.assign(jwk, { kid: 'known-google-key', alg: 'RS256', use: 'sig' });
  let jwksFetches = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') {
      jwksFetches += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected URL: ${String(input)}`);
  };

  try {
    const firstToken = signGoogleToken(privateKey, 'known-google-key', {
      sub: 'stable-google-subject', email: 'first.google@example.com', name: 'Google Owner'
    });
    const concurrentToken = signGoogleToken(privateKey, 'known-google-key', {
      sub: 'concurrent-google-subject', email: 'concurrent.google@example.com', name: 'Concurrent Owner'
    });
    const [firstLogin, concurrentLogin] = await Promise.all([firstToken, concurrentToken].map((credential, index) => (
      integratedWorker.fetch(localJsonRequest('/api/login/google', 'POST', { credential }, {
        ip: `192.0.2.${60 + index}`
      }), fixture.env, {})
    )));
    assert.equal(firstLogin.status, 200, await firstLogin.clone().text());
    assert.equal(concurrentLogin.status, 200, await concurrentLogin.clone().text());
    assert.equal(jwksFetches, 1, 'concurrent cold logins must share one JWKS request');

    const changedEmailToken = signGoogleToken(privateKey, 'known-google-key', {
      sub: 'stable-google-subject', email: 'renamed.google@example.com', name: 'Google Owner'
    });
    const changedEmailLogin = await integratedWorker.fetch(localJsonRequest('/api/login/google', 'POST', {
      credential: changedEmailToken
    }), fixture.env, {});
    assert.equal(changedEmailLogin.status, 200, await changedEmailLogin.text());
    const identity = fixture.database.prepare(`
      SELECT u.email AS user_email, i.email AS identity_email
      FROM users u JOIN user_identities i ON i.user_id = u.id
      WHERE i.provider = 'google' AND i.provider_subject = ?
    `).get('stable-google-subject');
    assert.deepEqual({ ...identity }, {
      user_email: 'renamed.google@example.com',
      identity_email: 'renamed.google@example.com'
    });

    fixture.database.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
      .run('claimed-email-owner', 'claimed.google@example.com', 'Claimed Owner');
    const conflictToken = signGoogleToken(privateKey, 'known-google-key', {
      sub: 'stable-google-subject', email: 'claimed.google@example.com', name: 'Google Owner'
    });
    const conflict = await integratedWorker.fetch(localJsonRequest('/api/login/google', 'POST', {
      credential: conflictToken
    }), fixture.env, {});
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, 'google_email_change_conflict');
    assert.equal(
      fixture.database.prepare('SELECT email FROM users WHERE id = (SELECT user_id FROM user_identities WHERE provider_subject = ?)')
        .get('stable-google-subject').email,
      'renamed.google@example.com'
    );

    const unknownKidToken = signGoogleToken(privateKey, 'attacker-controlled-kid', {
      sub: 'other-subject', email: 'other@example.com'
    });
    const unknownKid = await integratedWorker.fetch(localJsonRequest('/api/login/google', 'POST', {
      credential: unknownKidToken
    }), fixture.env, {});
    assert.equal(unknownKid.status, 401);
    assert.equal(jwksFetches, 1, 'a fresh authoritative JWKS must not be refetched for an unknown kid');

    const extraSegment = await integratedWorker.fetch(localJsonRequest('/api/login/google', 'POST', {
      credential: `${unknownKidToken}.extra`
    }), fixture.env, {});
    assert.equal(extraSegment.status, 401);
    assert.equal(jwksFetches, 1);

    fixture.database.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)')
      .run('legacy-google-only', 'legacy.google@example.com', 'Legacy Google Owner');
    const legacyCredential = signGoogleToken(privateKey, 'known-google-key', {
      sub: 'recovered-legacy-google-subject',
      email: 'legacy.google@example.com',
      name: 'Legacy Google Owner'
    });
    const legacyConflict = await integratedWorker.fetch(localJsonRequest('/api/login/google', 'POST', {
      credential: legacyCredential
    }), fixture.env, {});
    assert.equal(legacyConflict.status, 409);
    assert.deepEqual(await legacyConflict.json(), {
      error: 'Verify this legacy account email, then link Google from the signed-in account.',
      code: 'legacy_verification_required',
      pendingVerification: true,
      verificationRequired: true,
      recoveryEmail: 'legacy.google@example.com'
    });

    const resend = await integratedWorker.fetch(localJsonRequest('/api/signup/verification/resend', 'POST', {
      email: 'legacy.google@example.com'
    }), fixture.env, {});
    assert.equal(resend.status, 202, await resend.clone().text());
    const recoveryToken = (await resend.json()).verificationToken;
    assert.match(recoveryToken, /^[A-Za-z0-9_-]{40,100}$/);

    const verify = await integratedWorker.fetch(localJsonRequest('/api/signup/verify', 'POST', {
      token: recoveryToken
    }), fixture.env, {});
    assert.equal(verify.status, 200, await verify.clone().text());
    const recoveryCookie = cookieValue(verify);
    assert.ok(recoveryCookie);
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM user_identities WHERE user_id = ?'
    ).get('legacy-google-only').total, 0, 'mailbox proof must not invent a provider subject');

    const restricted = await integratedWorker.fetch(new Request('http://localhost:8787/api/user/export', {
      headers: {
        Origin: 'http://localhost:3000',
        Cookie: `__Host-fragrance_session=${recoveryCookie}`,
        'User-Agent': 'security-regression-agent'
      }
    }), fixture.env, {});
    assert.equal(restricted.status, 403);
    assert.equal((await restricted.json()).code, 'identity_link_required');

    const repeatConflict = await integratedWorker.fetch(localJsonRequest('/api/login/google', 'POST', {
      credential: legacyCredential
    }), fixture.env, {});
    assert.equal((await repeatConflict.json()).code, 'legacy_verification_required');
    const repeatResend = await integratedWorker.fetch(localJsonRequest('/api/signup/verification/resend', 'POST', {
      email: 'legacy.google@example.com'
    }, { ip: '192.0.2.88' }), fixture.env, {});
    assert.equal(repeatResend.status, 202, 'a lost restricted session must remain recoverable with fresh mailbox proof');
    assert.match((await repeatResend.json()).verificationToken, /^[A-Za-z0-9_-]{40,100}$/);

    const linked = await integratedWorker.fetch(localJsonRequest('/api/user/identities/google', 'POST', {
      credential: legacyCredential
    }, { cookie: recoveryCookie }), fixture.env, {});
    assert.equal(linked.status, 200, await linked.clone().text());
    assert.equal(fixture.database.prepare(
      'SELECT COUNT(*) AS total FROM email_verification_tokens WHERE user_id = ?'
    ).get('legacy-google-only').total, 0, 'linking the provider must invalidate pending mailbox links');
    const linkedCookie = cookieValue(linked);
    const linkedStatus = await integratedWorker.fetch(new Request('http://localhost:8787/api/status', {
      headers: {
        Cookie: `__Host-fragrance_session=${linkedCookie}`,
        'User-Agent': 'security-regression-agent'
      }
    }), fixture.env, {});
    assert.equal(linkedStatus.status, 200);
    assert.equal((await linkedStatus.json()).user.hasGoogleIdentity, true);
  } finally {
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('CJ admin reporting validates inputs and charges every upstream page to durable budgets', async () => {
  const fixture = createFixture();
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  let commissionCalls = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    upstreamCalls += 1;
    const requestBody = options.body ? JSON.parse(options.body) : {};
    if (url === 'https://commissions.api.cj.com/query') {
      commissionCalls += 1;
      return new Response(JSON.stringify({
        data: {
          publisherCommissions: {
            count: 0,
            limit: 100,
            maxCommissionId: `commission-${commissionCalls}`,
            payloadComplete: false,
            records: []
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === 'https://programs.api.cj.com/query') {
      assert.equal(requestBody.variables.limit, 100);
      assert.equal(requestBody.variables.offset, 0);
      return new Response(JSON.stringify({
        data: { publisher: { contracts: { records: [], totalCount: 0 } } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === 'https://graph.cj.com/publishers') {
      assert.ok(requestBody.variables.pageSize <= 250);
      return new Response(JSON.stringify({
        data: { itemList: { id: requestBody.variables.itemListId, name: 'Test list', items: { nextPage: null, records: [] } } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected upstream URL: ${url}`);
  };

  try {
    const verifiedAt = new Date().toISOString();
    const sessionToken = 'admin_session_token_value_123456789012345';
    fixture.database.prepare(`
      INSERT INTO users (id, email, name, password_hash, email_verified_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin-owner', 'admin@example.com', 'Admin Owner', 'not-used', verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
      VALUES (?, ?, 'password', ?, ?, ?)
    `).run('admin-identity', 'admin-owner', 'admin@example.com', 'admin@example.com', verifiedAt);
    fixture.database.prepare(`
      INSERT INTO user_sessions (id, user_id, token, expires_at, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'admin-session', 'admin-owner', sha512(sessionToken),
      new Date(Date.now() + 60_000).toISOString(), sha512('ua:security-regression-agent')
    );
    Object.assign(fixture.env, {
      ADMIN_USER_IDS: 'admin-owner',
      CJ_PERSONAL_ACCESS_TOKEN: 'test-cj-token',
      CJ_COMPANY_ID: '123',
      CJ_WEBSITE_ID: '456',
      CJ_GLOBAL_UPSTREAM_REQUESTS_PER_MINUTE: '10',
      CJ_ADMIN_COMMISSION_MAX_PAGES: '6',
      CJ_ADMIN_REQUESTS_PER_15_MINUTES: '60'
    });
    let requestNumber = 0;
    const adminGet = (path) => integratedWorker.fetch(new Request(`http://localhost:8787${path}`, {
      headers: {
        Cookie: `__Host-fragrance_session=${sessionToken}`,
        'CF-Connecting-IP': `198.51.100.${20 + requestNumber++}`,
        'User-Agent': 'security-regression-agent'
      }
    }), fixture.env, {});

    const summary = await adminGet('/api/admin/cj/summary?days=30');
    assert.equal(summary.status, 200, await summary.clone().text());
    assert.equal((await summary.json()).commissions.pagination.pagesFetched, 6);
    assert.equal(commissionCalls, 6);
    assert.equal(fixture.database.prepare(`
      SELECT request_count FROM rate_limits WHERE endpoint = 'cj-upstream-global-v1'
    `).get().request_count, 6, 'every commission page must reserve one global request');

    const invalidDate = await adminGet('/api/admin/cj/program-terms?activeAfter=2026-02-31');
    const oversizedPage = await adminGet('/api/admin/cj/item-list?id=list-one&pageSize=251');
    assert.equal(invalidDate.status, 400);
    assert.equal(oversizedPage.status, 400);
    assert.equal(upstreamCalls, 6, 'invalid admin inputs must fail before contacting CJ');
    assert.equal(fixture.database.prepare(`
      SELECT request_count FROM rate_limits WHERE endpoint = 'cj-upstream-global-v1'
    `).get().request_count, 6, 'invalid admin inputs must not consume upstream budget');

    const firstTerms = await adminGet('/api/admin/cj/program-terms?advertiserId=101&activeAfter=2026-01-01');
    const cachedTerms = await adminGet('/api/admin/cj/program-terms?advertiserId=101&activeAfter=2026-01-01');
    const firstItemList = await adminGet('/api/admin/cj/item-list?id=list-one&pageSize=250');
    assert.equal(firstTerms.status, 200, await firstTerms.clone().text());
    assert.equal(cachedTerms.status, 200, await cachedTerms.clone().text());
    assert.equal(firstItemList.status, 200, await firstItemList.clone().text());
    assert.equal(upstreamCalls, 8, 'a fresh cache hit must not spend a second CJ request');

    assert.equal((await adminGet('/api/admin/cj/program-terms?advertiserId=102')).status, 200);
    assert.equal((await adminGet('/api/admin/cj/item-list?id=list-two')).status, 200);
    const denied = await adminGet('/api/admin/cj/program-terms?advertiserId=103');
    assert.equal(denied.status, 503);
    assert.equal(denied.headers.get('Retry-After'), '60');
    assert.equal(upstreamCalls, 10, 'the denied eleventh reservation must never reach CJ');
    assert.equal(fixture.database.prepare(`
      SELECT request_count FROM rate_limits WHERE endpoint = 'cj-upstream-global-v1'
    `).get().request_count, 11);
  } finally {
    globalThis.fetch = originalFetch;
    fixture.database.close();
  }
});

test('source-level guards retain sub-keyed ownership, timing equalization, bounded cache/upstream work, and streamed body reads', () => {
  assert.match(workerSource, /WHERE i\.provider = 'google' AND i\.provider_subject = \?/);
  assert.match(workerSource, /code: 'account_link_required'/);
  assert.match(workerSource, /payload\.sub !== account\.google_subject/);
  assert.match(workerSource, /DELETE FROM users WHERE id = \?/);
  assert.match(workerSource, /Number\(result\[1\]\?\.meta\?\.changes \|\| 0\) < 1/);
  assert.doesNotMatch(workerSource, /Number\(result\[1\]\?\.meta\?\.changes \|\| 0\) !== 1/);
  assert.match(workerSource, /const passwordHash = user\?\.password_hash \|\| DUMMY_PASSWORD_HASH/);
  assert.ok(
    workerSource.indexOf('const passwordHash = await hashPasswordPBKDF2(password);')
      < workerSource.indexOf("const existingUser = await env.DB.prepare('SELECT id FROM users"),
    'signup must perform the KDF before branching on mailbox existence'
  );
  assert.match(workerSource, /CJ_GLOBAL_UPSTREAM_REQUESTS_PER_MINUTE, 60, 10, 300/);
  assert.match(workerSource, /CJ_CACHE_MAX_ROWS, 200, 50, 2000/);
  assert.match(workerSource, /length\(payload\) > 2000000/);
  assert.match(workerSource, /fetchPage: async[\s\S]{0,180}consumeCJUpstreamBudget\(env\)[\s\S]{0,180}fetchCJGraphQL/);
  assert.match(workerSource, /segments\.length !== 3/);
  assert.match(workerSource, /lastKeyFetchTime > 0 && now - lastKeyFetchTime < KEY_CACHE_TTL/);
  assert.match(workerSource, /request\.body\.getReader\(\)/);
  assert.match(workerSource, /reader\.cancel\('request body limit exceeded'\)/);
  assert.match(workerSource, /resetUrl\.hash = new URLSearchParams\(\{ reset_token: resetToken \}\)/);
  assert.match(workerSource, /verifyUrl\.hash = new URLSearchParams\(\{ verify_token: verificationToken \}\)/);
  assert.doesNotMatch(workerSource, /(?:resetUrl|verifyUrl)\.searchParams\.set/);
  assert.match(workerSource, /EMAIL_GLOBAL_SENDS_PER_HOUR, 100, 10, 1000/);
  assert.match(workerSource, /OUTBOUND_GLOBAL_WRITES_PER_MINUTE, 300, 50, 2000/);
  assert.match(workerSource, /Promise\.resolve\(\)\s*\.then\(taskFactory\)\s*\.catch/);
  assert.match(workerSource, /catalog\.cache === 'miss' && paginatedProducts\.length/);
  assert.match(workerSource, /PRODUCT_OBSERVATION_BATCHES_PER_MINUTE, 10, 5, 60/);
  assert.match(workerSource, /CLICK_POPULARITY_CACHE_MS = 5 \* 60 \* 1000/);
  assert.match(workerSource, /CJ_ADMIN_COMMISSION_MAX_PAGES, 4, 1, 6/);
  assert.match(workerSource, /CJ_ADMIN_REQUESTS_PER_15_MINUTES, 12, 5, 60/);
  assert.match(wranglerSource, /PRODUCT_OBSERVATION_BATCHES_PER_MINUTE = "10"/);
  assert.match(wranglerSource, /CJ_ADMIN_COMMISSION_MAX_PAGES = "4"/);
  assert.doesNotMatch(workerSource, /await request\.json\(\)/);
});
