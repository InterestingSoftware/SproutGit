---
title: Installation
description: Download SproutGit and install its one prerequisite, Git.
---

SproutGit is distributed as a packaged desktop app — you don't need Node.js,
pnpm, or any build tooling to run it. You only need Git itself installed on
your system, since SproutGit drives your local Git installation rather than
bundling its own.

:::caution
SproutGit is an early prototype under active development. Expect missing
features, rough edges, and breaking changes between releases.
:::

## Prerequisite: Git

Check whether Git is already installed:

```sh
git --version
```

If that fails, install Git for your platform:

- **macOS** — `xcode-select --install`, or via [Homebrew](https://brew.sh): `brew install git`
- **Windows** — [git-scm.com/download/win](https://git-scm.com/download/win)
- **Linux** — your distro's package manager, e.g. `sudo apt install git` (Debian/Ubuntu) or `sudo dnf install git` (Fedora)

SproutGit's **Settings → About** panel shows whether it can find Git and
which version it detected — if it says "Not found," Git either isn't
installed or isn't on your `PATH`.

## Download SproutGit

Grab the latest build for your platform from the
[GitHub Releases page](https://github.com/InterestingSoftware/SproutGit/releases/latest):

| Platform | Download |
|---|---|
| macOS (Apple Silicon or Intel) | `.dmg` |
| Windows (x64) | installer `.exe` |
| Linux (x64) | `.AppImage` |

### macOS

Open the `.dmg` and drag **SproutGit** into your Applications folder. On
first launch, macOS Gatekeeper may warn that the app is from an
unidentified developer, since preview builds aren't notarized yet — right-click
the app and choose **Open** to bypass this once.

### Windows

Run the installer and follow the prompts. If SmartScreen flags the
installer as unrecognized, choose **More info → Run anyway**.

### Linux

Make the AppImage executable and run it:

```sh
chmod +x SproutGit-*.AppImage
./SproutGit-*.AppImage
```

## Staying up to date

SproutGit checks for updates automatically and can install them in place —
see **Settings → About** for the current version and update status.

## Next step

Continue to [Your first workspace](/docs/getting-started/first-workspace/)
to open or create a project.
