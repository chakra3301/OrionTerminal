//! Runtime toolset: filtering + provider schema formatting + streamed
//! tool-call accumulation. Pure (network-free), unit-tested.

use crate::runtime::provider::ToolCall;
use serde_json::{json, Value};

/// One tool exposed to a non-Claude provider.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// Build the runtime toolset from the agent's resolved allow-list. The list
/// contains Orion tool names (e.g. "orion_read_file"); the sentinel
/// "mcp__orion" means "expose the entire Orion catalog".
pub fn filter_tools(allowed: &[String]) -> Vec<ToolDef> {
    let defs = crate::mcp_server::tool_definitions();
    let all = allowed.iter().any(|t| t == "mcp__orion");
    let mut out = Vec::new();
    if let Some(arr) = defs.as_array() {
        for d in arr {
            let name = d.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            if all || allowed.iter().any(|t| t == name) {
                out.push(ToolDef {
                    name: name.to_string(),
                    description: d.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    parameters: d
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                });
            }
        }
    }
    out
}

/// OpenAI `tools: [{ type:"function", function:{ name, description, parameters } }]`.
pub fn openai_tools(defs: &[ToolDef]) -> Value {
    Value::Array(
        defs.iter()
            .map(|d| {
                json!({
                    "type": "function",
                    "function": {
                        "name": d.name,
                        "description": d.description,
                        "parameters": d.parameters,
                    }
                })
            })
            .collect(),
    )
}

fn params_are_empty(p: &Value) -> bool {
    p.get("properties")
        .and_then(|x| x.as_object())
        .map(|o| o.is_empty())
        .unwrap_or(true)
}

/// Gemini `tools: [{ functionDeclarations: [ { name, description, parameters? } ] }]`.
/// `parameters` is omitted for no-arg tools — some Gemini versions reject an
/// empty `properties` object.
pub fn gemini_tools(defs: &[ToolDef]) -> Value {
    let decls: Vec<Value> = defs
        .iter()
        .map(|d| {
            let mut decl = json!({ "name": d.name, "description": d.description });
            if !params_are_empty(&d.parameters) {
                decl["parameters"] = d.parameters.clone();
            }
            decl
        })
        .collect();
    json!([{ "functionDeclarations": decls }])
}

struct PartialCall {
    index: i64,
    id: Option<String>,
    name: Option<String>,
    args: String,
}

/// Assembles streamed tool-call fragments into complete `ToolCall`s.
/// `index >= 0` merges fragments (OpenAI); `index < 0` always starts a new
/// entry (Gemini, which delivers a whole call per fragment).
#[derive(Default)]
pub struct ToolCallAccumulator {
    calls: Vec<PartialCall>,
}

impl ToolCallAccumulator {
    pub fn push(&mut self, index: i64, id: Option<&str>, name: Option<&str>, args_fragment: &str) {
        let slot = if index >= 0 {
            if let Some(pos) = self.calls.iter().position(|c| c.index == index) {
                &mut self.calls[pos]
            } else {
                self.calls.push(PartialCall { index, id: None, name: None, args: String::new() });
                self.calls.last_mut().unwrap()
            }
        } else {
            self.calls.push(PartialCall { index, id: None, name: None, args: String::new() });
            self.calls.last_mut().unwrap()
        };
        if let Some(i) = id {
            if !i.is_empty() {
                slot.id = Some(i.to_string());
            }
        }
        if let Some(n) = name {
            if !n.is_empty() {
                slot.name = Some(n.to_string());
            }
        }
        slot.args.push_str(args_fragment);
    }

    pub fn is_empty(&self) -> bool {
        self.calls.is_empty()
    }

    pub fn finish(self) -> Vec<ToolCall> {
        self.calls
            .into_iter()
            .enumerate()
            .map(|(i, c)| ToolCall {
                id: c.id.unwrap_or_else(|| format!("call_{}", i)),
                name: c.name.unwrap_or_default(),
                arguments: if c.args.trim().is_empty() { "{}".to_string() } else { c.args },
            })
            .collect()
    }
}

#[cfg(test)]
mod acc_tests {
    use super::ToolCallAccumulator;

    #[test]
    fn openai_fragments_assemble_by_index() {
        let mut a = ToolCallAccumulator::default();
        a.push(0, Some("call_a"), Some("orion_read_file"), "");
        a.push(0, None, None, "{\"path\":");
        a.push(0, None, None, "\"/x\"}");
        let calls = a.finish();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_a");
        assert_eq!(calls[0].name, "orion_read_file");
        assert_eq!(calls[0].arguments, "{\"path\":\"/x\"}");
    }

    #[test]
    fn two_indices_two_calls() {
        let mut a = ToolCallAccumulator::default();
        a.push(0, Some("c0"), Some("t0"), "{}");
        a.push(1, Some("c1"), Some("t1"), "{}");
        assert_eq!(a.finish().len(), 2);
    }

    #[test]
    fn negative_index_always_new_and_id_synthesized() {
        let mut a = ToolCallAccumulator::default();
        a.push(-1, None, Some("gemini_call"), "{\"a\":1}");
        a.push(-1, None, Some("gemini_call2"), "{\"b\":2}");
        let calls = a.finish();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_0");
        assert_eq!(calls[1].id, "call_1");
    }

    #[test]
    fn empty_args_become_empty_object() {
        let mut a = ToolCallAccumulator::default();
        a.push(0, Some("c"), Some("t"), "");
        assert_eq!(a.finish()[0].arguments, "{}");
    }

    #[test]
    fn is_empty_reflects_pushes() {
        let mut a = ToolCallAccumulator::default();
        assert!(a.is_empty());
        a.push(0, Some("c"), Some("t"), "{}");
        assert!(!a.is_empty());
    }
}

#[cfg(test)]
mod schema_tests {
    use super::{filter_tools, gemini_tools, openai_tools, ToolDef};
    use serde_json::json;

    #[test]
    fn filter_by_name_subset() {
        let got = filter_tools(&["orion_read_note".to_string(), "orion_apply_edit".to_string()]);
        let names: Vec<&str> = got.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"orion_read_note"));
        assert!(names.contains(&"orion_apply_edit"));
        assert!(!names.contains(&"orion_delete_note"));
    }

    #[test]
    fn mcp_orion_means_all() {
        let all = filter_tools(&["mcp__orion".to_string()]);
        // Catalog has 30+ tools; "all" must be much larger than a 1-name filter.
        assert!(all.len() > 10);
        assert!(all.iter().any(|t| t.name == "orion_read_note"));
    }

    #[test]
    fn empty_allowed_means_no_tools() {
        assert!(filter_tools(&[]).is_empty());
    }

    #[test]
    fn openai_shape() {
        let defs = vec![ToolDef {
            name: "t".into(),
            description: "d".into(),
            parameters: json!({"type":"object","properties":{"x":{"type":"string"}},"required":["x"]}),
        }];
        let v = openai_tools(&defs);
        assert_eq!(v[0]["type"], "function");
        assert_eq!(v[0]["function"]["name"], "t");
        assert_eq!(v[0]["function"]["parameters"]["required"][0], "x");
    }

    #[test]
    fn gemini_shape_wraps_declarations() {
        let defs = vec![ToolDef {
            name: "t".into(),
            description: "d".into(),
            parameters: json!({"type":"object","properties":{"x":{"type":"string"}}}),
        }];
        let v = gemini_tools(&defs);
        assert_eq!(v[0]["functionDeclarations"][0]["name"], "t");
    }

    #[test]
    fn gemini_omits_empty_parameters() {
        let defs = vec![ToolDef {
            name: "noargs".into(),
            description: "d".into(),
            parameters: json!({"type":"object","properties":{}}),
        }];
        let v = gemini_tools(&defs);
        assert!(v[0]["functionDeclarations"][0].get("parameters").is_none());
    }
}
