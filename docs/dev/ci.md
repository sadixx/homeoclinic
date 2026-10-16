# Continuous integration (GitHub Actions)

This describes the CI workflow at `.github/workflows/ci.yml`: a single
coherent pipeline that lints, tests and builds debug HomeoClinic artifacts
for **Linux and Windows on every `main`-branch commit** and on every pull
request targeting `main`.

> Status note (pre-M0). The repository is pre-M0: no root `Cargo.toml`, no
> crate `Cargo.toml`, no Tauri project (see `README.md` "Status"). The
> workflow is written so it is **correct once the M0 workspace exists**
> (HC-MVP1-008..011). The steps that need that workspace are **guarded by a
> `workspace-ready` check** (a repo variable) and documented as such, so the
> file records intent today and starts doing real work the moment M0 lands —
> without ever silently passing a build it did not run. CI's own M0 task is
> HC-MVP1-013 (ops), which supersedes the starter file here with the full
> artifact-publishing gate.

## Why this exists (requirements)

| Requirement | How CI satisfies it |
|---|---|
| **R-DEL-001** main is always releasable | Every push to `main` runs the full lint+test gate and builds Windows and Linux artifacts; a red pipeline means main is not releasable. |
| requirements/05 section 6: "Build artifacts for Windows and Linux on every main-branch commit" | The `build` job runs a matrix over `ubuntu-latest` and `windows-latest` and uploads both artifacts. |
| **NFR-040** Windows 10/11 x64 | Windows artifacts built on `windows-latest` (MSVC), per-user installers, WebView2 (see environment guide). |
| **NFR-041** Linux x64 (AppImage + .deb), WebKitGTK 4.1 | Ubuntu job installs the WebKitGTK 4.1 system deps and builds the Linux bundle. |
| requirements/05 section 6: lint gate | `cargo fmt --check`, `clippy -D warnings`, ESLint, Prettier, `tsc` strict (R-LINT-001..005). |
| **NFR-024 / R-SEC-008** pinned + audited deps | Lockfiles committed; `cargo audit` + `npm audit` run (job present; see note). |
| **R-SEC-008** pinned action versions | Every `uses:` is pinned to a released major/version tag. |
| **R-SEC-005** no secrets in the workflow | No `secrets.*` references; signing keys are the release pipeline's job, not this one. |

## Jobs

### 1. `lint-and-test` (ubuntu-latest)

Runs the quality gates once on Linux (they are OS-independent):

1. Checkout.
2. Install Node 20 (`actions/setup-node`) with npm cache.
3. Install Rust stable + `clippy`, `rustfmt`.
4. Restore the cargo build cache (`Swatinem/rust-cache`).
5. Install the Ubuntu system deps (WebKitGTK 4.1 etc.) — needed because
   `cargo check`/`clippy` on the Tauri crate links against WebKitGTK.
6. **(workspace-ready)** `cargo fmt --all -- --check`,
   `cargo clippy --workspace --all-targets -- -D warnings`,
   `cargo test --workspace`.
7. **(workspace-ready)** `npm ci`, `npm run typecheck`, `npm run lint`,
   `npm run format -- --check` (Prettier, R-LINT-004),
   `npm run test -- --run` in `apps/desktop`.
8. **(workspace-ready)** `cargo audit` and `npm audit --omit=dev`
   (NFR-024).

### 2. `build` (matrix: ubuntu-latest, windows-latest)

Builds the **debug** Tauri artifacts and uploads them. Debug (not release)
because release hardening and signing belong to `hc-release-gate`
(TAM-002/006). Steps:

1. Checkout.
2. Node 20, Rust stable, `Swatinem/rust-cache`.
3. **Ubuntu only:** install the WebKitGTK 4.1 system deps.
4. **(workspace-ready)** `npm ci` in `apps/desktop`.
5. **(workspace-ready)** `npm --prefix apps/desktop run tauri build -- --debug`.
6. Upload artifacts with `actions/upload-artifact`:
   - Linux: the `.AppImage` and `.deb` under the Tauri `bundle/` dir.
   - Windows: the NSIS `-setup.exe` and `.msi` under the Tauri `bundle/` dir.

Both OS legs run on every `main` commit, so the "Windows + Linux artifacts on
every main-branch commit" requirement is met once the workspace exists.

## Pinned action versions (R-SEC-008)

| Action | Pinned to | Purpose |
|---|---|---|
| `actions/checkout` | `v4` | Clone the repo |
| `actions/setup-node` | `v4` | Node 20 + npm cache |
| `dtolnay/rust-toolchain` | `stable` | Rust stable + components (released, tag-pinned) |
| `Swatinem/rust-cache` | `v2` | Cache `~/.cargo` and `target/` |
| `actions/upload-artifact` | `v4` | Publish built installers |

For maximum supply-chain strength you may pin each action to a full commit
SHA instead of a tag; tags are the minimum this project requires (R-SEC-008).
`cargo audit` is installed via `cargo install` pinned implicitly to the
registry; M0 (HC-MVP1-015) may switch to a pinned prebuilt action.

## The `workspace-ready` guard

Until M0 lands there is no `Cargo.toml` to build. Each step that needs the
workspace is gated on a repository variable so the pipeline is honest:

```yaml
if: vars.WORKSPACE_READY == 'true'
```

- **Pre-M0 (default):** `WORKSPACE_READY` is unset, so the build/lint/test
  steps are skipped (shown as skipped, never as a false green). The workflow
  still validates as correct YAML and the matrix/structure is exercised.
- **From M0:** the M0 task (HC-MVP1-008..013) sets the repo variable
  `WORKSPACE_READY=true` (Settings > Secrets and variables > Actions >
  Variables — a non-secret variable, so R-SEC-005 holds), and every gate
  starts running for real. HC-MVP1-013 then replaces this starter with the
  full pipeline (release matrix, artifact retention policy, perf gates).

This keeps a single coherent pipeline file from day one instead of a stub
that is thrown away.

## Secrets and signing (out of scope here)

- **No secrets** are referenced in `ci.yml` (R-SEC-005). It builds unsigned
  debug artifacts only.
- **Signing** (Authenticode EV on Windows, GPG on Linux; NFR-025, TAM-006)
  and the release scan (TAM-012) live in the release pipeline owned by
  `hc-release-gate` (HC-MVP1-185/187), which uses an HSM/KMS-held key and
  never puts key material in the repo or in Actions logs.
- The app itself still makes **no network calls** (product rule 1); CI
  fetching crates and npm packages is a build-host activity and does not
  change the app.

## Running the same checks locally

Everything CI runs is in `docs/dev/environment.md` section 4. A green local
`npm --prefix apps/desktop run tauri build -- --debug` on both OS is the same
bar CI enforces.
