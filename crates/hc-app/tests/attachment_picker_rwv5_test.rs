//! M3-RWv5 (B): Browse/Upload report "crash" regression tests for
//! `visit_pick_report_file` (PAT-009).
//!
//! Diagnosis (.worklog/HC-MVP1-M3/handoffs/M3-RWv5-crash-diagnosis.md,
//! CONFIRMED by gdb thread dumps): this is a main-thread DEADLOCK. A SYNC
//! `#[tauri::command]` runs inline on the GTK main thread (Tauri 2.12.4
//! `ExecutionContext::Blocking`). There it calls `blocking_pick_file()`, which
//! queues the GTK dialog build on the main loop and then parks in
//! `rx.recv()`. The dialog is never built, the UI freezes, and GNOME offers
//! "Force Quit" after 5 s. GSettings was ruled out, so no env helper is tested
//! here (the diagnosis says not to add one).
//!
//! Why these tests are STRUCTURAL: the command takes a concrete
//! `tauri::AppHandle` (Wry runtime), and its only side effect is a native GTK
//! dialog. Neither can be built or driven in `cargo test`, and the
//! real-picker behaviour is covered by the E2E smoke (hc-e2e-editor). What a
//! unit test CAN pin is the property that prevents the deadlock: the command
//! must run off the main thread (async) and must not call any `blocking_*`
//! dialog API. The e2e seam must also still short-circuit before any dialog.
//! The CUT is the real source of `crates/hc-app/src/commands/attachment.rs`,
//! read at test time. Nothing is faked.
//!
//! No production code is written by this file (hc-unit-tester, leaf role).

use std::fs;
use std::path::{Path, PathBuf};

/// The crate root (`crates/hc-app`).
fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Read the real `attachment.rs` command module source.
fn attachment_src() -> String {
    let p = crate_root().join("src/commands/attachment.rs");
    fs::read_to_string(&p).expect("read crates/hc-app/src/commands/attachment.rs")
}

/// One `#[tauri::command]` function found in a source file: the attribute
/// block plus the signature up to `fn <name>` (`head`), and the body to the
/// closing top-level `}` (`body`).
struct CommandFn {
    name: String,
    head: String,
    body: String,
}

/// Split a Rust source into its `#[tauri::command...]` functions. This is a
/// line-based scan that relies on rustfmt layout: the attribute starts a
/// line, the fn signature follows within the attribute block, and the body
/// ends at the first line that is exactly `}`.
fn command_fns(src: &str) -> Vec<CommandFn> {
    let lines: Vec<&str> = src.lines().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].trim_start().starts_with("#[tauri::command") {
            let start = i;
            // Find the `fn` line of this item.
            let mut j = i;
            while j < lines.len() && !lines[j].contains("fn ") {
                j += 1;
            }
            if j >= lines.len() {
                break;
            }
            let fn_line = lines[j];
            let name = fn_line
                .split("fn ")
                .nth(1)
                .unwrap_or("")
                .split(|c: char| c == '(' || c == '<' || c.is_whitespace())
                .next()
                .unwrap_or("")
                .to_string();
            let head = lines[start..=j].join("\n");
            // Body ends at the first line that is exactly "}" (top level).
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

/// A command runs OFF the GTK main thread when it is an `async fn`, or when
/// it is declared `#[tauri::command(async)]`.
fn runs_off_main_thread(f: &CommandFn) -> bool {
    f.head.contains("async fn ") || f.head.contains("#[tauri::command(async)]")
}

/// The real `visit_pick_report_file` item from attachment.rs.
fn pick_cmd() -> CommandFn {
    command_fns(&attachment_src())
        .into_iter()
        .find(|f| f.name == "visit_pick_report_file")
        .expect("visit_pick_report_file must still be a #[tauri::command] in attachment.rs")
}

/// Real bug: the user's release build froze ("crashed") the moment Browse or
/// Upload report was clicked. A sync command runs inline on the GTK main
/// thread, so any wait in it deadlocks the event loop. The command must run
/// off the main thread (an `async fn`, or `#[tauri::command(async)]`).
#[test]
fn pat009_visit_pick_report_file_runs_off_the_main_thread() {
    let f = pick_cmd();
    assert!(
        runs_off_main_thread(&f),
        "visit_pick_report_file must be an async command (async fn or \
         #[tauri::command(async)]) so it never runs inline on the GTK main \
         thread; found signature:\n{}",
        f.head
    );
}

/// Real bug: `blocking_pick_file()` parks the caller in `rx.recv()` while the
/// dialog build waits for the main loop. The chosen fix is the non-blocking
/// `pick_file(callback)` bridged through a channel and awaited, so no
/// `blocking_*` dialog call may remain in the command.
#[test]
fn pat009_visit_pick_report_file_uses_non_blocking_pick_file() {
    let f = pick_cmd();
    assert!(
        !f.body.contains("blocking_pick_file"),
        "visit_pick_report_file must not call blocking_pick_file() (main-loop \
         deadlock, M3-RWv5 diagnosis)"
    );
    assert!(
        f.body.contains(".pick_file("),
        "visit_pick_report_file must open the picker via the non-blocking \
         FileDialogBuilder::pick_file(callback)"
    );
}

/// Real bug class: any other sync command that calls a `blocking_*`
/// dialog/message API would freeze the app in the same way. Every
/// `#[tauri::command]` in hc-app/src/commands and src-tauri/src that calls a
/// `blocking_` API must be async.
#[test]
fn pat009_no_sync_tauri_command_calls_a_blocking_dialog_api() {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut push_rs = |dir: &Path| {
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) == Some("rs") {
                    files.push(p);
                }
            }
        }
    };
    push_rs(&crate_root().join("src/commands"));
    push_rs(&crate_root().join("../../apps/desktop/src-tauri/src"));
    assert!(
        !files.is_empty(),
        "expected to scan the command source files"
    );

    let mut offenders: Vec<String> = Vec::new();
    for p in &files {
        let src = fs::read_to_string(p).expect("read command source");
        for f in command_fns(&src) {
            if f.body.contains("blocking_") && !runs_off_main_thread(&f) {
                offenders.push(format!(
                    "{}::{}",
                    p.file_name().and_then(|s| s.to_str()).unwrap_or("?"),
                    f.name
                ));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "sync #[tauri::command]s calling a blocking_* API deadlock the GTK main \
         thread: {offenders:?}"
    );
}

/// Real bug: making the command async must not drop the E2E determinism seam.
/// Without it every investigations E2E would hang on an undrivable native
/// dialog. The seam must stay gated on `e2e-test-keys`, read
/// `HC_E2E_REPORT_FILE`, return that path when the file exists, and do all of
/// this BEFORE the native picker is opened. This test PASSES today and is the
/// regression guard for the fix.
#[test]
fn pat009_e2e_seam_still_returns_the_env_path_before_any_dialog() {
    let f = pick_cmd();
    let body = &f.body;
    let gate = body
        .find("#[cfg(feature = \"e2e-test-keys\")]")
        .expect("the HC_E2E_REPORT_FILE seam must stay gated on feature e2e-test-keys");
    let env = body
        .find("var_os(\"HC_E2E_REPORT_FILE\")")
        .expect("the seam must still read HC_E2E_REPORT_FILE");
    let exists = body
        .find(".exists()")
        .expect("the seam must only short-circuit when the env path exists");
    let ret = body[env..]
        .find("source_path: Some(")
        .map(|o| o + env)
        .expect("the seam must return the env path as source_path: Some(..)");
    let dialog = body
        .find(".dialog()")
        .expect("the real native picker path must remain");
    assert!(
        gate < env && env < exists && exists < ret && ret < dialog,
        "the e2e seam (cfg gate -> env read -> exists check -> return) must \
         run BEFORE the native dialog is opened"
    );
}
