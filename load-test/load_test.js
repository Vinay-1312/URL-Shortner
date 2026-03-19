import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ── Custom metrics ────────────────────────────────────────────────────────────
const shortenErrorRate = new Rate("shorten_errors");
const redirectErrorRate = new Rate("redirect_errors");
const shortenDuration = new Trend("shorten_duration_ms", true);
const redirectDuration = new Trend("redirect_duration_ms", true);

const BASE = "http://localhost:8000";

const URLS = [
  "https://www.google.com",
  "https://www.github.com",
  "https://www.stackoverflow.com",
  "https://www.wikipedia.org",
  "https://www.youtube.com",
  "https://www.reddit.com",
  "https://www.twitter.com",
  "https://www.linkedin.com",
  "https://www.amazon.com",
  "https://www.netflix.com",
];

// ── Test stages ───────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    shorten_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 10 },
        { duration: "30s", target: 20 },
        { duration: "15s", target: 0 },
      ],
      exec: "shortenScenario",
    },
    redirect_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 30 },
        { duration: "20s", target: 50 },
        { duration: "5s",  target: 0 },
      ],
      exec: "redirectScenario",
    },
  },
  thresholds: {
    shorten_duration_ms: ["p(95)<500"],
    redirect_duration_ms: ["p(95)<100"],
    shorten_errors:  ["rate<0.01"],
    redirect_errors: ["rate<0.01"],
  },
};

// ── Setup: pre-create 30 slugs before any VUs start ──────────────────────────
// k6 runs setup() once, its return value is passed as `data` to every scenario.
export function setup() {
  const slugs = [];

  for (let i = 0; i < 30; i++) {
    const longUrl = URLS[i % URLS.length];
    const res = http.post(
      `${BASE}/api/shorten`,
      JSON.stringify({ longUrl }),
      { headers: { "Content-Type": "application/json" } }
    );
    if (res.status === 201) {
      try {
        const slug = JSON.parse(res.body).slug;
        if (slug) slugs.push(slug);
      } catch (_) {}
    }
  }

  console.log(`setup: pre-created ${slugs.length} slugs`);
  return { slugs };
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

export function shortenScenario(data) {
  const longUrl = URLS[Math.floor(Math.random() * URLS.length)];

  const res = http.post(
    `${BASE}/api/shorten`,
    JSON.stringify({ longUrl }),
    { headers: { "Content-Type": "application/json" } }
  );

  shortenDuration.add(res.timings.duration);

  const ok = check(res, {
    "shorten: status 201":   (r) => r.status === 201,
    "shorten: has shortUrl": (r) => {
      try { return JSON.parse(r.body).shortUrl !== undefined; }
      catch { return false; }
    },
  });

  shortenErrorRate.add(!ok);
  sleep(0.5);
}

export function redirectScenario(data) {
  const { slugs } = data;
  const slug = slugs[Math.floor(Math.random() * slugs.length)];

  const res = http.get(`${BASE}/r/${slug}`, { redirects: 0 });

  redirectDuration.add(res.timings.duration);

  const ok = check(res, {
    "redirect: status 302": (r) => r.status === 302,
    "redirect: Location header present": (r) => r.headers["Location"] !== undefined,
  });

  redirectErrorRate.add(!ok);
  sleep(0.1);
}
