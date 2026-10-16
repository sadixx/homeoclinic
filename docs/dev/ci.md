# Continuous integration (GitHub Actions)

This describes the CI workflow at `.github/workflows/ci.yml`: a single
coherent pipeline that lints, tests, audits and builds debug HomeoClinic
artifacts for **Linux and Windows on every `main`-branch commit** and on every
pull request targeting `main`, plus a Linux E2E smoke run of the R0
walking-skeleton spec.

The M0 workspace exists (root `Cargo.toml` + `Cargo.lock`,
`apps/desktop/package.json` + `package-lock.json`, the `hc-*` crates,
`src-tauri`, the React app), so **every step runs for real on every commit** —
there is no longer a `WORKSPACE_READY` guard. (The earlier HC-MVP1-007 starter
gated real steps behind that repo variable while the workspace was being
created; HC-MVP1-013/014/015 removed the guard and made the gates blocking.)

## Why this exists (requirements)

| Requirement | How CI satisfies it |
|---|---|
| **R-DEL-001** main is always releasable | Every push to `main` runs the full lint+test+audit gate and builds Windows and Linux artifacts; a red pipeline means main is not releasable. |
| requirements/05 section 6: "Build artifacts for Windows and Linux on every main-branch commit" (**HC-MVP1-013**) | The `build` job runs a matrix over `ubuntu-latest` and `windows-latest` and uploads both artifacts via `actions/upload-artifact@v4`, downloadable from the run. |
| **NFR-040** Windows 10/11 x64 | Windows artifacts (NSIS `-setup.exe` + `.msi`) built on `windows-latest`. |
| **NFR-041** Linux x64 (AppImage + .deb), WebKitGTK 4.1 | Ubuntu job installs the WebKitGTK 4.1 system deps and builds the AppImage + `.deb`. |
| requirements/05 section 6: lint gate, R-LINT-001..005 (**HC-MVP1-014**) | Blocking `cargo fmt --check`, `clippy -D warnings`, ESLint, Prettier `--check`, `tsc` strict. |
| **NFR-024 / R-SEC-008** pinned + audited deps (**HC-MVP1-015**) | `Cargo.lock` and `apps/desktop/package-lock.json` are committed; blocking `cargo audit` + `npm audit`. |
| **R-SEC-008** pinned action versions | Every `uses:` is pinned to a released tag. |
| **R-SEC-005** no secrets in the workflow | No `secrets.*` references; signing keys are the release pipeline's job. |

## Jobs

### 1. `lint-and-test` (ubuntu-latest)

Runs the quality gates once on Linux (they are OS-independent). Every step is
blocking — any violation fails the job:

1. Checkout; Node 20 (`actions/setup-node`, npm cache); Rust stable + `clippy`,
   `rustfmt`; cargo cache (`Swatinem/rust-cache`).
2. Install the Ubuntu system deps (WebKitGTK 4.1 etc.) — `clippy`/`cargo test`
   on the Tauri crate link against WebKitGTK.
3. **Rust lint (R-LINT-001/002):** `cargo fmt --all -- --check`,
   `cargo clippy --workspace --all-targets -- -D warnings`.
4. `cargo test --workspace`.
5. **JS/TS gate:** `npm ci`, then `npm run typecheck` (R-LINT-005, `tsc
   --noEmit` strict), `npm run lint` (R-LINT-003, ESLint),
   `npm run format -- --check` (R-LINT-004, Prettier check mode),
   `npm run test -- --run` — all in `apps/desktop`.
6. **Dependency audit (NFR-024 / R-SEC-008):**
   - `cargo audit` — fails on any RUSTSEC *vulnerability* (a crate with a
     patched version). Unmaintained/unsound advisories are reported as
     warnings and do not fail the build.
   - `npm audit --omit=dev --audit-level=high` in `apps/desktop` — fails on
     any **high or critical** advisory in the production dependency tree. The
     done-when for HC-MVP1-015 ("a known vulnerable dependency fails CI") is
     met at this threshold. Moderate/low advisories whose only remediation is
     a breaking major version bump are reported but do not block `main`
     (R-DEL-001); they are tracked as dependency-upgrade work.

### 2. `build` (matrix: ubuntu-latest, windows-latest)

Builds the **debug** Tauri artifacts and uploads them. Debug (not release)
because release hardening and signing belong to `hc-release-gate`
(TAM-002/006, NFR-025). Steps:

1. Checkout; Node 20; Rust stable; `Swatinem/rust-cache`.
2. **Ubuntu only:** install the WebKitGTK 4.1 system deps.
3. `npm ci` in `apps/desktop`.
4. `npm run tauri build -- --debug` in `apps/desktop`.
5. Upload artifacts with `actions/upload-artifact@v4` from the
   **workspace-root** `target/debug/bundle/` dir (the cargo workspace is
   rooted at the repo root, so the bundle is **not** under
   `apps/desktop/src-tauri/target`):
   - Linux: `target/debug/bundle/appimage/*.AppImage` and
     `target/debug/bundle/deb/*.deb` → artifact `homeoclinic-linux-x64-debug`.
   - Windows: `target/debug/bundle/nsis/*-setup.exe` and
     `target/debug/bundle/msi/*.msi` → artifact
     `homeoclinic-windows-x64-debug`.

   `if-no-files-found: error` so a build that produces no bundle fails the job
   rather than silently uploading nothing.

Both OS legs run on every `main` commit, so the "Windows + Linux artifacts on
every main-branch commit" requirement (HC-MVP1-013) is met and the artifacts
are downloadable from the run.

### 3. `e2e-smoke` (ubuntu-latest, Linux only)

Runs the R0 walking-skeleton spec (`tests/e2e/specs/app/shell.e2e.ts`)
headlessly after the build. Linux-only because the WebdriverIO + tauri-driver
harness targets `WebKitWebDriver` under `xvfb` (hc-e2e-testing); macOS/Windows
E2E is handled elsewhere. Steps:

1. Checkout; Node 20; Rust stable; cargo cache.
2. Install the WebKitGTK deps plus `webkit2gtk-driver` (provides
   `WebKitWebDriver`) and `xvfb`.
3. `cargo install tauri-driver --locked`.
4. `npm ci` in `apps/desktop`, then `npm run tauri build -- --debug` (the job
   is self-contained; it does not download the build-matrix artifacts).
5. `npm ci` in `tests/e2e`.
6. Run the spec:
   ```bash
   HC_NATIVE_DRIVER="$(command -v WebKitWebDriver)" \
   HC_APP_BINARY="$GITHUB_WORKSPACE/target/debug/homeoclinic-desktop" \
   HC_DATA_DIR="$(mktemp -d)" \
   xvfb-run -a npx wdio run wdio.conf.ts
   ```
   `wdio.conf.ts` already defaults to the workspace-root binary and
   `WebKitWebDriver` on `PATH`; the env vars are passed for robustness
   (absolute native-driver path, explicit binary, writable data dir).
7. Upload the JUnit/E2E report as an artifact (`always()`).

## Pinned action versions (R-SEC-008)

| Action | Pinned to | Purpose |
|---|---|---|
| `actions/checkout` | `v4` | Clone the repo |
| `actions/setup-node` | `v4` | Node 20 + npm cache |
| `dtolnay/rust-toolchain` | `stable` | Rust stable + components |
| `Swatinem/rust-cache` | `v2` | Cache `~/.cargo` and `target/` |
| `actions/upload-artifact` | `v4` | Publish built installers / E2E report |

For maximum supply-chain strength you may pin each action to a full commit
SHA; tags are the minimum this project requires (R-SEC-008). `cargo audit` and
`tauri-driver` are installed with `cargo install ... --locked`.

## Secrets and signing (out of scope here)

- **No secrets** are referenced in `ci.yml` (R-SEC-005). It builds unsigned
  debug artifacts only.
- **Signing** (Authenticode EV on Windows, GPG on Linux; NFR-025, TAM-006) and
  the release scan (TAM-012) live in the release pipeline owned by
  `hc-release-gate`, which uses an HSM/KMS-held key and never puts key material
  in the repo or in Actions logs.
- The app itself still makes **no network calls** (product rule 1); CI fetching
  crates and npm packages is a build-host activity and does not change the app.

## Running the same checks locally

Everything CI runs is in `docs/dev/environment.md` section 4. From the repo
root (Node 20):

```bash
# Rust lint + test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit

# JS/TS (in apps/desktop)
npm --prefix apps/desktop ci
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run lint
npm --prefix apps/desktop run format -- --check
npm --prefix apps/desktop run test -- --run
npm --prefix apps/desktop audit --omit=dev --audit-level=high

# Debug app build (bundle lands in workspace-root target/debug/bundle/)
npm --prefix apps/desktop run tauri build -- --debug
```

A green local build on both OS is the same bar CI enforces.
