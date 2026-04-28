# SproutGit Benchmark Repository Strategy

## Purpose

Define a durable strategy for sample repositories used by SproutGit for:

- Product screenshots and videos
- Manual QA and demos
- Performance and edge-case testing
- Regression validation across releases

This strategy avoids stale, hand-curated datasets while preserving deterministic media capture.

## Decision Summary

Use a hybrid model:

1. Generated benchmark repositories are the source of truth.
2. Versioned snapshots are used for screenshots and videos.
3. Popular open-source repositories are used as canary tests, not as primary media sources.

Rationale:

- Pure curated repos go stale.
- Pure popular repos are non-deterministic and can drift unexpectedly.
- Generated plus snapshot repositories provide both freshness and repeatability.

## Repository Classes

### Class A: Hero Media Repository

Use one stable benchmark repo for all public screenshots and videos.

Characteristics:

- Rich branch and merge topology for compelling graph visuals
- Realistic multi-area file structure for meaningful diffs
- Predictable named scenarios for repeatable captures

Policy:

- Media captures must use a pinned snapshot tag.
- Do not use live popular repos for marketing media.

### Class B: Generated Stress Repositories

Use generated datasets to test limits and edge cases.

Recommended scenario modules:

1. Graph Topology Stress: dense branching, frequent merges, tags
2. Naming and Ref Edge Cases: long names, separators, detached states
3. Scale Stress: high file counts and large diffs
4. Hook Orchestration Stress: dependency chains, failures, timeout paths

Policy:

- Repositories are regenerated on a fixed cadence.
- Scenario generation is deterministic from known inputs.

### Class C: Popular Repo Canaries

Use a small rotating set of widely used repositories as realism checks.

Policy:

- Canary tests are non-blocking by default.
- Pin to known commit SHAs when possible.
- Failures trigger investigation, not immediate release failure.

## Freshness and Stability Model

### Continuous Freshness

Maintain generator scripts and regenerate benchmark repositories regularly.

Suggested cadence:

- Regeneration at a recurring cadence defined by maintainers
- Additional regeneration at major release milestones

### Snapshot Stability

Publish versioned snapshot tags from generated repositories.

Suggested naming:

- benchmark-vN
- benchmark-vN-patchN

Usage:

- QA and media references always target a specific snapshot tag.
- CI runs should include latest plus previous snapshot for drift checks.

## Media Capture Policy

Use a deterministic runbook for screenshots and videos.

Rules:

1. Capture from pinned snapshot only.
2. Use predefined scenario branches and states.
3. Reset local state before every recording session.
4. Keep a canonical shot list so visuals remain comparable over time.

Suggested canonical shot list:

1. Worktree list with managed and external entries
2. Branch and worktree creation flow
3. Commit graph search and navigation
4. Diff viewer with small and medium patches
5. Hook execution status and error handling
6. Context menu and copy actions

## Governance and Ownership

### Owners

- Maintainers own benchmark scenario definitions and acceptance criteria.
- Contributors can propose new scenarios via pull requests.
- AI agents may update scenario docs and scripts, subject to maintainer review.

### Change Control

Any benchmark scenario change should include:

1. Why the change is needed
2. Which flows are affected
3. Expected impact on screenshots/videos/tests
4. Whether a new snapshot tag is required

## CI and Validation Strategy

Planned checks:

1. Generator outputs are deterministic for fixed seeds
2. Snapshot metadata matches declared scenario versions
3. Core benchmark smoke tests pass on current snapshot
4. Canary suite runs separately and reports drift

Recommended lane split:

- Blocking lane: generated snapshot-based benchmarks
- Non-blocking lane: popular repository canaries

## Risk Register

Risk: benchmark scenarios become unrealistic.
Mitigation: periodic review against real-world canary findings.

Risk: snapshot sprawl and maintenance overhead.
Mitigation: retention policy with latest plus N historical snapshots.

Risk: flaky canary outcomes from upstream changes.
Mitigation: keep canaries non-blocking and pin SHAs where possible.

Risk: media inconsistency across releases.
Mitigation: enforce pinned snapshot plus canonical capture runbook.

## Success Criteria

1. Screenshot and video capture remains reproducible across releases.
2. Benchmark datasets are refreshed via defined regeneration triggers without manual churn.
3. Regressions are detected in generated benchmarks before release.
4. Canary lane reveals real-world drift without destabilizing release cadence.

## Rollout Plan

### Phase 1

- Define scenario modules and deterministic generation inputs
- Define snapshot naming and retention policy
- Draft media capture runbook

### Phase 2

- Generate initial benchmark set
- Publish first pinned snapshot tags
- Validate core flows for screenshots and QA

### Phase 3

- Add canary repository lane with non-blocking reporting
- Compare canary findings against generated scenarios
- Adjust scenario modules where coverage is weak

### Phase 4

- Finalize benchmark governance and maintenance cadence
- Integrate into release checklist
- Publish internal guidance for maintainers and contributors

## Open Questions

1. Which exact repos should be in the canary rotation?
2. What retention window is appropriate for snapshot tags?
3. Which benchmark failures should block release immediately?
4. Should media assets include snapshot tag watermarking in metadata?
