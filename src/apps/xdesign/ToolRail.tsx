import {
  MousePointer2,
  Frame,
  Square,
  Circle,
  Type,
  PenTool,
  Image as ImageIcon,
  Wand2,
  Shuffle,
  Globe,
  Presentation,
  Film,
  ImagePlus,
  Eye,
  Paintbrush,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { useXDesign, type ToolId } from "@/apps/xdesign/store";
import { useRailIntent, type RailIntentMode } from "@/apps/xdesign/railIntentStore";

const TOOLS: Array<{ id: ToolId | "pen"; Icon: typeof MousePointer2; title: string; hotkey?: string; enabled: boolean }> = [
  { id: "select", Icon: MousePointer2, title: "Select", hotkey: "V", enabled: true },
  { id: "frame", Icon: Frame, title: "Frame · group container", hotkey: "F", enabled: true },
  { id: "rect", Icon: Square, title: "Rectangle", hotkey: "R", enabled: true },
  { id: "ellipse", Icon: Circle, title: "Ellipse", hotkey: "O", enabled: true },
  { id: "text", Icon: Type, title: "Text", hotkey: "T", enabled: true },
  { id: "pen", Icon: PenTool, title: "Pen · click anchors · Enter to commit", hotkey: "P", enabled: true },
  { id: "image", Icon: ImageIcon, title: "Image · place from Archives", hotkey: "I", enabled: true },
];

// AI flows mirrored from the Claude rail. Clicking one surfaces the rail and
// arms (or runs) the matching flow via the shared intent store — no coupling to
// the rail's internal React state.
const AI_TOOLS: Array<{ mode: RailIntentMode; Icon: LucideIcon; title: string }> = [
  { mode: "generate", Icon: Wand2, title: "Generate — a full design from a brief" },
  { mode: "variations", Icon: Shuffle, title: "Variations — 3 distinct directions" },
  { mode: "webpage", Icon: Globe, title: "Build webpage — real, shippable HTML" },
  { mode: "deck", Icon: Presentation, title: "Build deck — a presentable slide deck" },
  { mode: "motion", Icon: Film, title: "Motion — a looping canvas motion graphic" },
  { mode: "illustrate", Icon: ImagePlus, title: "Illustrate — a vector SVG illustration" },
  { mode: "image", Icon: ImageIcon, title: "Generate image — raster from a prompt" },
  { mode: "critique", Icon: Eye, title: "Critique & refine — self-critique, then fix" },
  { mode: "applyBrand", Icon: Paintbrush, title: "Apply brand — restyle to the active system" },
  { mode: "extractBrand", Icon: Palette, title: "Extract brand — distill canvas into a system" },
];

export function XDesignToolRail() {
  const tool = useXDesign((s) => s.tool);
  const setTool = useXDesign((s) => s.setTool);
  const requestRail = useRailIntent((s) => s.request);

  return (
    <div className="xd-toolrail">
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
          >
            <Icon size={16} />
          </button>
        );
      })}

      <div className="xd-toolrail-divider" />

      {AI_TOOLS.map((a) => {
        const Icon = a.Icon;
        return (
          <button
            type="button"
            key={a.mode}
            className="xd-tool xd-tool-ai"
            title={a.title}
            onClick={() => requestRail(a.mode)}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
