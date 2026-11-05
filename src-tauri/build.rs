fn main() {
    // `ORION_APP_TARGET=archives` builds the standalone Archives 47 app
    // (src/archives_app.rs) from this crate instead of Orion Terminal. A cfg
    // rather than a Cargo feature keeps Cargo.toml (hashed by the license
    // inventory) unchanged.
    println!("cargo:rustc-check-cfg=cfg(archives_app)");
    println!("cargo:rerun-if-env-changed=ORION_APP_TARGET");
    if std::env::var("ORION_APP_TARGET").as_deref() == Ok("archives") {
        println!("cargo:rustc-cfg=archives_app");
    }
    tauri_build::build()
}
