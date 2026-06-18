//! Runtime toolset: filtering + provider schema formatting + streamed
//! tool-call accumulation. Pure (network-free), unit-tested.

/// One tool exposed to a non-Claude provider.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}
