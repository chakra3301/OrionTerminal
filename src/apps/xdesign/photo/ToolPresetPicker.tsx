import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { usePopover } from "./OptionsBarControls";
import { ToolPresetsPanel, type ToolPresetSelection } from "./AdditionalPresets";
import type { PhotoState } from "./types";

/** Photoshop's Tool Preset picker at the left of the options bar: the Tool Presets panel in a popover that closes once a preset applies. */
export function ToolPresetPicker({ icon, toolLabel, state, tool, options, choose }: { icon: ReactNode; toolLabel: string; state: PhotoState | null; tool: string; options: Record<string, unknown>; choose: (selection: ToolPresetSelection) => void }) {
  const [opened, setOpened] = useState(false), open = opened && !!state;
  const close = (refocus: boolean) => { setOpened(false); if (refocus) anchor.current?.focus(); };
  const { anchor, pop, rootProps } = usePopover<HTMLDivElement>(open, close);
  return <div className="xd-ps-tool-preset" {...rootProps}>
    <button ref={anchor} type="button" aria-label="Tool preset picker" aria-haspopup="dialog" aria-expanded={open} title={toolLabel} disabled={!state} onClick={() => { if (open) close(false); else setOpened(true); }}>
      <span role="img" aria-label={`Current tool: ${toolLabel}`}>{icon}</span><ChevronDown size={9} />
    </button>
    {open && state && <div ref={pop} className="xd-ps-popover xd-ps-tool-preset-popover" role="dialog" aria-label="Tool preset picker">
      <ToolPresetsPanel state={state} tool={tool} options={options} choose={selection => { close(true); choose(selection); }} />
    </div>}
  </div>;
}
