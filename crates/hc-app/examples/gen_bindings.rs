//! Regenerate the tracked UI command bindings from the single `hc-app` command
//! collection (R-ARCH-004). Run from the repo root:
//!
//! ```text
//! cargo run -p hc-app --example gen_bindings
//! ```
//!
//! Writes `apps/desktop/src/bindings.ts` from [`hc_app::specta_builder`], the
//! same collection the Tauri shell mounts and the `export_bindings` drift test
//! asserts on — so the tracked file stays the one source of truth for the UI.
//! This is build tooling (an example), not a unit test: the drift test only
//! asserts on an in-memory export to a temp file and never touches the tracked
//! file, keeping parallel `cargo test` race-free.

use std::path::PathBuf;

fn main() {
    // The example runs with CWD = repo root (cargo sets it to the workspace
    // root for `cargo run`). Resolve the tracked bindings path relative to it.
    let out = PathBuf::from("apps/desktop/src/bindings.ts");

    hc_app::specta_builder()
        .export(specta_typescript::Typescript::default(), &out)
        .expect("failed to export bindings.ts");

    println!("wrote {}", out.display());
}
