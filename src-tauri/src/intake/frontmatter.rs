use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    pub license: Option<String>,
    pub compatibility: Option<String>,
    pub allowed_tools: Option<String>,
    pub metadata: BTreeMap<String, String>,
}

fn scalar_value(raw: &str) -> Result<String, String> {
    let v = raw.trim();
    if v.is_empty() {
        return Err("Empty frontmatter value".into());
    }
    if v.starts_with('"') {
        return serde_json::from_str::<String>(v)
            .map_err(|_| "Unsupported quoted frontmatter string".into());
    }
    if v.starts_with('\'') {
        if !v.ends_with('\'') || v.len() < 2 {
            return Err("Unclosed frontmatter quote".into());
        }
        let inner = &v[1..v.len() - 1];
        if inner.replace("''", "").contains('\'') {
            return Err("Unsupported frontmatter quote".into());
        }
        return Ok(inner.replace("''", "'"));
    }
    if v.starts_with([
        '|', '>', '&', '*', '!', '{', '[', '@', '`', '#', '-', '?', '%',
    ]) || v.contains(": ")
        || v.contains(" #")
        || ["null", "true", "false", "~"].contains(&v)
        || v.parse::<f64>().is_ok()
    {
        return Err("Unsupported YAML syntax; use plain or quoted string fields".into());
    }
    Ok(v.to_string())
}

fn scalar(raw: &str) -> Result<String, String> {
    let value = scalar_value(raw)?;
    if value.len() > 4096 || value.contains('\0') {
        return Err("Frontmatter string exceeds limits or contains NUL".into());
    }
    Ok(value)
}

pub fn parse(bytes: &[u8]) -> Result<SkillMetadata, String> {
    if bytes.len() > 128 * 1024 {
        return Err("SKILL.md exceeds 128 KiB".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "SKILL.md must be UTF-8")?;
    if text.contains('\0') {
        return Err("SKILL.md contains NUL".into());
    }
    let normalized = text.replace("\r\n", "\n");
    let rest = normalized
        .strip_prefix("---\n")
        .ok_or("SKILL.md needs YAML frontmatter")?;
    let end = rest
        .find("\n---\n")
        .ok_or("Missing frontmatter closing delimiter")?;
    if end > 16 * 1024 {
        return Err("Frontmatter exceeds 16 KiB".into());
    }
    if rest[end + 5..].trim().is_empty() {
        return Err("Skill instructions are empty".into());
    }
    let mut fields = BTreeMap::new();
    let mut metadata = BTreeMap::new();
    let mut in_metadata = false;
    let mut seen_metadata = false;
    for line in rest[..end].lines() {
        if line.trim().is_empty() {
            continue;
        }
        let nested = line.starts_with("  ") && !line.starts_with("   ");
        if line.starts_with(char::is_whitespace) && !nested {
            return Err("Unsupported frontmatter indentation".into());
        }
        let (key, value) = line
            .trim_start()
            .split_once(':')
            .ok_or("Expected string frontmatter fields")?;
        if key.is_empty()
            || !key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
            return Err("Unsupported frontmatter key".into());
        }
        if nested {
            if !in_metadata
                || metadata.len() >= 32
                || metadata.insert(key.to_string(), scalar(value)?).is_some()
            {
                return Err("Invalid or duplicate metadata field".into());
            }
        } else {
            in_metadata = key == "metadata";
            if in_metadata {
                if seen_metadata || !value.trim().is_empty() {
                    return Err("Metadata must be a string mapping".into());
                }
                seen_metadata = true;
            } else {
                if ![
                    "name",
                    "description",
                    "license",
                    "compatibility",
                    "allowed-tools",
                ]
                .contains(&key)
                {
                    return Err("Unknown frontmatter field; authority is never imported".into());
                }
                if fields.insert(key.to_string(), scalar(value)?).is_some() {
                    return Err("Duplicate frontmatter field".into());
                }
            }
        }
    }
    let name = fields.remove("name").ok_or("Missing skill name")?;
    if name.is_empty()
        || name.len() > 64
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
        || !name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Invalid skill name".into());
    }
    let description = fields
        .remove("description")
        .ok_or("Missing skill description")?;
    if description.trim().is_empty() || description.chars().count() > 1024 {
        return Err("Description must contain 1–1024 characters".into());
    }
    let compatibility = fields.remove("compatibility");
    if compatibility
        .as_ref()
        .is_some_and(|s| s.is_empty() || s.chars().count() > 500)
    {
        return Err("Compatibility exceeds 500 characters".into());
    }
    Ok(SkillMetadata {
        name,
        description,
        compatibility,
        license: fields.remove("license"),
        allowed_tools: fields.remove("allowed-tools"),
        metadata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn skill(front: &str) -> Vec<u8> {
        format!("---\n{front}\n---\nInstructions").into_bytes()
    }
    #[test]
    fn parses_inert_tool_requests_and_metadata() {
        let p = parse(&skill("name: example\ndescription: 'A skill'\nallowed-tools: Bash Read\nmetadata:\n  author: Leon")).unwrap();
        assert_eq!(p.allowed_tools.as_deref(), Some("Bash Read"));
        assert_eq!(p.metadata["author"], "Leon");
    }
    #[test]
    fn rejects_ambiguous_yaml_and_authority() {
        for extra in [
            "name: other",
            "approved: true",
            "tools: [Bash]",
            "description: |\n  multiline",
            "metadata: &defaults",
            "metadata:\n  a: one\n  a: two",
            "compatibility: *alias",
            "compatibility: !!str yes",
            "compatibility: bad: value",
        ] {
            assert!(
                parse(&skill(&format!(
                    "name: example\ndescription: Good\n{extra}"
                )))
                .is_err(),
                "{extra}"
            );
        }
    }
    #[test]
    fn supports_current_taste_size_without_truncation() {
        let mut bytes = skill("name: design-taste-frontend\ndescription: Good");
        bytes.resize(87_253, b'x');
        assert!(parse(&bytes).is_ok());
        bytes.resize(128 * 1024 + 1, b'x');
        assert!(parse(&bytes).is_err());
    }
}
