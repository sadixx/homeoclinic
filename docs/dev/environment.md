# Development environment (Ubuntu 24.04 and Windows 10/11)

This guide sets up a workstation that can build HomeoClinic desktop
artifacts for Linux and Windows. It targets the stack in
`docs/CODE-LAYOUT.md` and `docs/design/02-architecture-overview.md`:
React 18 + TypeScript + Vite inside a Tauri 2 webview, a Rust cargo
workspace of `hc-*` crates, and SQLite + SQLCipher storage.

> Status note (pre-M0). The repository is at the pre-M0 scaffold: there is
> no root `Cargo.toml`, no crate `Cargo.toml`, and no Tauri project yet
> (see `README.md` "Status" and `docs/task-tracker` tasks HC-MVP1-008..011).
> Toolchain installation in sections 1-3 works today. The **build, test and
> lint commands in section 4 cannot run until the M0 workspace exists**
> (HC-MVP1-008 monorepo, HC-MVP1-009 Tauri shell, HC-MVP1-010 Rust
> workspace, HC-MVP1-011 typed commands). Each such step is marked
> **(needs M0)**. The commands are the ones that will work once M0 lands;
> script names are finalised in M0 (HC-MVP1-009/014) and this guide is
> updated then if they differ.

MVP1 is offline by product rule 1: the **application** makes no network
calls of its own. That rule constrains the app, not your toolchain — the
build fetches crates and npm packages normally.

---

## 1. Shared toolchain (both OS)

### Node.js 20 via nvm

The project pins Node 20 (the current active LTS line). Use
[nvm](https://github.com/nvm-sh/nvm) so you can keep other Node versions.

Linux / macOS / WSL:

```bash
# install nvm (see the nvm README for the current installer line)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart the shell, then:
nvm install 20
nvm use 20            # switch the current shell to Node 20
nvm alias default 20  # make Node 20 the default for new shells
node -v               # expect v20.x
npm -v
```

If an already-open shell still reports an older Node, run `nvm use 20` in
that shell. (A clean login shell resolves to the default alias.)

Windows: use [nvm-windows](https://github.com/coreybutler/nvm-windows):

```powershell
nvm install 20.20.2
nvm use 20.20.2
node -v
```

### Rust stable toolchain via rustup

```bash
# Linux: install rustup (see https://rustup.rs for the current line)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# restart the shell, then:
rustup toolchain install stable
rustup default stable
rustup component add clippy rustfmt
rustc --version   # stable, 1.80+ recommended
cargo --version
```

On Windows, download `rustup-init.exe` from <https://rustup.rs> and choose
the **MSVC** toolchain (`x86_64-pc-windows-msvc`) — see section 3.

---

## 2. Ubuntu 24.04 setup

### 2.1 System dependencies for Tauri 2

Tauri 2 on Linux builds against WebKitGTK 4.1 and GTK. SQLCipher is reached
through `libsqlite3-sys`/`rusqlite`, which needs OpenSSL headers unless the
`bundled-sqlcipher` cargo feature is used (see 2.2). Install:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

What each package is for:

| Package | Why |
|---|---|
| `libwebkit2gtk-4.1-dev` | Tauri 2 webview on Linux (the `webkit2gtk-4.1 not found` build error means this is missing — see `hc-build` error table) |
| `build-essential` | C/C++ toolchain for native crates (SQLCipher, etc.) |
| `curl`, `wget`, `file` | Used by the Tauri bundler and toolchain installers |
| `libxdo-dev` | Input simulation used by the Tauri/webdriver stack |
| `libssl-dev` | OpenSSL headers for `libsqlite3-sys`/SQLCipher and TLS crates (the `failed to run custom build command for libsqlite3-sys / sqlcipher` error means OpenSSL/SQLCipher is missing) |
| `libayatana-appindicator3-dev` | System tray / app indicator support |
| `librsvg2-dev` | SVG rendering for icons during bundling |

### 2.2 SQLCipher: system OpenSSL vs bundled feature

Per the `hc-build` error table, a `libsqlite3-sys` / `sqlcipher` build
failure is usually a missing system OpenSSL/SQLCipher, or the wrong cargo
feature. Two supported paths:

- **System OpenSSL (above):** `libssl-dev` provides the headers; this is the
  default and the lightest install.
- **Bundled SQLCipher (alternative):** enable the storage crate's
  `bundled-sqlcipher` cargo feature so SQLCipher is compiled from source and
  statically linked. This removes the system OpenSSL/SQLCipher dependency at
  the cost of a longer first build. The feature is finalised in M1
  (`crates/hc-storage`, HC-MVP1-020); on Linux CI we use the system OpenSSL
  path, and Windows uses bundled by default (see section 3). **(needs M1 for
  the exact feature wiring.)**

### 2.3 Verify the Linux toolchain

```bash
node -v && npm -v && rustc --version && cargo --version
pkg-config --modversion webkit2gtk-4.1   # prints the installed WebKitGTK version
```

---

## 3. Windows 10/11 (x64) setup

Target: Windows 10 21H2+ and Windows 11, x64 (NFR-040). All installs are
**per-user, no administrator rights** (SUX-010 / NFR-040 per-user install).

### 3.1 WebView2 runtime (offline bundled installer)

Tauri 2 on Windows renders through the Microsoft Edge **WebView2** runtime.
Windows 11 ships it; Windows 10 may not. Per NFR-040 and design/02 section 5,
the HomeoClinic installer **bundles the WebView2 offline (Evergreen
Standalone) bootstrapper** so clinic PCs without internet still get the
runtime. For a dev box:

- Install the **Evergreen Standalone Installer** (per-user) from Microsoft's
  WebView2 download page if WebView2 is not already present.
- Verify: WebView2 appears under *Settings > Apps* as
  "Microsoft Edge WebView2 Runtime".

The build does **not** require internet for WebView2 if the offline installer
is used; the shipped HomeoClinic installer wires this in at M10
(HC-MVP1-196). **(needs M10 for the installer-side bundling.)**

### 3.2 MSVC C++ build tools

Rust's MSVC toolchain needs the Microsoft C++ build tools. Install either:

- **Visual Studio 2022** (Community is fine) with the
  *Desktop development with C++* workload, **or**
- **Build Tools for Visual Studio 2022** (standalone) with the
  *C++ build tools* workload and the Windows 10/11 SDK.

Per-user install options are available in the Visual Studio Installer.

### 3.3 Rust MSVC toolchain

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustup component add clippy rustfmt
rustc --version
```

On Windows the storage crate uses the **bundled SQLCipher** cargo feature by
default so no separate OpenSSL/SQLCipher install is needed (finalised in M1,
HC-MVP1-020). **(needs M1 for the exact feature wiring.)**

### 3.4 Node 20

Install via nvm-windows (section 1) and run `nvm use 20.20.2`.

### 3.5 Verify the Windows toolchain

```powershell
node -v; npm -v; rustc --version; cargo --version
```

---

## 4. Build, test and lint commands (needs M0)

Run everything from `$HC_REPO` (the repo root). These are the commands from
the `hc-build` skill; do not invent other script names. On Windows use the
same commands in PowerShell. **All commands in this section require the M0
workspace (HC-MVP1-008..011) and will fail on the pre-M0 scaffold.**

### 4.1 Install JS dependencies

```bash
npm ci --prefix apps/desktop
```

### 4.2 Rust: check, test, lint, format

```bash
cargo check --workspace --all-targets
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings   # R-LINT-001
cargo fmt --all -- --check                               # R-LINT-002
```

### 4.3 TypeScript / UI: typecheck, lint, unit tests

```bash
npm --prefix apps/desktop run typecheck          # tsc --noEmit, strict (R-LINT-005)
npm --prefix apps/desktop run lint               # ESLint (R-LINT-003)
npm --prefix apps/desktop run format             # Prettier, leaves no diff (R-LINT-004)
npm --prefix apps/desktop run test -- --run      # UI unit tests
```

> `npm --prefix apps/desktop run format` is the canonical Prettier gate from
> `docs/rules/lint-policy.md` (R-LINT-004): it must leave no diff. CI runs the
> same check (in check mode); the exact script wiring is finalised in M0.

### 4.4 Dependency audit

```bash
cargo audit                                      # R-SEC-008 / NFR-024
npm --prefix apps/desktop audit --omit=dev
```

### 4.5 Build the desktop app

```bash
# debug build (fast; what CI builds on every commit)
npm --prefix apps/desktop run tauri build -- --debug

# release bundle (release-gate only; hardened — see hc-release-gate)
npm --prefix apps/desktop run tauri build
```

> Script names (`tauri`, `typecheck`, `lint`, `test`) are finalised in M0
> (HC-MVP1-009/014). If `apps/desktop/package.json` differs once it exists,
> read it and use the real names.

---

## 5. Output artifact locations (needs M0)

The Tauri bundler writes installers under the Rust target directory. Per
design/02 section 5 and `docs/CODE-LAYOUT.md`, MVP1 ships:

| OS | Artifacts | Typical path under `apps/desktop/src-tauri/target/` |
|---|---|---|
| Linux x64 | **AppImage** and **`.deb`** | `release/bundle/appimage/*.AppImage`, `release/bundle/deb/*.deb` (debug builds under `debug/bundle/...`) |
| Windows x64 | **NSIS `.exe`** and **`.msi`** | `release\bundle\nsis\*-setup.exe`, `release\bundle\msi\*.msi` (debug builds under `debug\bundle\...`) |

Notes:
- Linux `.deb` targets Ubuntu 20.04+/Debian 11+ with the WebKitGTK 4.1
  dependency declared (NFR-041).
- Windows installers are per-user and bundle the offline WebView2
  bootstrapper (NFR-040); full installer configuration is M10
  (HC-MVP1-196/197). **(needs M10 for final bundle identifiers and paths.)**
- Code signing (Authenticode EV on Windows, GPG on Linux) is **out of scope
  for this guide and for CI here** — it is the release pipeline /
  `hc-release-gate` (TAM-006, NFR-025, HC-MVP1-185). No signing keys live in
  the dev environment or in `.github/workflows/ci.yml`.

---

## 6. End-to-end test prerequisites (brief; for later use)

Full E2E setup lives in the `hc-e2e-testing` skill; this is only the
toolchain so a workstation is ready. The project uses WebdriverIO +
`tauri-driver`.

- **Linux:** install `WebKitWebDriver` (ships with WebKitGTK) and
  `tauri-driver` (`cargo install tauri-driver`); run headless with
  `xvfb-run`:

  ```bash
  sudo apt-get install -y webkit2gtk-driver xvfb
  cargo install tauri-driver
  # headless run example (full harness is in hc-e2e-testing):
  xvfb-run -a <e2e runner command>
  ```

- **Windows:** E2E uses the **Edge WebView2 driver** (`msedgedriver`) matched
  to the installed WebView2 runtime version, driven through `tauri-driver`.

E2E specs live in `tests/e2e/` (owned by `hc-e2e-editor`); they run against a
built debug app, so section 4.5 must succeed first. **(needs M0.)**

---

## 7. Quick checklist for a new developer

1. Install Node 20 (nvm), Rust stable (rustup), and the OS build tools
   (sections 1-3).
2. Linux: install the apt packages in 2.1. Windows: WebView2 + MSVC C++ +
   Rust MSVC (section 3).
3. Clone the repo and `cd` to `$HC_REPO`.
4. Once M0 has landed: run section 4 top to bottom; a green
   `npm --prefix apps/desktop run tauri build -- --debug` produces the
   artifacts in section 5.
5. CI runs the same commands on `ubuntu-latest` and `windows-latest` — see
   `docs/dev/ci.md`.
