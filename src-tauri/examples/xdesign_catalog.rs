use serde_json::json;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("Specify the inventory output path")?;
    let commands: Vec<_> = photocraft_engine::command_specs().iter().map(|c| json!({
        "id":c.id, "label":c.label, "menu":c.menu, "shortcut":c.shortcut,
        "params":c.params, "integration":"pending", "verification":"not-run"
    })).collect();
    let inventory = json!({"revision":"47f9306fd06d5dee11acb84b108606f4c867222a", "engineVersion":"0.3.0", "commands":commands});
    std::fs::write(path, format!("{}\n", serde_json::to_string_pretty(&inventory)?))?;
    println!("Captured {} PhotoCraft command definitions", commands.len());
    Ok(())
}
