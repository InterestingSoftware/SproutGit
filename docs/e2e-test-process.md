# E2E Test Process

This document defines the default E2E workflow for SproutGit.

## Defaults

- Playwright runs in headless mode by default via `e2e/playwright.config.ts`.
- E2E uses `@srsholmes/tauri-playwright` in `tauri` mode.
- Test workers are pinned to `1` for deterministic stateful desktop flows.
- `pnpm run test:e2e` executes tests in process-isolated mode (fresh Playwright/Tauri invocation per test).

## Per-Test Isolation

Each E2E spec should reset state in `beforeEach` with existing helpers:

1. Reset workspace test directories.
2. Reset isolated config DB path for the run.
3. Return to home screen with stable UI helpers.
4. Clear cached workspace hints in session storage.
5. Force a verified app reload before test actions.

The `reloadToHome()` helper in `e2e/helpers/ui.ts` is the source of truth for the in-app reset path and performs a verified reload after clearing `sg_workspace_hint` from session storage.

## Browser Dependency Setup

Playwright browser dependencies are installed via:

- `pnpm run setup:playwright`

This command is run automatically from `prepare`:

- `pnpm run prepare` => `husky && pnpm run setup:playwright`

Platform behavior:

- Linux: installs Chromium with system deps (`playwright install --with-deps chromium`).
- macOS/Windows: installs Chromium (`playwright install chromium`).

To skip local auto-setup:

- Set `SPROUTGIT_SKIP_PLAYWRIGHT_SETUP=1`.

## Pre-Commit Gate

`.husky/pre-commit` includes these checks in order:

1. `pnpm run cleanup:rust-targets:delete`
2. Rust unit tests
3. `pnpm run test`
4. Rust compile check
5. lint
6. type check
7. full E2E run

## Common Commands

```bash
# Standard e2e run (isolated process per test)
pnpm run test:e2e

# Tauri headed mode (runner maps this safely; do not pass --headed to Playwright directly)
pnpm run test:e2e --headed

# Build + e2e
pnpm run test:e2e:full

# Canary suites
pnpm run test:e2e:canary

# Screenshot suite
pnpm run test:e2e:screenshots
```
