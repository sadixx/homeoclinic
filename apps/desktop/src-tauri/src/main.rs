#![forbid(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Desktop binary entry point. Delegates to the library `run()` so the shell
//! wiring is shared with integration/build tooling.

fn main() {
    homeoclinic_desktop_lib::run();
}
