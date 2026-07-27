import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const workerDirectory = join(root, 'weathered-mud-6ed5');
const wrangler = join(workerDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const local = process.argv.includes('--local');
const persistIndex = process.argv.indexOf('--persist-to');
const persistTo = persistIndex >= 0 ? process.argv[persistIndex + 1] : null;
const migrationNames = readdirSync(join(workerDirectory, 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (!local && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) {
  console.error('Cloudflare D1 preflight requires the production environment credentials.');
  process.exit(1);
}
if (local && !persistTo) {
  console.error('Local D1 preflight requires --persist-to with an isolated Wrangler state directory.');
  process.exit(1);
}

let queryNumber = 0;
function execute(sql) {
  queryNumber += 1;
  const args = [wrangler, 'd1', 'execute', 'fragrance-collect-db', local ? '--local' : '--remote', '--json', '--command', sql];
  if (local) args.splice(5, 0, '--persist-to', persistTo);
  const result = spawnSync(process.execPath, args, {
    cwd: workerDirectory,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`Wrangler could not complete read-only D1 prerequisite query ${queryNumber}.`);
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || parsed.some((entry) => entry.success !== true)) throw new Error();
    return parsed.flatMap((entry) => entry.results || []);
  } catch {
    throw new Error(`Wrangler returned an unexpected response for D1 prerequisite query ${queryNumber}.`);
  }
}

let applied;
let schemaMarkers;
try {
  applied = execute('SELECT name FROM d1_migrations ORDER BY id;').map((row) => row.name);
  const objectMarkers = execute(`
    SELECT type || ':' || name AS marker
    FROM sqlite_master
    WHERE (type = 'table' AND name IN (
      'users', 'user_sessions', 'user_preferences', 'user_favorites',
      'rate_limits', 'password_reset_tokens', 'cj_cache', 'cj_sync_status',
      'product_observations', 'product_offer_observations', 'outbound_clicks',
      'user_deal_alerts', 'user_identities', 'email_verification_tokens'
    )) OR (type = 'index' AND name IN (
      'idx_users_email_nocase',
      'idx_user_identities_user',
      'idx_user_identities_verified_email',
      'idx_email_verification_token_hash',
      'idx_email_verification_user_expiry',
      'idx_outbound_clicks_user_date',
      'idx_outbound_clicks_created_at',
      'idx_user_deal_alerts_scheduler',
      'idx_user_deal_alerts_user_date',
      'idx_user_favorites_user_date',
      'idx_product_observations_retention',
      'idx_cj_cache_updated_at'
    )) OR (type = 'trigger' AND name IN (
      'users_email_must_be_normalized_insert',
      'users_email_must_be_normalized_update',
      'identities_email_must_be_normalized_insert',
      'identities_email_must_be_normalized_update'
    ));
  `).map((row) => row.marker);
  const columnMarkers = execute(`
    WITH required_columns(table_name, column_name) AS (VALUES
      ('users', 'email'),
      ('users', 'password_hash'),
      ('users', 'email_verified_at'),
      ('user_sessions', 'token'),
      ('user_sessions', 'expires_at'),
      ('user_sessions', 'fingerprint'),
      ('password_reset_tokens', 'id'),
      ('password_reset_tokens', 'user_id'),
      ('password_reset_tokens', 'token_hash'),
      ('password_reset_tokens', 'expires_at'),
      ('password_reset_tokens', 'created_at'),
      ('password_reset_tokens', 'used_at'),
      ('user_identities', 'id'),
      ('user_identities', 'user_id'),
      ('user_identities', 'provider'),
      ('user_identities', 'provider_subject'),
      ('user_identities', 'email'),
      ('user_identities', 'email_verified_at'),
      ('user_identities', 'created_at'),
      ('user_identities', 'updated_at'),
      ('email_verification_tokens', 'id'),
      ('email_verification_tokens', 'user_id'),
      ('email_verification_tokens', 'token_hash'),
      ('email_verification_tokens', 'expires_at'),
      ('email_verification_tokens', 'created_at'),
      ('email_verification_tokens', 'used_at')
    )
    SELECT 'column:' || required.table_name || '.' || actual.name AS marker
    FROM required_columns AS required
    JOIN pragma_table_info(required.table_name) AS actual
      ON actual.name = required.column_name;
  `).map((row) => row.marker);
  schemaMarkers = [...objectMarkers, ...columnMarkers];
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (JSON.stringify(applied) !== JSON.stringify(migrationNames)) {
  console.error('Cloudflare D1 prerequisite check failed: remote applied migrations do not exactly match this release.');
  console.error(`Expected ${migrationNames.length} ordered migrations; found ${applied.length}. No migration was applied.`);
  process.exit(1);
}

const requiredMarkers = [
  'table:users',
  'table:user_sessions',
  'table:user_preferences',
  'table:user_favorites',
  'table:rate_limits',
  'table:password_reset_tokens',
  'table:cj_cache',
  'table:cj_sync_status',
  'table:product_observations',
  'table:product_offer_observations',
  'table:outbound_clicks',
  'table:user_deal_alerts',
  'table:user_identities',
  'table:email_verification_tokens',
  'column:password_reset_tokens.id',
  'column:password_reset_tokens.user_id',
  'column:password_reset_tokens.token_hash',
  'column:password_reset_tokens.expires_at',
  'column:password_reset_tokens.created_at',
  'column:password_reset_tokens.used_at',
  'column:users.email',
  'column:users.password_hash',
  'column:users.email_verified_at',
  'column:user_sessions.token',
  'column:user_sessions.expires_at',
  'column:user_sessions.fingerprint',
  'column:user_identities.id',
  'column:user_identities.user_id',
  'column:user_identities.provider',
  'column:user_identities.provider_subject',
  'column:user_identities.email',
  'column:user_identities.email_verified_at',
  'column:user_identities.created_at',
  'column:user_identities.updated_at',
  'column:email_verification_tokens.id',
  'column:email_verification_tokens.user_id',
  'column:email_verification_tokens.token_hash',
  'column:email_verification_tokens.expires_at',
  'column:email_verification_tokens.created_at',
  'column:email_verification_tokens.used_at',
  'index:idx_users_email_nocase',
  'index:idx_user_identities_user',
  'index:idx_user_identities_verified_email',
  'index:idx_email_verification_token_hash',
  'index:idx_email_verification_user_expiry',
  'index:idx_outbound_clicks_user_date',
  'index:idx_outbound_clicks_created_at',
  'index:idx_user_deal_alerts_scheduler',
  'index:idx_user_deal_alerts_user_date',
  'index:idx_user_favorites_user_date',
  'index:idx_product_observations_retention',
  'index:idx_cj_cache_updated_at',
  'trigger:users_email_must_be_normalized_insert',
  'trigger:users_email_must_be_normalized_update',
  'trigger:identities_email_must_be_normalized_insert',
  'trigger:identities_email_must_be_normalized_update'
];
const missing = requiredMarkers.filter((marker) => !schemaMarkers.includes(marker));
if (missing.length) {
  console.error(`Cloudflare D1 prerequisite check failed: ${missing.length} required schema markers are absent.`);
  process.exit(1);
}

console.log(`Cloudflare D1 prerequisite check passed: ${applied.length} migrations and ${requiredMarkers.length} schema markers. No migration was applied.`);
