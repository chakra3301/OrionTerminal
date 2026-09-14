use serde_json::Value;
use std::collections::HashSet;

pub const ENV_KEY: &str = "ORION_TOOL_GRANTS";

#[derive(Debug)]
pub struct Scope {
    all: bool,
    names: HashSet<String>,
}

pub fn normalized(tools: Option<&[String]>) -> Result<Option<Vec<String>>, String> {
    let Some(tools) = tools else { return Ok(None) };
    if tools.len() > 256 {
        return Err("Too many tool grants".into());
    }
    let mut out = Vec::new();
    for tool in tools {
        let tool = tool.trim();
        if tool.is_empty() {
            continue;
        }
        if tool.len() > 200
            || !tool
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            || !(matches!(
                tool,
                "Read" | "Edit" | "Write" | "Grep" | "Glob" | "Bash" | "WebSearch" | "WebFetch"
            ) || tool.starts_with("orion_")
                || tool.starts_with("mcp__"))
        {
            return Err("Unsupported tool grant".into());
        }
        if !out.iter().any(|item| item == tool) {
            out.push(tool.to_string());
        }
    }
    Ok(Some(out))
}

pub fn orion_only(tools: Option<&[String]>) -> Result<(), String> {
    if tools.is_some_and(|ts| {
        ts.iter()
            .any(|t| t.starts_with("mcp__") && t != "mcp__orion" && !t.starts_with("mcp__orion__"))
    }) {
        return Err(
            "This connector supports Orion MCP only, not the selected external MCP server.".into(),
        );
    }
    Ok(())
}

impl Scope {
    pub fn from_json(raw: Option<&str>) -> Result<Self, String> {
        let tools: Option<Vec<String>> = match raw {
            None => None,
            Some(raw) if raw.len() <= 65536 => {
                serde_json::from_str(raw).map_err(|_| "Invalid MCP grant policy")?
            }
            Some(_) => return Err("MCP grant policy is too large".into()),
        };
        let tools = normalized(tools.as_deref())?;
        let all = tools
            .as_ref()
            .is_none_or(|ts| ts.iter().any(|t| t == "mcp__orion"));
        let mut names = HashSet::new();
        for tool in tools.unwrap_or_default() {
            let name = match tool.as_str() {
                "Read" => "orion_read_file",
                "Edit" => "orion_apply_edit",
                "Write" => "orion_write_file",
                "Grep" | "Glob" => "orion_search_files",
                t if t.starts_with("mcp__orion__") => &t["mcp__orion__".len()..],
                t if t.starts_with("orion_") => t,
                _ => continue,
            };
            names.insert(name.to_string());
        }
        Ok(Self { all, names })
    }

    pub fn permits(&self, name: &str) -> bool {
        self.all || self.names.contains(name)
    }
}

fn current_scope() -> Result<Scope, String> {
    match std::env::var(ENV_KEY) {
        Ok(raw) => Scope::from_json(Some(&raw)),
        Err(std::env::VarError::NotPresent) => Scope::from_json(None),
        Err(_) => Err("Invalid MCP grant policy".into()),
    }
}

pub fn permits(name: &str) -> bool {
    current_scope().is_ok_and(|scope| scope.permits(name))
}

pub fn filter(definitions: Value) -> Value {
    let Ok(scope) = current_scope() else {
        return Value::Array(vec![]);
    };
    Value::Array(
        definitions
            .as_array()
            .into_iter()
            .flatten()
            .filter(|tool| {
                tool["name"]
                    .as_str()
                    .is_some_and(|name| scope.permits(name))
            })
            .cloned()
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_and_malformed_never_become_unrestricted() {
        assert!(!Scope::from_json(Some("[]"))
            .unwrap()
            .permits("orion_create_note"));
        assert!(Scope::from_json(Some("bad")).is_err());
        assert!(Scope::from_json(Some(r#"["--dangerously-skip-permissions"]"#)).is_err());
        assert!(Scope::from_json(None).unwrap().permits("orion_create_note"));
    }
    #[test]
    fn exact_grants_and_builtin_aliases_do_not_expand_to_other_tools() {
        let scope =
            Scope::from_json(Some(r#"["Read","Edit","mcp__orion__orion_fx_get_scene"]"#)).unwrap();
        assert!(scope.permits("orion_read_file"));
        assert!(scope.permits("orion_apply_edit"));
        assert!(scope.permits("orion_fx_get_scene"));
        assert!(!scope.permits("orion_create_note"));
        assert!(!scope.permits("orion_write_file"));
        assert!(!scope.permits("orion_fx_get_scene_extra"));
    }
    #[test]
    fn full_server_grants_are_explicit_and_other_servers_are_not_broadened() {
        assert!(Scope::from_json(Some(r#"["mcp__orion"]"#))
            .unwrap()
            .permits("orion_create_note"));
        let other = vec!["mcp__other".to_string()];
        assert!(orion_only(Some(&other)).is_err());
        assert!(!Scope::from_json(Some(r#"["mcp__other"]"#))
            .unwrap()
            .permits("orion_create_note"));
    }
}
