# Fragrance Collect

**Live site:** [fragrancecollect.com](https://fragrancecollect.com)

A full-stack fragrance discovery platform that aggregates products from multiple affiliate networks, featuring real-time search, personalized recommendations, and a responsive luxury UI.

## Architecture

**Frontend** — Vanilla JavaScript, HTML5, CSS3 (no framework dependencies)
- Real-time product search with debounced input and pagination
- Dynamic currency conversion across 30+ currencies with live exchange rates
- Client-side filtering by price, brand, shipping, and sort order
- Offline-capable with sync queuing for favorites
- Responsive design optimized for mobile and desktop

**Backend** — Cloudflare Workers (serverless, edge-deployed)
- Multi-source product aggregation via CJ Affiliate (GraphQL) and TikTok Shop APIs
- Revenue-optimized ranking algorithm weighting commission rates, price range, and relevance
- Smart deduplication across data sources
- Rate limiting, input sanitization, and CORS policy enforcement

**Authentication** — Google OAuth 2.0 + email signup
- JWT verification using Google's public keys
- Session management with Cloudflare D1 (SQLite at the edge)
- User preferences and favorites persistence

**Database** — Cloudflare D1
- Users, sessions, preferences, and favorites tables
- Parameterized queries for SQL injection prevention
- Indexed for performance

## Key Features

- **Multi-source search** — Queries CJ Affiliate and TikTok Shop simultaneously, deduplicates results, and ranks by revenue potential
- **Revenue optimization** — Products scored by commission rate, price positioning, brand category, and search relevance
- **Currency conversion** — Real-time rates from Open Exchange Rates API with 24-hour caching and hardcoded fallbacks
- **Personalized recommendations** — Logged-in users get scent preference-based suggestions
- **Favorites system** — Save fragrances with offline support and cross-device sync
- **Security** — XSS prevention, input validation, HTTPS enforcement, rate limiting

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | JavaScript (ES6+), HTML5, CSS3 |
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| APIs | CJ Affiliate (GraphQL), TikTok Shop, Google OAuth, Open Exchange Rates |
| Hosting | GitHub Pages (static), Cloudflare (serverless) |
| Email | Resend |
| CI/CD | GitHub Actions |

## Project Structure

```
├── main.html                    # Main product catalog page
├── index.html                   # Entry point / redirect
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
├── weathered-mud-6ed5/          # Cloudflare Worker (product search + auth API)
│   └── src/integrated-worker.js # Main worker handling all API endpoints
└── auth-worker/                 # Auth worker schemas and config
    ├── schema.sql               # D1 database schema
    └── src/worker.js            # Auth-specific worker
```

## Local Development

```bash
# Serve the frontend locally
npx serve .

# Run the Cloudflare Worker locally
cd weathered-mud-6ed5
npx wrangler dev
```

## Author

Joshua Blaszczyk
