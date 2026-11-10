import {
  MousePointer2,
  Frame,
  Square,
  Circle,
  Type,
  PenTool,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { useXDesign, type ToolId } from "@/apps/xdesign/store";
import { useRailIntent } from "@/apps/xdesign/railIntentStore";

const TOOLS: Array<{ id: ToolId | "pen"; Icon: typeof MousePointer2; title: string; hotkey?: string; enabled: boolean }> = [
  { id: "select", Icon: MousePointer2, title: "Select", hotkey: "V", enabled: true },
  { id: "frame", Icon: Frame, title: "Frame · group container", hotkey: "F", enabled: true },
  { id: "rect", Icon: Square, title: "Rectangle", hotkey: "R", enabled: true },
  { id: "ellipse", Icon: Circle, title: "Ellipse", hotkey: "O", enabled: true },
  { id: "text", Icon: Type, title: "Text", hotkey: "T", enabled: true },
  { id: "pen", Icon: PenTool, title: "Pen · click anchors · Enter to commit", hotkey: "P", enabled: true },
  { id: "image", Icon: ImageIcon, title: "Image · place from Archives", hotkey: "I", enabled: true },
];

export function XDesignToolRail() {
  const tool = useXDesign((s) => s.tool);
  const setTool = useXDesign((s) => s.setTool);
  const requestRail = useRailIntent((s) => s.request);

  return (
    <div className="xd-toolrail" role="toolbar" aria-label="Design tools" aria-orientation="vertical">
      {TOOLS.map((t) => {
        const Icon = t.Icon;
        const active = t.enabled && tool === t.id;
        return (
          <button
            type="button"
            key={t.id}
            className={`xd-tool${active ? " active" : ""}${t.enabled ? "" : " disabled"}`}
            title={t.hotkey ? `${t.title} (${t.hotkey})` : t.title}
            onClick={() => {
              if (!t.enabled) return;
              setTool(t.id as ToolId);
            }}
            disabled={!t.enabled}
            aria-label={t.title}
            aria-pressed={active}
          >
            <Icon size={16} />
          </button>
        );
      })}

      <div className="xd-toolrail-divider" />

      <button type="button" className="xd-tool xd-tool-ai" title="Design partner (⌘L)" aria-label="Open design partner" onClick={() => requestRail("open")}><Sparkles size={16}/></button>
    </div>
  );
}
