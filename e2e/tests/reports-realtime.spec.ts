import { test, expect, type Route } from "@playwright/test";

// End-to-end coverage for the realtime feed on the Reports page.
//
// The app is rendered against the real Vite dev build, but every external
// dependency is faked so the test is hermetic and needs no live backend:
//   - Supabase auth: a fake session is seeded into localStorage (the app's
//     `getSession()` reads it locally, so no Google OAuth round-trip happens).
//   - REST: /api/reports/access, /analytics and the paginated list are mocked.
//   - Realtime: `page.routeWebSocket` stands in for the ReportRealtime Durable
//     Object, letting the test push a `report_changed` frame to the client.
//
// What we assert: once the WebSocket opens the badge flips to "Live", and when
// a change is broadcast the list silently refetches and shows the new report —
// i.e. the wiring added in ReportsView.tsx actually drives a live update.

const STORAGE_KEY = "sincedu-testing-supabase-auth";

const SESSION = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800, // 2100-01-01 — far future so the client never refreshes.
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "admin@studyinnc.com",
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: "Realtime Admin" },
    identities: [],
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
  },
};

const ACCESS = { isTester: true, isAdmin: true, email: "admin@studyinnc.com", name: "Realtime Admin" };

function makeReport(overrides: Record<string, unknown>) {
  return {
    id: `r-${Math.abs(hash(String(overrides.title ?? "")))}`,
    project: "Acme Portal",
    reporter_email: "tester@studyinnc.com",
    reporter_name: "Tester",
    title: "Placeholder report",
    note: null,
    severity: "medium",
    status: "open",
    page_url: "https://acme.example/app",
    element_selector: null,
    console_count: 0,
    network_count: 0,
    screenshot_key: null,
    updated_by_email: null,
    updated_by_source: null,
    fixed_at: null,
    fixed_by_email: null,
    fix_commit_sha: null,
    fix_commit_url: null,
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function hash(value: string): number {
  let out = 0;
  for (let i = 0; i < value.length; i += 1) out = (out * 31 + value.charCodeAt(i)) | 0;
  return out;
}

const FIRST_TITLE = "First report — initial load";
const LIVE_TITLE = "Second report — arrived live";

test("Reports page shows a live update when a report_changed event arrives", async ({ page }) => {
  // 1. Seed a fake Supabase session so the app renders past the auth gate.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify(SESSION)] as const,
  );

  // 2. Mock the REST surface the Reports page touches.
  await page.route(/\/api\/reports\/access(\?|$)/, (route: Route) => route.fulfill({ json: ACCESS }));
  await page.route(/\/api\/reports\/analytics/, (route: Route) =>
    route.fulfill({ json: { totals: {}, projects: [], byStatus: [], bySeverity: [], byDomain: [], byReporter: [] } }),
  );
  // Screenshot thumbnails aren't part of this test — short-circuit them.
  await page.route(/\/api\/reports\/[^/?]+\/screenshot/, (route: Route) => route.fulfill({ status: 404, body: "" }));

  // The list endpoint returns one report until a change is broadcast, then two.
  // Gating on a flag (not call count) keeps this robust against React
  // StrictMode double-firing the initial load in dev.
  let changed = false;
  let listCalls = 0;
  await page.route(/\/api\/reports\?limit=/, (route: Route) => {
    listCalls += 1;
    const reports = changed
      ? [makeReport({ title: LIVE_TITLE }), makeReport({ title: FIRST_TITLE })]
      : [makeReport({ title: FIRST_TITLE })];
    return route.fulfill({ json: { reports, total: reports.length, limit: 500, offset: 0 } });
  });

  // 3. Stand in for the realtime Durable Object. Not calling connectToServer()
  //    makes Playwright the server: the client's `open` fires immediately.
  let broadcast: (() => void) | null = null;
  await page.routeWebSocket(/\/api\/reports\/realtime/, (ws) => {
    broadcast = () => {
      changed = true;
      ws.send(JSON.stringify({ type: "report_changed", action: "created", at: "2026-07-10T00:00:00.000Z" }));
    };
  });

  await page.goto("/reports");

  // Initial render: the Reports table shows the first report.
  await expect(page.getByText(FIRST_TITLE)).toBeVisible();
  await expect(page.getByText(LIVE_TITLE)).toHaveCount(0);

  // The socket is open, so the badge reports a live connection.
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  // Broadcast a change → the list silently refetches → the new report appears.
  await expect.poll(() => broadcast !== null).toBeTruthy();
  const callsBeforeBroadcast = listCalls;
  broadcast!();

  await expect(page.getByText(LIVE_TITLE)).toBeVisible();
  expect(listCalls).toBeGreaterThan(callsBeforeBroadcast);
});
