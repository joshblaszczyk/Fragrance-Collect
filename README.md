# Fragrance Collect

**Live site:** [fragrancecollect.com](https://fragrancecollect.com)

A full-stack fragrance discovery platform that compares offers from configured affiliate retail partners, with submitted search, personalized recommendations, and a responsive luxury UI.

## Architecture

**Frontend** — Vanilla JavaScript, HTML5, CSS3 on GitHub Pages (no framework dependencies)
- Submitted product search with pagination and server-side filtering
- Dynamic currency conversion across 30+ currencies with live exchange rates
- Client-side filtering by price, brand, shipping, and sort order
- Account favorites synchronized through the Worker API
- Responsive design optimized for mobile and desktop

**Backend** — Cloudflare Workers at `weathered-mud-6ed5.joshuablaszczyk.workers.dev` (serverless, edge-deployed)
- Product aggregation through the CJ Affiliate GraphQL API and configured retail partners
- Evidence-based ranking using catalog quality, availability, current discounts, relevance, and anonymized outbound interest
- Smart deduplication across data sources
- Rate limiting, input sanitization, and CORS policy enforcement

**Authentication** — Google OAuth 2.0 + email signup
- JWT verification using Google's public keys
- Cookie-only session management with hashed session tokens in Cloudflare D1
- One-time, expiring password-reset links delivered through Resend
- User preferences and favorites persistence

**Database** — Cloudflare D1
- Users, sessions, preferences, and favorites tables
- Parameterized queries for SQL injection prevention
- Indexed for performance

## Key Features

- **Partner search** — Queries configured CJ retail partners, deduplicates results, and ranks featured offers
- **Evidence-based discovery** — Products rank by relevance, availability, verified sale/shipping data, and anonymized outbound interest; commercial terms never appear in public responses
- **Currency conversion** — Rates from open.er-api.com with Frankfurter fallback and local caching
- **Personalized recommendations** — Logged-in users get scent preference-based suggestions
- **Favorites system** — Save fragrances with offline support and cross-device sync
- **Security** — XSS prevention, input validation, HTTPS enforcement, rate limiting

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | JavaScript (ES6+), HTML5, CSS3 |
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| APIs | CJ Affiliate (GraphQL), Google OAuth, open.er-api.com, Frankfurter |
| Hosting | GitHub Pages frontend + Cloudflare Worker API |
| Email | Resend |
| CI/CD | GitHub Actions |

## Project Structure

```
├── main.html                    # Main product catalog page
├── index.html                   # GitHub Pages entry point
├── script.js                    # Core application logic (search, filters, favorites, currency)
├── styles.css                   # Main stylesheet
├── shared-auth.js               # Cross-page authentication module
├── universal-header-script.js   # Shared navigation and header logic
├── auth.html / auth-script.js   # Authentication page
├── account.html / account.js    # User account management
├── contact.html                 # Contact form
├── customer-service.html        # Customer service page
├── faq.html                     # FAQ page
├── size-guide.html              # Size guide reference
├── privacy-policy.html          # Privacy policy
├── terms-of-service.html        # Terms of service
├── scripts/                     # Build, syntax, asset, and static-site checks
├── test/                        # Security, reliability, and migration regressions
├── weathered-mud-6ed5/          # Cloudflare Worker (product search + auth API)
│   ├── migrations/              # Ordered, non-destructive D1 migrations
│   └── src/integrated-worker.js # API deployment target
└── dist/                        # Generated Worker preview assets (ignored by Git)
```

## Local Development

```bash
# Install and validate the frontend and Worker
npm ci
npm --prefix weathered-mud-6ed5 ci
npm run verify

# Build the Cloudflare asset bundle, apply tracked migrations to an isolated
# local D1 database, and start the complete site at http://127.0.0.1:8787
npm run dev
```

Local development intentionally keeps the generated frontend and `/api/*` on one Wrangler origin. Production is different by design: GitHub Pages serves `https://fragrancecollect.com`, and those pages call the Worker at `https://weathered-mud-6ed5.joshuablaszczyk.workers.dev`. No local page silently calls the deployed API, and there is no query-string switch that can redirect credentials or account requests to another host. Local CJ credentials are required only when testing live partner results.

`npm run dev` owns the complete local lifecycle and cleans up its Wrangler process when it exits. In a second terminal, run `npm run api:check:local` for the real account API checks. Without local CJ or Resend credentials, `/api/health` intentionally reports `503 degraded` and watch creation reports that notifications are unavailable; the check still requires a healthy Worker, attested D1 schema, verification, sessions, favorites, export, and secure account deletion. When testing configured external integrations, set `LOCAL_EXPECT_FULL_HEALTH=true` and `LOCAL_EXPECT_WATCHES=true` so the check fails unless those services and watches are available. `npm run dev:worker` remains available for advanced Worker-only troubleshooting after a Cloudflare asset build, and `npm --prefix weathered-mud-6ed5 run migrate:local` applies only local migrations. Put local CJ and mail secrets in `weathered-mud-6ed5/.dev.vars`; never commit that file.

## Worker Configuration

The active deployment target is only `weathered-mud-6ed5`. Its D1 migrations must be applied in filename order. Required configuration:

- D1 binding: `DB`
- Non-secret variables: `CJ_COMPANY_ID`, `CJ_WEBSITE_ID`, `ALLOWED_ORIGIN`, `CONTACT_RECIPIENT`, `RESEND_FROM`, `PUBLIC_SITE_URL`, and `GOOGLE_CLIENT_ID`
- Secrets: `CJ_PERSONAL_ACCESS_TOKEN` (preferred; `CJ_DEV_KEY` remains supported during migration), `RESEND_API_KEY`, and `ADMIN_EMAILS` (comma-separated allowlist for the private CJ dashboard)

Production releases perform a read-only `wrangler secret list --format json` preflight. The check retains only binding names, never reads or prints values, and requires the Resend and admin bindings plus one supported CJ credential binding. Before the first controlled release, an authorized operator must create the Worker and provision those three bindings through the Cloudflare dashboard or a separately reviewed interactive Wrangler bootstrap. `wrangler secret put` creates and immediately deploys a Worker version, so it must not be added to CI or run casually during a release; the GitHub workflow intentionally cannot create, rotate, or delete secrets. After bootstrap or rotation, run `npm run check:cloudflare-worker-secrets` with scoped Cloudflare credentials to verify names only.

The CJ integration also uses cached Advertiser Lookup, Link Search, Program Terms, Item List, and Commission Detail data. Product Search defaults to every active joined CJ advertiser (`CJ_ADVERTISER_IDS=all`). Broad and brand searches use a bounded, cached discovery plan that gives each advertiser an independent Product Search scope, then applies canonical aliases, product/fragrance fallback terms, and CJ pagination within fixed request and record budgets. This prevents a large catalog from crowding a smaller joined retailer out of the shared result window. If Advertiser Lookup pagination is incomplete, an aggregate all-joined scope remains as a safety net. Results are deduplicated by retailer/catalog offer identity, and responses say when request or result caps make the displayed total a scanned-window total rather than a complete set. A strict wearable-fragrance classifier runs after retrieval; home fragrance, candles, diffusers, bath-only products, accessories, and fragrance-free merchandise are excluded. Public `partnerId` filters are accepted only after the cached active joined directory verifies the ID; unknown, inactive, and non-joined IDs fail closed. When a joined brand search is empty, the Worker may return bounded opportunity metadata naming non-joined advertiser programs found in a small eligible sample, but it never returns those product records, prices, or purchase links as shopper offers.

Public endpoints expose only shopper-safe catalog, promotion, retailer, and observed-history fields. Cross-retailer product comparison uses canonicalized GTIN (UPC/EAN/JAN) first, then brand plus MPN plus a compatible fragrance variant. Retailer SKU identity includes advertiser, CJ catalog, and feed ID, so sparse records can still support exact-listing watches and history without being merged across retailers. Size normalization ranks structured feed data ahead of product details, title, retailer URL, and description; it understands common fl-oz/mL equivalents and multipacks. Item-group identifiers remain variant-family metadata, and name-only records are not merged. Program terms and redacted commission summaries require both an authenticated session and an email listed in `ADMIN_EMAILS`.

`ALLOWED_ORIGIN` must include the exact browser origin allowed to make credentialed requests. Production uses `https://fragrancecollect.com`; the Worker returns that exact value in CORS responses and never uses a credentialed wildcard. It accepts a comma-separated list only when a separately reviewed staging origin is required. Local HTTP origins are accepted only for localhost/loopback development.

## Release Contract

Production uses two deliberately separate hosts. GitHub Pages publishes the repository frontend at `https://fragrancecollect.com`; the manually approved Cloudflare workflow publishes the API at `https://weathered-mud-6ed5.joshuablaszczyk.workers.dev`. The Worker has no custom-domain routes, and this architecture requires no Cloudflare DNS zone or registrar nameserver change. The Worker build still contains noindexed preview assets, but they are not the canonical site.

In **GitHub → Settings → Pages**, keep **Build and deployment** set to **Deploy from a branch**, with branch **`main`** and folder **`/(root)`**. Production currently follows that source. Do not switch Pages back to the obsolete `gh-pages` branch; repository tests cannot enforce this provider-side setting.

The local exact-release gate requires Node 22 or newer:

```bash
npm ci
npm --prefix weathered-mud-6ed5 ci
npm run release:prepush
```

`release:prepush` rejects staged-but-uncommitted, unstaged, mixed, and untracked prospective release content. It scans both tracked and untracked Git-visible files without printing matching credential values, runs the complete release/build/dependency gate, validates the Cloudflare `_headers` and exact artifact digest, and executes the managed browser/accessibility smoke suite. Run it from a clean commit immediately before pushing. CI repeats the same gate on the checked-out commit.

### Controlled production release

Configure a GitHub environment named `production` with required reviewers, prevent self-approval where the repository plan supports it, restrict it to `main`, and store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as environment secrets. Scope the Cloudflare token to the required account with Workers Scripts Write (which also authorizes the name-only secret listing) and D1 Read. It does not need zone, DNS, or custom-domain permissions. Do not grant this CI token D1 Edit or permission to manage account tokens: reviewed migrations and Worker-secret bootstrap/rotation use separate operator authorization, and the workflow is intentionally incapable of changing production data or secret values. Do not give the validation workflow any environment or deployment secrets.

The release order is intentionally strict:

For the first hybrid-hosting rollout, split the reviewed change into two releases so GitHub Pages never gets ahead of its API dependency: first merge and deploy the backward-compatible Worker/session changes while the existing frontend remains published; verify the Worker; then merge the frontend/CSP/runtime changes so Pages publishes against the compatible API. Do not publish the new Pages runtime before the partitioned-cookie Worker is live. Future releases must preserve the same API-before-dependent-frontend compatibility rule.

1. Merge a reviewed commit to `main` and require the `Validate release candidate` workflow to pass. Record the full 40-character SHA of the current `main` HEAD; branches are not immutable release inputs, and the release fails closed if `main` advances before deployment.
2. Run and review every migration locally, including signup/login, password recovery, favorites, export, and deal-watch tests against isolated D1 state.
3. Before changing production, run `wrangler d1 info fragrance-collect-db` and confirm the database uses the production storage backend. Then run `wrangler d1 time-travel info fragrance-collect-db` and record its current bookmark; D1 creates Time Travel history automatically, so this step records a known recovery point rather than initiating a restore. Review pending migrations with `wrangler d1 migrations list fragrance-collect-db --remote`, then apply approved migrations manually in filename order. The GitHub workflows contain no migration-apply command.
4. Confirm `wrangler d1 migrations list` shows no pending migration and inspect the affected tables. Do not continue if the database and selected commit differ.
5. Dispatch `Release Cloudflare Worker API`, enter the immutable SHA, and make the recovery and migration acknowledgements. There is no DNS acknowledgement. An unprivileged job first validates the inputs, main ancestry, build, and browser suite without deployment secrets. Only after it passes can a `production` environment reviewer approve the release job and expose its scoped credentials.
6. The approved job independently rebuilds and retests that exact SHA, confirms only the names of the required pre-provisioned Worker secrets, and performs read-only checks that production D1 has exactly the selected commit's migration list and baseline schema. It then runs `wrangler deploy` for the Worker API. GitHub Pages remains the canonical frontend and publishes from its configured repository source.
7. The workflow verifies the Worker API at `https://weathered-mud-6ed5.joshuablaszczyk.workers.dev`, the GitHub Pages frontend, and the exact-origin credentialed CORS contract between them. Manually smoke-test sign-in, reset, search, favorites, export, watches, contact, navigation, legal links, `robots.txt`, `sitemap.xml`, and the 404 page afterward.

### Hybrid hosting, OAuth, and email DNS

Keep the registrar nameservers and existing GitHub Pages web records in place. The repository `CNAME` must remain `fragrancecollect.com`; the Worker stays on its `workers.dev` hostname. Do not remove the four GitHub Pages apex A records, do not replace the `www` GitHub Pages CNAME, and do not add Worker custom-domain routes. Mail MX, SPF, DKIM, DMARC, autodiscovery, and mailbox records also remain at the current authoritative DNS provider.

Google sign-in and Resend sending still require one-time provider configuration. Follow the exact, no-cutover checklist in [DNS_CUTOVER.md](DNS_CUTOVER.md); despite its historical filename, that document now records the retained hybrid-hosting setup and explicitly prohibits a nameserver cutover.

### Rollback

- If a Worker deploy fails and D1 is healthy, roll the Worker back to the last version compatible with the currently published frontend and schema. GitHub Pages and DNS remain untouched.
- If a GitHub Pages frontend regression is published, revert the responsible repository commit through the normal reviewed Git workflow. Keep API compatibility while Pages rebuilds.
- If a migration caused data or compatibility problems, first roll the Worker to code compatible with the current schema. Use the verified D1 recovery point/Time Travel procedure only after assessing writes made since that point; never invent a destructive down-migration during an incident.
- Revoke or rotate the scoped Cloudflare token immediately if workflow credentials may have been exposed. Environment approvals do not replace token scoping and audit-log review.

No local validation command performs a remote migration, Worker deployment, GitHub Pages publication, push, pull request, or DNS change. Only the environment-gated manual workflow has Worker deployment authority, and its D1 access is read-only. GitHub Pages publication follows the repository's separately configured Pages source.

## Author

Joshua Blaszczyk
