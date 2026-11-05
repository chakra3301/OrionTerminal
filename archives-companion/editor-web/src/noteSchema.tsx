import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

/** Custom Archives note schema = the full default block palette (which
 * already includes toggle lists, code blocks, checklists, quotes, tables)
 * PLUS a Notion-style callout block. Additive only — existing notes use a
 * subset of defaultBlockSpecs, so they parse unchanged. */

const CALLOUT_COLORS = ["green", "cyan", "yellow", "magenta", "violet"] as const;
const CALLOUT_EMOJI: Record<string, string> = {
  green: "💡",
  cyan: "ℹ️",
  yellow: "⚠️",
  magenta: "🔥",
  violet: "📌",
};

const Callout = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      color: { default: "green", values: CALLOUT_COLORS },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => {
      const color = (block.props as { color: string }).color || "green";
      const cycle = () => {
        const i = CALLOUT_COLORS.indexOf(color as (typeof CALLOUT_COLORS)[number]);
        const next = CALLOUT_COLORS[(i + 1) % CALLOUT_COLORS.length]!;
        editor.updateBlock(block, { props: { color: next } });
      };
      return (
        <div className={`bn-callout c-${color}`}>
          <button
            type="button"
            className="bn-callout-emoji"
            contentEditable={false}
            onClick={cycle}
            title="Change callout color"
          >
            {CALLOUT_EMOJI[color] ?? "💡"}
          </button>
          <div className="bn-callout-content" ref={contentRef} />
        </div>
      );
    },
  },
);

export const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: Callout(),
  },
});

export type NoteSchemaEditor = typeof noteSchema.BlockNoteEditor;
