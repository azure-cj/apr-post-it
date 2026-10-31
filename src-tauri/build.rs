fn main() {
    // Naming the app's own commands puts them under the capability files, like a
    // plugin's: one that capabilities/default.json does not grant cannot be called.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["save_photos", "read_key", "write_key"]),
    ))
    .expect("the Tauri build script failed");
}
