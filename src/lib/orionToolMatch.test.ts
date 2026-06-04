import { describe, expect, it } from "vitest";
import {
  isOrionNoteWriteTool,
  isOrionMoodWriteTool,
  isOrionAssetWriteTool,
  isOrionHermesWriteTool,
} from "@/lib/orionToolMatch";

describe("orion tool matchers", () => {
  it("matches the mcp-prefixed form claude actually emits", () => {
    // This is the form that bit us — claude sends mcp__<server>__<tool>.
    expect(isOrionNoteWriteTool("mcp__orion__orion_create_note")).toBe(true);
    expect(isOrionNoteWriteTool("mcp__orion__orion_update_note_body")).toBe(true);
    expect(isOrionNoteWriteTool("mcp__orion__orion_delete_note")).toBe(true);
    expect(isOrionMoodWriteTool("mcp__orion__orion_create_mood_board")).toBe(true);
    expect(isOrionMoodWriteTool("mcp__orion__orion_add_to_mood_board")).toBe(true);
    expect(isOrionAssetWriteTool("mcp__orion__orion_attach_tag")).toBe(true);
  });

  it("matches the bare form too", () => {
    expect(isOrionNoteWriteTool("orion_create_note")).toBe(true);
    expect(isOrionAssetWriteTool("orion_attach_tag")).toBe(true);
  });

  it("does not cross-match between categories", () => {
    expect(isOrionMoodWriteTool("mcp__orion__orion_create_note")).toBe(false);
    expect(isOrionNoteWriteTool("mcp__orion__orion_attach_tag")).toBe(false);
    expect(isOrionAssetWriteTool("mcp__orion__orion_create_mood_board")).toBe(false);
  });

  it("ignores read tools + built-in claude tools", () => {
    expect(isOrionNoteWriteTool("mcp__orion__orion_list_recent_notes")).toBe(false);
    expect(isOrionNoteWriteTool("mcp__orion__orion_search_archive")).toBe(false);
    expect(isOrionNoteWriteTool("Bash")).toBe(false);
    expect(isOrionNoteWriteTool("Edit")).toBe(false);
  });

  it("does not match a tool that merely ends with the string sans boundary", () => {
    // Guards against the loose endsWith() the original code used.
    expect(isOrionNoteWriteTool("xorion_create_note")).toBe(false);
    expect(isOrionNoteWriteTool("notorion_attach_tag")).toBe(false);
  });

  it("matches Hermes board write tools (drives the board refresh)", () => {
    expect(isOrionHermesWriteTool("mcp__orion__orion_hermes_create_task")).toBe(true);
    expect(isOrionHermesWriteTool("mcp__orion__orion_hermes_add_agent")).toBe(true);
    expect(isOrionHermesWriteTool("mcp__orion__orion_hermes_update_task")).toBe(true);
    expect(isOrionHermesWriteTool("mcp__orion__orion_hermes_move_task")).toBe(true);
    expect(isOrionHermesWriteTool("mcp__orion__orion_hermes_decompose")).toBe(true);
    expect(isOrionHermesWriteTool("orion_hermes_create_task")).toBe(true);
  });

  it("treats Hermes read tools + other categories as non-refreshing", () => {
    expect(isOrionHermesWriteTool("mcp__orion__orion_hermes_list_tasks")).toBe(false);
    expect(isOrionHermesWriteTool("mcp__orion__orion_hermes_get_task")).toBe(false);
    expect(isOrionHermesWriteTool("mcp__orion__orion_create_note")).toBe(false);
    expect(isOrionNoteWriteTool("mcp__orion__orion_hermes_create_task")).toBe(false);
  });
});
