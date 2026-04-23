# SproutGit Docs Index

This file is the maintained entry point for the `docs/` folder.

## Maintenance Rule

Update this index whenever a document in `docs/` is added, renamed, removed, or substantially repurposed.

## Agent Workflow

On a new task:

1. Read this file first.
2. Identify which linked docs are relevant to the request.
3. Read those docs before making design or implementation decisions.

## Document Catalog

### Product And Workflow

- [requirements.md](requirements.md) — MVP scope, core UX principles, prescribed workspace layout, and default worktree-first product expectations.
- [branch-worktree-policy.md](branch-worktree-policy.md) — Branch/worktree binding rules, managed vs persistent branch policy, merge flow, and cleanup semantics.
- [worktree-hooks.md](worktree-hooks.md) — Proposed worktree lifecycle hook model, trigger semantics, scope, and constraints.
- [design-review-and-screen-plan.md](design-review-and-screen-plan.md) — Screen inventory, route flow, and UI architecture for the MVP.

### Architecture And Platform

- [architecture.md](architecture.md) — Backend git/system command architecture, validator pipeline, composability analysis, and extension guidance.
- [docs-platform-plan.md](docs-platform-plan.md) — Documentation-site strategy, information architecture, search plan, and contribution model for long-form docs.

### Security

- [security-audit.md](security-audit.md) — Security review of git/system interactions, risks found, and backend hardening decisions.

### Testing, QA, And Benchmarks

- [benchmark-repository-strategy.md](benchmark-repository-strategy.md) — Strategy for sample repositories used in screenshots, demos, regression validation, and performance testing.
- [tauri-playwright-adapter-cheatsheet.md](tauri-playwright-adapter-cheatsheet.md) — API signatures, adapter-specific gotchas, and runtime port/socket guidance for `@srsholmes/tauri-playwright`.
- [e2e-test-process.md](e2e-test-process.md) — Default E2E runtime behavior, per-test isolation flow, Playwright dependency setup, and pre-commit test gates.

## Quick Relevance Guide

- Worktree lifecycle, branch deletion, merge cleanup, or branch ownership questions: read [branch-worktree-policy.md](branch-worktree-policy.md).
- Core product behavior or MVP fit questions: read [requirements.md](requirements.md).
- Backend git/system execution changes: read [architecture.md](architecture.md) and [security-audit.md](security-audit.md).
- Hook behavior or hook UI changes: read [worktree-hooks.md](worktree-hooks.md).
- Screen structure, navigation, or UI flow changes: read [design-review-and-screen-plan.md](design-review-and-screen-plan.md).
- Docs-site or documentation-process work: read [docs-platform-plan.md](docs-platform-plan.md).
- Benchmark/demo/test repository work: read [benchmark-repository-strategy.md](benchmark-repository-strategy.md).
- Tauri E2E harness behavior, adapter APIs, or test fixture issues: read [tauri-playwright-adapter-cheatsheet.md](tauri-playwright-adapter-cheatsheet.md).
- E2E reset behavior, headless defaults, test command usage, or local browser setup flow: read [e2e-test-process.md](e2e-test-process.md).