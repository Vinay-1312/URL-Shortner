# URL Shortener — System Design

A production-grade URL shortener built as a system design learning project. Mirrors Bitly's core architecture: microservices, an API gateway, Redis caching, async analytics via a message queue, and a React frontend.

---

## Architecture

```
Browser
  │
  ▼
Frontend (React + Nginx)  :3000
  │
  ▼
Kong API Gateway           :8000
  ├── POST /api/shorten ──► Creation Service   :8080
  │                              │
  │                         Redis (counter)
  │                         MongoDB (store)
  │
  └── GET  /r/:slug  ──────► Redirect Service  :8081
                                   │
                              Redis (cache, 5min TTL)
                              MongoDB (fallback)
                              RabbitMQ (click event)
                                   │
                             Analytics Service  :8082
                                   │
                             PostgreSQL (clicks table)
```

### Services

| Service | Port | Responsibility |
|---|---|---|
| **Creation Service** | 8080 | Atomically increments a Redis counter, Base62-encodes it as a slug, stores in MongoDB |
| **Redirect Service** | 8081 | Redis cache → MongoDB fallback → 302 redirect, publishes click events to RabbitMQ |
| **Analytics Service** | 8082 | Consumes RabbitMQ `click_events` queue, parses User-Agent, writes to PostgreSQL |
| **Kong** | 8000 | DB-less declarative API gateway, rate limiting (60 rpm create / 300 rpm redirect) |
| **Frontend** | 3000 | React 18 + TypeScript + Vite + Tailwind, URL history in localStorage |

### Infrastructure

| Component | Technology | Purpose |
|---|---|---|
| **Cache** | Redis 7.2 | Slug → URL lookup, 5-min sliding TTL; global atomic counter |
| **Primary DB** | MongoDB 7 | URL records (`slug`, `longUrl`, `createdAt`) |
| **Queue** | RabbitMQ 3.13 | Decouples redirect hot path from analytics writes |
| **Analytics DB** | PostgreSQL 16 | `clicks` table + `slug_stats` materialized view |

### Key Design Decisions

- **Counter strategy:** Redis `INCR` on `url:global_counter` — atomic, no UUID collisions, compact slugs
- **Slug format:** Base62 (`0-9a-zA-Z`) — 6 chars handles ~56 billion URLs
- **Redis TTL:** 5-minute sliding window, reset on every cache hit via `EXPIRE`
- **RabbitMQ topology:** Direct exchange `url_events`, routing key `click`, queue `click_events`
- **Analytics:** Captures browser, browser_version, OS, device_type, IP, referrer, user_agent

---

## Running Locally

### Prerequisites

- Docker + Docker Compose
- Node 18+ (frontend dev only)
- [k6](https://k6.io) (load testing only)

### Start everything

```bash
docker-compose up --build
```

| UI | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Kong proxy | http://localhost:8000 |
| Kong admin | http://localhost:8001 |
| RabbitMQ UI | http://localhost:15672 (guest / guest) |

### Quick smoke test

```bash
# Create a short URL
curl -X POST http://localhost:8000/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"longUrl": "https://www.github.com"}'

# Follow the redirect (use the slug from the response)
curl -L http://localhost:8000/r/<slug>
```

### Health checks

```bash
curl http://localhost:8000/api/health/creation
curl http://localhost:8000/api/health/redirect
curl http://localhost:8000/api/health/analytics
```

---

## Load Testing

Uses [k6](https://k6.io). Install via:

```bash
winget install k6 --source winget   # Windows
brew install k6                      # macOS
```

Run:

```bash
k6 run load-test/load_test.js
```

**Test plan:**

| Scenario | VUs | Duration | Thresholds |
|---|---|---|---|
| `shorten_load` | 0 → 20 → 0 | 60s | p95 < 500ms, errors < 1% |
| `redirect_load` | 0 → 50 → 0 | 40s (starts at 20s) | p95 < 100ms, errors < 1% |

The redirect threshold is tight (100ms) to verify Redis cache hit rate is high.

---

## AWS Deployment

See [`cdk/`](./cdk) for the full AWS CDK stack (TypeScript).

**AWS equivalents:**

| Local | AWS |
|---|---|
| Kong | API Gateway (HTTP API) |
| Creation / Redirect / Analytics | ECS Fargate |
| Redis | ElastiCache Serverless |
| MongoDB | Amazon DocumentDB |
| RabbitMQ | Amazon SQS |
| PostgreSQL | Amazon RDS PostgreSQL |
| Nginx + React | S3 + CloudFront |

```bash
cd cdk
npm install
npx cdk bootstrap
npx cdk deploy
```

---

## Project Structure

```
.
├── docker-compose.yml
├── kong/
│   └── kong.yml              # DB-less declarative Kong config
├── postgres/
│   └── init.sql              # clicks table + slug_stats materialized view
├── services/
│   ├── creation-service/     # Go — POST /api/shorten
│   ├── redirect-service/     # Go — GET /r/:slug
│   └── analytics-service/    # Go — RabbitMQ consumer
├── frontend/                 # React 18 + TypeScript + Vite
├── load-test/
│   └── load_test.js          # k6 load test
└── cdk/                      # AWS CDK stack
```
