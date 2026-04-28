# SproutGit Documentation Platform Plan

## Objective

Adopt a modern documentation platform that is:

- Hosted on the SproutGit website
- Updated directly from this codebase
- Easy for maintainers and AI agents to contribute to
- Fast, searchable, and simple to navigate
- Future-proof for versioning and API/reference growth

## Decision Summary

Primary recommendation: Astro Starlight.

Why this is the best fit for SproutGit now:

- The repository already contains an Astro website at `website/`
- Team can keep a single frontend ecosystem (Astro + Tailwind)
- Docs content can live in-repo and be updated via normal PR flow
- Starlight ships strong docs UX primitives (sidebar, breadcrumbs, structured nav)
- Supports modern search integrations and static hosting workflows

## Scope

In scope:

- Documentation architecture and content organization
- Site navigation model and information architecture
- Search strategy (initial + scalable options)
- llms.txt strategy and generation approach
- Contribution workflow for humans and AI agents
- CI/CD and quality gates for docs

Out of scope for this plan:

- Immediate implementation details
- Final visual theming decisions
- Full migration of all existing docs in one step

## Proposed Information Architecture

Top-level doc sections:

1. Getting Started
2. Core Concepts (worktree-first model)
3. User Guides (task-based workflows)
4. Reference (commands, settings, schemas)
5. Security and Cross-Platform Notes
6. Troubleshooting
7. Contributor Docs
8. Release Notes / Changelog

Content format strategy:

- Use Markdown/MDX for most pages
- Keep docs source in this repo to preserve version control and review history
- Treat README as a project entry point, but keep canonical deep docs in the docs site

## Search Strategy

Phase 1 (initial launch):

- Use built-in/local static search option suitable for static docs
- Optimize titles, headings, and page descriptions for discoverability

Phase 2 (scale-up):

- Evaluate Algolia DocSearch for larger content sets and advanced ranking
- Keep search provider abstracted so migration is low-risk

Acceptance expectations for search:

- Search finds pages by feature name, command name, and key terms
- Result snippets are meaningful and not just page titles
- Keyboard-friendly behavior and fast response on desktop/mobile

## llms.txt Strategy

Goal:

- Publish `llms.txt` from the docs website so LLM tools can discover key documentation resources and project context.

Plan:

1. Define a stable `llms.txt` schema for this project (project description + high-value links).
2. Generate `llms.txt` from docs metadata where practical to avoid manual drift.
3. Publish at the website root path (`/llms.txt`).
4. Add CI validation to ensure the file is generated/updated when docs structure changes.
5. Document ownership and update rules for `llms.txt` in contributor docs.

Suggested `llms.txt` content categories:

- Project identity and short description
- Primary docs index and getting-started links
- Security and architecture references
- Contribution workflow references
- Release notes location

## Contribution Model (Human + AI)

Goals:

- Make docs updates as easy as code changes
- Ensure AI-generated edits are reviewable and safe
- Prevent stale docs during rapid feature development

Workflow policy:

1. Docs updates are first-class PR content, not an afterthought.
2. Feature PR template includes a docs impact checklist.
3. Any user-visible behavior change requires at least one docs touchpoint (new page or updated section).
4. AI agents can propose docs edits, but all changes remain PR-reviewed.
5. Keep pages modular and task-oriented to reduce merge conflicts.

Authoring guidelines:

- Prefer concise, task-first headings
- Include platform-specific notes where behavior differs (macOS/Linux/Windows)
- Include troubleshooting and failure-mode notes close to relevant guides
- Use consistent terminology: repository, workspace, worktree, branch

## Migration Plan

### Phase 0: Preparation

- Audit current docs in `docs/`, README, and website pages
- Map existing content to target IA sections
- Identify duplicate or conflicting sources of truth

Exit criteria:

- Content inventory complete
- IA map approved

### Phase 1: Foundation

- Initialize docs section on website with core navigation skeleton
- Move or mirror a small pilot set of high-value pages
- Stand up baseline search

Exit criteria:

- Docs section live on website
- Navigation and search operational

### Phase 2: Content Migration

- Migrate remaining core docs in prioritized order:
  1. Getting started
  2. Worktree workflows
  3. Security/cross-platform guidance
  4. Contributor and troubleshooting content
- Add redirects or clear mapping from old locations where needed

Exit criteria:

- Core documentation topics available in new docs section
- No major dead links

### Phase 3: llms.txt + Quality Gates

- Publish generated `llms.txt`
- Add CI checks for docs build, link integrity, and metadata validation
- Add docs contribution checklist to PR workflow

Exit criteria:

- `llms.txt` available and validated
- Docs quality checks running in CI

### Phase 4: Polish and Scale

- Improve information scent (labels, summaries, cross-links)
- Tune search relevance and analytics
- Add versioning strategy if/when release cadence requires it

Exit criteria:

- Positive contributor and reader feedback
- Reduced doc discovery friction

## CI/CD and Quality Gates (Planned)

Planned checks for docs pull requests:

1. Docs build must pass
2. Internal links must resolve
3. Broken anchors should fail the check
4. `llms.txt` validation should pass when docs navigation changes
5. Optional spelling/style lint (non-blocking initially)

Release/deploy model:

- Docs deploy with website pipeline from main branch
- Preview builds for PRs to review docs before merge

## Ownership and Operating Model

Proposed ownership:

- Maintainers own final editorial and structural decisions
- Contributors (including AI agents) can submit improvements
- Security-sensitive docs require explicit maintainer review

Maintenance cadence:

- Continuous updates with feature PRs
- Recurring docs quality sweep (dead links, stale screenshots, drift checks)

## Risks and Mitigations

Risk: docs drift from product behavior.
Mitigation: require docs impact review in feature PR template and CI checks.

Risk: navigation grows confusing as docs scale.
Mitigation: enforce IA limits and section ownership; run periodic nav refactors.

Risk: search quality degrades with content growth.
Mitigation: monitor search analytics and tune ranking/content structure.

Risk: `llms.txt` becomes stale.
Mitigation: generate from metadata and validate in CI.

## Success Metrics

1. Time-to-first-answer for common tasks decreases (qualitative + support feedback).
2. Docs PR frequency increases without quality regressions.
3. Search success improves (fewer repeated navigation clicks before target page).
4. Fewer support questions for documented workflows.
5. `llms.txt` remains current across releases.

## Open Decisions

1. Final search provider at scale (stay static/local vs Algolia).
2. Versioning trigger: at what release threshold to enable versioned docs.
3. Screenshot/media standards and update ownership.
4. Whether to keep all architecture docs in one location or split between `/docs` and website docs content.

## Next Step (Planning Only)

Create a short architecture decision record (ADR) confirming Astro Starlight as the selected platform and linking this plan as the implementation guide.
