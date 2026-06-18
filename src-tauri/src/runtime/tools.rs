//! Runtime toolset: filtering + provider schema formatting + streamed
//! tool-call accumulation. Pure (network-free), unit-tested.

use crate::runtime::provider::ToolCall;

/// One tool exposed to a non-Claude provider.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
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
