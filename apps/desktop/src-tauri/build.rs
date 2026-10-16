//! Tauri build script: generates context and capability metadata at compile
//! time from `tauri.conf.json` and `capabilities/*.json`.

fn main() {
    tauri_build::build();
}
