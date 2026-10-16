# Developer environment and CI

How to set up a workstation and build HomeoClinic desktop artifacts for
Windows and Linux, and how CI does the same on every `main` commit.

Task: HC-MVP1-007 (handoff pack, P0). Requirements: **NFR-040** (Windows
10/11 x64, per-user, offline WebView2), **NFR-041** (Linux x64 AppImage +
`.deb`, WebKitGTK 4.1). Done-when: *a new developer builds Windows and Linux
artifacts from this guide.*

## Contents

| Doc | What it covers |
|---|---|
| [`environment.md`](environment.md) | Ubuntu 24.04 and Windows 10/11 setup: Node 20 (nvm), Rust stable (rustup), Tauri 2 system deps, SQLCipher/OpenSSL, WebView2, MSVC; the exact build/test/lint commands; artifact locations; E2E prerequisites. |
| [`ci.md`](ci.md) | The GitHub Actions workflow (`.github/workflows/ci.yml`): lint+test job and a build matrix over `ubuntu-latest` + `windows-latest` producing Linux and Windows artifacts on every `main` commit. |

The workflow itself is at [`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Read this first

The repository is **pre-M0**: there is no root `Cargo.toml`, no crate
`Cargo.toml`, and no Tauri project yet (only the folder scaffold and
READMEs — see `README.md` "Status" and `docs/CODE-LAYOUT.md`). So:

- **Toolchain installation works today.** Follow `environment.md` sections
  1-3 to get a ready workstation now.
- **Build / test / lint / artifact steps cannot run until M0 lands**
  (HC-MVP1-008 monorepo, 009 Tauri shell, 010 Rust workspace, 011 typed
  commands). Those steps are marked **(needs M0)** in `environment.md` and
  guarded by a `WORKSPACE_READY` variable in CI (see `ci.md`). They are the
  commands that **will** work once M0 exists; script names are finalised in
  M0 and this guide is updated then if they change.

## Related

- Build command reference: `hc-agents/skills/hc-build/SKILL.md`.
- Code layout and crate names: `docs/CODE-LAYOUT.md` (authoritative).
- Deployment targets and artifacts: `docs/design/02-architecture-overview.md`
  section 5.
- Release hardening, signing and the release scan are **not** here; they are
  `hc-release-gate` (TAM-002/006/012, NFR-025).
- CI's own M0 task (full artifact-publishing gate): HC-MVP1-013.
