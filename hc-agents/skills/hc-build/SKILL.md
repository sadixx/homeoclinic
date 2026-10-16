---
name: hc-build
description: How to build, test and lint HomeoClinic (cargo workspace + Vite/React + Tauri 2 bundler) with reliable log capture, and the common build error patterns. Use when building, running tests, or diagnosing a build failure.
---

# HomeoClinic Build

Mirror of RBKS `firmware-build` + `build-error-patterns`.

## Rules

- Always run from `$HC_REPO`. Never from `$HC_ROOT` or `/`.
- Always capture stdout AND stderr: `<cmd> > <log> 2>&1; echo "exit=$?"`.
  A log without `2>&1` is not evidence of success.
- Logs go to `<worklog-dir>/logs/<step>-<n>.log`.
- Never read a whole log. `tail -n 40`, then `grep -n` for patterns.
- Builds are never triggered by reviewers or analyzers.

## Commands

| Step | Command |
|---|---|
| Install JS deps | `npm ci` (in `apps/desktop`) |
| Rust check | `cargo check --workspace --all-targets` |
| Rust unit tests | `cargo test --workspace` |
| One crate | `cargo test -p hc-search` |
| One test | `cargo test -p hc-search -- <name> --exact` |
| UI unit tests | `npm --prefix apps/desktop run test -- --run` |
| Type check | `npm --prefix apps/desktop run typecheck` (`tsc --noEmit`) |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` |
| Rust format | `cargo fmt --all -- --check` |
| UI lint | `npm --prefix apps/desktop run lint` |
| Dependency audit | `cargo audit` and `npm --prefix apps/desktop audit --omit=dev` |
| Debug app build (target build) | `npm --prefix apps/desktop run tauri build -- --debug` |
| Release bundle (release-gate only) | `npm --prefix apps/desktop run tauri build` |
| Coverage (on request) | `cargo llvm-cov --workspace --summary-only` |

If `package.json` scripts differ, read them first and use the real names.
Never invent a script.

## Target build

"Target build passes" means the debug Tauri build succeeds on Linux.
Windows build is required when the change touches: installer config, file
paths, DPAPI/key storage, printing, WebView2, or `#[cfg(windows)]` code. If
no Windows machine/VM is available, say so explicitly; do not claim it.

## Common error patterns

| Symptom | Usual cause | Fix direction |
|---|---|---|
| `error[E0432]: unresolved import` | crate not in `[dependencies]` or not `pub` | add dep in that crate's Cargo.toml / `pub use` |
| `error[E0277]: ... is not satisfied` on `Serialize`/`specta::Type` | command type missing derive | add `#[derive(Serialize, Deserialize, specta::Type)]` |
| `failed to run custom build command for libsqlite3-sys` / `sqlcipher` | missing system OpenSSL / SQLCipher, or wrong feature | enable `bundled-sqlcipher` feature or install `libssl-dev` |
| `webkit2gtk-4.1 not found` | Linux Tauri system deps missing | install `libwebkit2gtk-4.1-dev` (environment issue, report it) |
| `TS2307: Cannot find module './bindings'` | specta bindings not regenerated | run the bindings export step (`cargo test -p hc-app export_bindings` or the repo's documented step) |
| `TS2339` on a command result | Rust type changed, bindings stale | regenerate bindings, then fix callers |
| `command <x> not allowed` at runtime | Tauri capability missing | add to `src-tauri/capabilities/*.json`, never widen to `*` |
| `database is locked` in tests | writer connection shared across threads | use the single writer actor / in-memory DB per test |
| clippy `needless_*` / `too_many_arguments` | lint | `hc-lint-fixer` |
| Vite `Failed to resolve import` | path alias mismatch tsconfig vs vite config | align `paths` and `resolve.alias` |

Focus on the FIRST error of each kind; later errors usually cascade.
