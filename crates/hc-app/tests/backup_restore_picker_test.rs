//! b23-n1-d1: S17 restore "Choose backup file (.hcbak)…" regression tests for
//! the typed `backup_pick_restore_file` command (BAK-003).
//!
//! Real bug (restore E2E, b23-n1): the S17 Step 1 chooser was an R1
//! placeholder that took the FIRST removable drive's FOLDER from
//! `list_removable_drives`, so `restore_preview` was handed a directory and
//! failed — a doctor could not restore through the UI at all. The fix is a
//! real typed `.hcbak` file picker that mirrors `visit_pick_report_file`.
//!
//! Why these tests are STRUCTURAL (same reasoning as
//! `attachment_picker_rwv5_test.rs`): the command takes a concrete
//! `tauri::AppHandle` (Wry) and its only side effect is a native GTK dialog,
//! neither of which can be built or driven in `cargo test`; the native dialog
//! is exercised by the E2E real-picker smoke. What a unit test CAN pin is the
//! set of properties that make the picker safe: it runs off the GTK main
//! thread (async), it never calls a `blocking_*` dialog API (M3-RWv5
//! deadlock), it filters to `.hcbak`, its E2E seam is gated on
//! `e2e-test-keys` and short-circuits BEFORE any dialog, it never logs the
//! chosen path (R-PRIV-001), and it is registered + exported to the UI
//! bindings. The CUT is the real source of `crates/hc-app/src/commands/
//! backup.rs` / `lib.rs` and the real `specta_builder()` export. Nothing is
//! faked.

use std::fs;
use std::path::PathBuf;

/// The crate root (`crates/hc-app`).
fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Read a source file relative to the crate root.
fn read_src(rel: &str) -> String {
    let p = crate_root().join(rel);
    fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

/// One `#[tauri::command]` function: the attribute block + signature up to
/// `fn <name>` (`head`) and the body to the closing top-level `}` (`body`).
struct CommandFn {
    name: String,
    head: String,
    body: String,
}

/// Line-based split of a rustfmt-formatted source into its
/// `#[tauri::command...]` functions (same scan as attachment_picker_rwv5_test).
fn command_fns(src: &str) -> Vec<CommandFn> {
    let lines: Vec<&str> = src.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].trim_start().starts_with("#[tauri::command") {
            let start = i;
            let mut j = i;
            while j < lines.len() && !lines[j].contains("fn ") {
                j += 1;
            }
            if j >= lines.len() {
                break;
            }
            let name = lines[j]
                .split("fn ")
                .nth(1)
                .unwrap_or("")
                .split(|c: char| c == '(' || c == '<' || c.is_whitespace())
                .next()
                .unwrap_or("")
                .to_string();
            let head = lines[start..=j].join("\n");
            let mut k = j;
            while k < lines.len() && lines[k] != "}" {
                k += 1;
            }
            let end = k.min(lines.len() - 1);
            let body = lines[j..=end].join("\n");
            out.push(CommandFn { name, head, body });
            i = end + 1;
        } else {
            i += 1;
        }
    }
    out
}

/// The real `backup_pick_restore_file` item from commands/backup.rs.
fn pick_cmd() -> CommandFn {
    command_fns(&read_src("src/commands/backup.rs"))
        .into_iter()
        .find(|f| f.name == "backup_pick_restore_file")
        .expect("backup_pick_restore_file must be a #[tauri::command] in commands/backup.rs")
}

/// A sync command runs inline on the GTK main thread; any dialog wait there
/// deadlocks the event loop (M3-RWv5). The restore picker must be async.
#[test]
fn bak003_restore_picker_runs_off_the_main_thread() {
    let f = pick_cmd();
    assert!(
        f.head.contains("pub async fn ") || f.head.contains("#[tauri::command(async)]"),
        "backup_pick_restore_file must be an async command; found:\n{}",
        f.head
    );
}

/// `blocking_pick_file()` deadlocked the GTK main loop before. The picker must
/// use the non-blocking `pick_file(callback)` bridged through a oneshot that
/// is awaited.
#[test]
fn bak003_restore_picker_uses_non_blocking_pick_file_and_a_oneshot() {
    let f = pick_cmd();
    assert!(
        !f.body.contains("blocking_pick_file"),
        "backup_pick_restore_file must not call blocking_pick_file() (M3-RWv5 deadlock)"
    );
    assert!(
        f.body.contains(".pick_file("),
        "backup_pick_restore_file must open the picker via the non-blocking pick_file(callback)"
    );
    assert!(
        f.body.contains("oneshot::channel()") && f.body.contains("rx.await"),
        "the pick_file callback must be bridged through an awaited tokio oneshot"
    );
}

/// The real bug: a FOLDER reached restore_preview. The native dialog must be
/// a FILE picker filtered to the `.hcbak` archive extension.
#[test]
fn bak003_restore_picker_filters_to_hcbak_files() {
    let f = pick_cmd();
    assert!(
        f.body.contains(".add_filter(") && f.body.contains("&[\"hcbak\"]"),
        "backup_pick_restore_file must filter the dialog to the .hcbak extension"
    );
    assert!(
        !f.body.contains("pick_folder"),
        "backup_pick_restore_file must pick a FILE, never a folder (b23-n1-d1)"
    );
}

/// The headless E2E needs a deterministic seam: gated on `e2e-test-keys`
/// (compiled out of release), read `HC_E2E_RESTORE_FILE`, return it only when
/// it exists, and all of it BEFORE the native dialog is opened.
#[test]
fn bak003_restore_picker_e2e_seam_is_gated_and_runs_before_any_dialog() {
    let f = pick_cmd();
    let body = &f.body;
    let gate = body
        .find("#[cfg(feature = \"e2e-test-keys\")]")
        .expect("the HC_E2E_RESTORE_FILE seam must be gated on feature e2e-test-keys");
    let env = body
        .find("var_os(\"HC_E2E_RESTORE_FILE\")")
        .expect("the seam must read HC_E2E_RESTORE_FILE");
    let exists = body[env..]
        .find(".exists()")
        .map(|o| o + env)
        .expect("the seam must only short-circuit when the env path exists");
    let ret = body[env..]
        .find("source_path: Some(")
        .map(|o| o + env)
        .expect("the seam must return the env path as source_path: Some(..)");
    let dialog = body
        .find(".dialog()")
        .expect("the real native picker path must exist");
    assert!(
        gate < env && env < exists && exists < ret && ret < dialog,
        "the e2e seam (cfg gate -> env read -> exists check -> return) must run \
         BEFORE the native dialog is opened"
    );
}

/// R-PRIV-001: the chosen path may name a patient/clinic folder; it must never
/// be written to app.log.
#[test]
fn bak003_restore_picker_never_logs_the_path() {
    let f = pick_cmd();
    for needle in [
        "tracing::",
        "info!(",
        "debug!(",
        "warn!(",
        "error!(",
        "trace!(",
        "println!",
        "eprintln!",
        "dbg!(",
    ] {
        assert!(
            !f.body.contains(needle),
            "backup_pick_restore_file must not log anything (found `{needle}`, R-PRIV-001)"
        );
    }
}

/// The command must be registered in BOTH command collections (release and
/// e2e) so the shipped app can call it, not just the E2E build.
#[test]
fn bak003_restore_picker_is_registered_in_both_command_collections() {
    let lib = read_src("src/lib.rs");
    let n = lib
        .matches("commands::backup::backup_pick_restore_file")
        .count();
    assert_eq!(
        n, 2,
        "backup_pick_restore_file must be registered in both the release and the \
         e2e collect_commands! lists (found {n})"
    );
}

/// The UI calls only generated bindings (R-UI-002): the real export must
/// carry the wrapper and the typed `{ sourcePath: string | null }` response.
#[test]
fn bak003_restore_picker_is_exported_to_the_ui_bindings() {
    let dir = tempfile::tempdir().expect("temp dir");
    let out = dir.path().join("bindings.ts");
    hc_app::specta_builder()
        .export(specta_typescript::Typescript::default(), &out)
        .expect("export bindings");
    let ts = fs::read_to_string(&out).expect("read exported bindings");
    assert!(
        ts.contains("backupPickRestoreFile: ()")
            && ts.contains("__TAURI_INVOKE(\"backup_pick_restore_file\")"),
        "bindings must expose commands.backupPickRestoreFile() -> backup_pick_restore_file"
    );
    let ty = ts
        .find("export type PickRestoreFileResponse")
        .expect("bindings must export the PickRestoreFileResponse type");
    let tail = &ts[ty..];
    let end = tail.find('}').unwrap_or(tail.len());
    assert!(
        tail[..end].contains("sourcePath: string | null"),
        "PickRestoreFileResponse must be {{ sourcePath: string | null }}; got:\n{}",
        &tail[..end]
    );
}
