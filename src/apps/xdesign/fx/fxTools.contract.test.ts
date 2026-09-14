import { describe, expect, it } from "vitest";
import tools from "../../../../resources/fx-tools.json";
import { FX_TOOLS } from "./fxAssist";
import { mapToRuntimeTools } from "@/features/agents/runtimeTools";

describe("FX connector tool parity", () => {
  it("keeps the compiled MCP catalog identical to frontend schemas", () => {
    expect(tools).toEqual(FX_TOOLS.map((t) => ({ name: `orion_${t.name}`, description: t.description, inputSchema: t.input_schema })));
  });
  it("maps exact MCP tool grants into HTTP runtime tools", () => {
    expect(mapToRuntimeTools(FX_TOOLS.map((t) => `mcp__orion__orion_${t.name}`))).toEqual(tools.map((t) => t.name));
  });
});
