import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import integratedWorker from '../weathered-mud-6ed5/src/integrated-worker.js';

const worker = readFileSync(new URL('../weathered-mud-6ed5/src/integrated-worker.js', import.meta.url), 'utf8');
const authClient = readFileSync(new URL('../shared-auth.js', import.meta.url), 'utf8');
const authPage = readFileSync(new URL('../auth-script.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const account = readFileSync(new URL('../account.js', import.meta.url), 'utf8');
const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

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
  return {
    prepare(sql) {
      return new D1StatementStub(database, sql);
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  };
}

function sha512Text(value) {
  return createHash('sha512').update(value).digest('hex');
}

function createAuthenticatedFixture() {
  const database = new DatabaseSync(':memory:');
  const migrationNames = [
    '0000_initial_schema.sql',
    '0001_rate_limits.sql',
    '0002_password_resets.sql',
    '0003_cj_catalog.sql',
    '0004_cj_offer_identity.sql',
    '0005_legacy_auth_compatibility.sql',
    '0006_identity_security.sql'
  ];
  for (const migration of migrationNames) {
    database.exec(readFileSync(new URL(`../weathered-mud-6ed5/migrations/${migration}`, import.meta.url), 'utf8'));
  }

  const token = 'authenticated-test-session-token-0123456789abcdef';
  const clientIp = '192.0.2.50';
  const userAgent = 'watch-export-test';
  const verifiedAt = new Date().toISOString();
  database.prepare('INSERT INTO users (id, email, name, email_verified_at) VALUES (?, ?, ?, ?)')
    .run('account-user', 'account@example.com', 'Account User', verifiedAt);
  database.prepare(`
    INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
    VALUES (?, ?, 'password', ?, ?, ?)
  `).run('account-password-identity', 'account-user', 'account@example.com', 'account@example.com', verifiedAt);
  database.prepare(`
    INSERT INTO user_sessions (id, user_id, token, expires_at, client_ip, user_agent, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'account-session',
    'account-user',
    sha512Text(token),
    new Date(Date.now() + 60_000).toISOString(),
    clientIp,
    userAgent,
    sha512Text(`ua:${userAgent}`)
  );

  return {
    database,
    env: {
      DB: createD1Stub(database),
      ALLOWED_ORIGIN: 'https://fragrancecollect.com',
      RESEND_API_KEY: 'test-resend-api-key',
      RESEND_FROM: 'Fragrance Collect <support@example.invalid>'
    },
    headers: {
      Origin: 'https://fragrancecollect.com',
      Cookie: `__Host-fragrance_session=${token}`,
      'CF-Connecting-IP': clientIp,
      'User-Agent': userAgent
    }
  };
}

test('does not reintroduce prefix-based CORS or opaque-origin trust', () => {
  assert.doesNotMatch(worker, /origin\.startsWith\(/);
  assert.doesNotMatch(worker, /origin\s*===\s*['"]null['"]\)\s*return true/);
});

test('keeps session tokens out of browser-readable storage and responses', () => {
  for (const source of [worker, authClient, authPage, catalog, account]) {
    assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem)\(['"]session_token['"]/);
  }
  assert.doesNotMatch(worker, /path\s*===\s*['"]\/api\/token['"]/);
});

test('keeps local credential files ignored and scans release artifacts for secret values', () => {
  assert.match(gitignore, /^\.dev\.vars$/m);
  assert.match(gitignore, /^\.dev\.vars\.\*$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.equal(packageManifest.scripts['check:secrets'], 'node scripts/check-secrets.mjs');
  assert.match(packageManifest.scripts.verify, /npm run check:secrets/);
  assert.match(packageManifest.scripts['release:check'], /npm run build:cloudflare/);
  assert.doesNotMatch(
    worker,
    /console\.(?:log|info|warn|error)\([^;\n]*(?:RESEND_API_KEY|CJ_DEV_KEY|CJ_PERSONAL_ACCESS_TOKEN|ADMIN_EMAILS)/
  );
});

test('awaits asynchronous session validation everywhere it is called', () => {
  const calls = [...worker.matchAll(/(?<!function )validateSessionSecurity\(session, request\)/g)];
  assert.ok(calls.length >= 2);
  for (const call of calls) {
    const prefix = worker.slice(Math.max(0, call.index - 12), call.index);
    assert.match(prefix, /await\s+$/);
  }
});

test('keeps user-controlled product and favorite actions out of inline handlers', () => {
  assert.doesNotMatch(catalog, /onclick=/);
  assert.doesNotMatch(catalog, /onerror=/);
  assert.doesNotMatch(account, /onclick=/);
  assert.doesNotMatch(account, /onerror=/);
});

test('the current Worker recognizes watch routes before authentication', async () => {
  const env = { ALLOWED_ORIGIN: 'https://fragrancecollect.com' };
  for (const method of ['GET', 'POST']) {
    const response = await integratedWorker.fetch(new Request('https://worker.example/api/user/alerts', {
      method,
      headers: {
        Origin: 'https://fragrancecollect.com',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      ...(method === 'POST' ? { body: JSON.stringify({ productKey: 'test', alertType: 'deal' }) } : {})
    }), env, {});
    assert.equal(response.status, 401, `${method} should reach the current watch route and require authentication`);
    assert.match(await response.text(), /not authenticated/i);
  }
});

test('an authenticated user can save a price watch and receive it in their data export', async () => {
  const fixture = createAuthenticatedFixture();
  try {
    const watchResponse = await integratedWorker.fetch(new Request('https://worker.example/api/user/alerts', {
      method: 'POST',
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productKey: 'retailer:v1:7287203:catalog:fs90353ga:0123456789abcdef',
        productName: 'Avant Eau de Parfum 3.4 oz',
        alertType: 'price_drop',
        targetPrice: 17.95,
        currency: 'USD',
        country: 'US'
      })
    }), fixture.env, {});
    assert.equal(watchResponse.status, 201, await watchResponse.text());

    const exportResponse = await integratedWorker.fetch(new Request('https://worker.example/api/user/export', {
      headers: fixture.headers
    }), fixture.env, {});
    assert.equal(exportResponse.status, 200);
    const exported = await exportResponse.json();
    assert.equal(exported.profile.email, 'account@example.com');
    assert.equal(exported.dealWatches.length, 1);
    assert.equal(exported.dealWatches[0].target_price, 17.95);
    assert.deepEqual(exported.attributedRetailerVisits, []);
  } finally {
    fixture.database.close();
  }
});

test('account export fails honestly when a required schema table is unavailable', async () => {
  const fixture = createAuthenticatedFixture();
  try {
    fixture.database.exec('DROP TABLE outbound_clicks');
    const response = await integratedWorker.fetch(new Request('https://worker.example/api/user/export', {
      headers: fixture.headers
    }), fixture.env, {});
    assert.equal(response.status, 500);
    assert.match(await response.text(), /unable to prepare your data export/i);
  } finally {
    fixture.database.close();
  }
});

test('password reset tokens are random, hashed at rest, expiring, single-use, and revoke sessions', () => {
  assert.match(worker, /generateSecureToken\(\)/);
  assert.match(worker, /tokenHash\s*=\s*await sha512\(resetToken\)/);
  assert.match(worker, /used_at IS NULL AND datetime\(t\.expires_at\) > datetime\(\?\)/);
  assert.match(worker, /UPDATE password_reset_tokens[\s\S]{0,80}SET used_at = \?/);
  assert.match(worker, /UPDATE password_reset_tokens[\s\S]{0,300}SELECT presented\.user_id[\s\S]{0,200}presented\.token_hash = \?/);
  assert.match(worker, /\.bind\(claimTime, tokenHash, claimTime, claimTime\)\.run\(\)/);
  assert.match(worker, /Number\(claimed\.meta\?\.changes \|\| 0\) < 1/);
  assert.match(worker, /MAX_ACTIVE_ACCOUNT_TOKENS = 8/);
  assert.match(worker, /DELETE FROM user_sessions WHERE user_id = \?/);
  assert.doesNotMatch(worker, /INSERT INTO password_reset_tokens[^;]+resetToken/s);
});

test('password recovery is limited to password identities and provider password setup requires reauthentication', () => {
  assert.match(worker, /JOIN user_identities i ON i\.user_id = u\.id AND i\.provider = 'password'/);
  assert.match(worker, /if \(user\) \{[\s\S]+sendPasswordResetEmail\(user, resetToken, env\)/);
  assert.match(worker, /u\.password_hash IS NOT NULL/);
  assert.match(worker, /verifyPasswordRecord\(currentPassword, userRecord\.password_hash\)/);
  assert.match(worker, /google_reauthentication_required/);
  assert.match(authPage, /updateSharedNavUI\(null\);[\s\S]+updateAuthPage\(null\)/);
  assert.match(account, /password-setup-google-button/);
  assert.match(account, /googleCredential: passwordSetupGoogleCredential/);
});

test('a Google-only account cannot mint a password through the mailbox-reset flow', async () => {
  const database = new DatabaseSync(':memory:');
  for (const migration of [
    '0000_initial_schema.sql', '0001_rate_limits.sql', '0002_password_resets.sql',
    '0003_cj_catalog.sql', '0004_cj_offer_identity.sql',
    '0005_legacy_auth_compatibility.sql', '0006_identity_security.sql'
  ]) {
    database.exec(readFileSync(new URL(`../weathered-mud-6ed5/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const verifiedAt = new Date().toISOString();
  database.prepare('INSERT INTO users (id, email, name, email_verified_at) VALUES (?, ?, ?, ?)')
    .run('google-user', 'google-user@example.com', 'Google User', verifiedAt);
  database.prepare(`
    INSERT INTO user_identities (id, user_id, provider, provider_subject, email, email_verified_at)
    VALUES (?, ?, 'google', ?, ?, ?)
  `).run('google-identity', 'google-user', 'google-subject-123', 'google-user@example.com', verifiedAt);

  const sentEmails = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'https://api.resend.com/emails') return originalFetch(url, options);
    sentEmails.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: 'email-test-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const env = {
    DB: createD1Stub(database),
    RESEND_API_KEY: 'test-resend-api-key',
    RESEND_FROM: 'Fragrance Collect <support@example.invalid>',
    PUBLIC_SITE_URL: 'https://fragrancecollect.com',
    ALLOWED_ORIGIN: 'https://fragrancecollect.com'
  };

  try {
    const forgotResponse = await integratedWorker.fetch(new Request('https://worker.example/api/password/forgot', {
      method: 'POST',
      headers: {
        Origin: 'https://fragrancecollect.com',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.10'
      },
      body: JSON.stringify({ email: 'google-user@example.com' })
    }), env, {});
    assert.equal(forgotResponse.status, 200);
    assert.equal(sentEmails.length, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens WHERE user_id = ?').get('google-user').count, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('uses a minimal server-side email request without exposing keys or losing reply-to', () => {
  assert.match(worker, /fetch\('https:\/\/api\.resend\.com\/emails'/);
  assert.match(worker, /Authorization: `Bearer \$\{env\.RESEND_API_KEY\}`/);
  assert.match(worker, /reply_to: email/);
  assert.doesNotMatch(worker, /new Resend|from ['"]resend['"]/);
});
