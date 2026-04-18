# SproutGit

SproutGit is an open source, cross-platform Git desktop app built with Tauri + SvelteKit + TypeScript.

## MVP Direction

- Worktree-first Git workflow
- Lightweight and fast desktop UX
- Open source (MIT)
- BYOK AI features planned for v0.2

## Prerequisites

- Node.js (via nvm is fine)
- Rust toolchain (rustup)

## Setup

```bash
npm install
```

## Development

```bash
npm run tauri dev
```

## Quality Checks

```bash
npm run check
npm run build
cd src-tauri && cargo check
```
