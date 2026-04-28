# Tauri Playwright Adapter Cheatsheet

This document is a practical reference for using `@srsholmes/tauri-playwright` in this repo.

Sources consulted:

- Installed package README: `node_modules/@srsholmes/tauri-playwright/README.md`
- Installed type definitions: `node_modules/@srsholmes/tauri-playwright/dist/index.d.ts`

## What This Adapter Is

`@srsholmes/tauri-playwright` provides a Playwright-like API for real Tauri webviews through the Rust plugin bridge (`tauri-plugin-playwright`).

It supports three modes:

- `browser`: Chromium + mocked Tauri IPC.
- `tauri`: real app + plugin bridge (cross-platform).
- `cdp`: WebView2 CDP (Windows).

For SproutGit E2E, we primarily use `tauri` mode behavior with `PluginClient` + `TauriPage`.

## Quick Wiring Checklist

1. Rust plugin enabled only for E2E feature:

- Cargo feature `e2e-testing = ["dep:tauri-plugin-playwright"]`
- Tauri builder plugin registration under `#[cfg(feature = "e2e-testing")]`
- E2E builds use `src-tauri/tauri.e2e.conf.json` so only E2E runs opt into the extra inline Playwright capability

2. Capabilities:

- Keep the default app config pinned to `"default"` capability only.
- Add Playwright permissions only from the E2E config overlay, not from the default capability file.

3. Runtime connectivity:

- `PluginClient(socketPath, tcpPort)` must match backend plugin config exactly.
- Keep socket path / TCP port consistent between webServer process and test worker process.

## API Gotchas (Important)

### 1. `TauriLocator.waitFor` takes a number, not an options object

Correct:

```ts
await tauriPage.getByTestId('btn-import').waitFor(15000);
```

Incorrect:

```ts
await tauriPage.getByTestId('btn-import').waitFor({ timeout: 15000 });
```

Why: adapter expects `waitFor(timeout?: number)`. Passing an object causes runtime command deserialization errors.

### 2. `TauriPage` is not a native Playwright `Page`

Do not assume Playwright `page.on(...)` event APIs are available on `TauriPage`.

Example of unsupported pattern:

```ts
tauriPage.on('console', ...)
```

Use adapter-supported methods (`locator`, `getBy*`, `waitForFunction`, `allTextContents`, screenshots, etc.) and explicit UI/state assertions.

### 3. Prefer adapter-native wait primitives

Supported and reliable:

- `tauriPage.waitForSelector(selector, timeout?)`
- `tauriPage.waitForFunction(script, timeout?)`
- `locator.waitFor(timeout?)`

When startup synchronization is flaky, prefer waiting on stable UI test IDs over immediate `evaluate` navigation.

### 4. Command timeout behavior

Adapter commands fail with messages like:

- `TauriPage command 'eval' failed: timeout (30s)`

Use short test timeouts and deterministic readiness checks to fail fast.

## Commonly Used Calls In This Repo

### Page interactions

```ts
await tauriPage.click('[data-testid="btn-import"]');
await tauriPage.fill('[data-testid="import-repo-path"]', repoPath);
await tauriPage.getByTestId('import-submit').click();
```

### Read toasts

```ts
const errors = await tauriPage.allTextContents(
  '[data-testid="toast-item"][data-toast-type="error"] [data-testid="toast-message"]'
);
```

### Wait for app readiness

```ts
await tauriPage.getByTestId('btn-import').waitFor(15000);
```

### Evaluate script

```ts
await tauriPage.evaluate(`(() => {
  if (window.location.pathname !== '/') {
    window.location.assign('/');
    return;
  }

  window.location.reload();
})()`);
```

Use this pattern for route reset in `tauri` mode. Do not use `page.goto()` as a substitute for webview navigation.

## Startup/Port Guidance For Parallel Runs

To allow multiple parallel test runs:

- Allocate dynamic dev server and plugin ports per run.
- Use a unique plugin socket path per run.
- Ensure these values are computed once and shared across all Playwright processes in that run.

If each process computes independently, worker and webServer can drift and fail with socket mismatch/ENOENT.

## Suggested SproutGit Testing Defaults

- Keep test-level timeout modest (around 45s).
- Keep webServer startup timeout modest (around 90s).
- Keep plugin connect timeout modest (around 30s).
- Fail fast on startup error toasts, and attach them to test artifacts.
- Reset state per spec in `beforeEach`, not via a global Playwright hook.
- For per-test isolation, delete the E2E workspace dir and config DB, then return to the home screen with stable in-app navigation.
- Prefer a persistent app process plus per-test state reset over restarting Tauri between tests.

## Debug Checklist

If a test fails before first interaction:

1. Confirm plugin started and printed socket path.
2. Confirm fixture socket path matches backend socket path exactly.
3. Confirm locator waits use numeric timeout signatures.
4. Confirm no unsupported Playwright Page APIs are used on `TauriPage`.
5. Confirm startup toasts are captured with test IDs and attached on failure.

## Known Failures (SproutGit)

These are real failures we have already hit in this repo and what they usually mean.

1. `Could not connect to Playwright plugin within 30000ms: Error: connect ENOENT /tmp/...sock`

- Meaning: fixture and backend are using different socket paths.
- Fix: compute socket path once per run and propagate through environment to both webServer and worker process.

2. `TauriPage command 'wait_for_selector' failed: invalid command: invalid type: map, expected u64`

- Meaning: `locator.waitFor` was called with a Playwright options object.
- Fix: call `locator.waitFor(15000)` with numeric timeout.

3. `TypeError: appSession.tauriPage.on is not a function`

- Meaning: `TauriPage` is not a native Playwright `Page` event emitter.
- Fix: remove `page.on(...)` usage and rely on adapter-supported APIs.

4. `TauriPage command 'eval' failed: timeout (30s)`

- Meaning: startup navigation/evaluation happened before bridge/page readiness or got stuck.
- Fix: use deterministic UI readiness checks (stable test IDs) and avoid fragile early eval loops.

5. `Failed to load recent workspaces: Config database migration failed ... Safety level may not be changed inside a transaction`

- Meaning: migration SQL included PRAGMA statements executed in migration transaction.
- Fix: keep PRAGMAs in connection-open code (`db.rs`) and remove PRAGMAs from migration SQL files.

6. `page.goto: Target page, context or browser has been closed`

- Meaning: `page.goto()` was called while using adapter `tauri` mode, so navigation went through the browser-side adapter instead of the Tauri webview.
- Fix: never use `page.goto()` for Tauri startup/reset. Use stable UI waits, UI-driven navigation, or in-webview `window.location.assign('/')` / `window.location.reload()` via `evaluate()`.

7. `Failed to load config ... database is locked` during E2E state reset

- Meaning: test cleanup deleted or mutated the config DB while an operation still had it open, or multiple processes shared the same config DB.
- Fix: scope `SPROUTGIT_CONFIG_DB_PATH` per run, keep workers at `1`, and reset the config DB before the next test starts. SproutGit opens config DB connections on demand, so deleting the isolated DB between tests is safe when no command is actively using it.

8. Full suite flakes when using hard reload in every `beforeEach`

- Meaning: forcing `window.location.assign('/')` / `window.location.reload()` before each spec can be less stable than UI-driven navigation in `tauri` mode when tests share one long-lived app process.
- Fix: use a persistent app process, reset disk state between tests, and use an `ensureHome()` helper that clicks back to the project list and waits for stable home-screen test IDs. Keep hard reloads as a targeted debugging tool, not the suite default.
