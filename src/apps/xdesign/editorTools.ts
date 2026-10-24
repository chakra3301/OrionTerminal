import { MousePointer2, Frame, SquareDashed, Square, Circle, Minus, Triangle, Star, Type, PenTool, Hand, Paintbrush, Eraser, Lasso, Wand2, Crop, Pencil, Stamp, Bandage, Sun, Flame, Droplets, Fingerprint, PaintBucket, Palette, Blend, Ruler, Magnet, Pipette, ZoomIn, PenLine, Spline, MousePointer, SquareMousePointer, LassoSelect, SquareDashedMousePointer, Brush, History, Scan } from "lucide-react";
import type { EditorToolGroup } from "./EditorChrome";

export const DESIGN_TOOL_GROUPS: EditorToolGroup[] = [
  // Figma's toolbar groups and flyout order.
  { label: "Move tools", tools: [{ id: "SELECT", label: "Move", icon: MousePointer2 }, { id: "HAND", label: "Hand", icon: Hand }] },
  { label: "Frame tools", tools: [{ id: "FRAME", label: "Frame", icon: Frame }, { id: "SECTION", label: "Section", icon: SquareDashed }] },
  { label: "Shape tools", tools: [{ id: "RECTANGLE", label: "Rectangle", icon: Square }, { id: "LINE", label: "Line", icon: Minus }, { id: "ELLIPSE", label: "Ellipse", icon: Circle }, { id: "POLYGON", label: "Polygon", icon: Triangle }, { id: "STAR", label: "Star", icon: Star }] },
  { label: "Pen tool", tools: [{ id: "PEN", label: "Pen", icon: PenTool }] },
  { label: "Text tool", tools: [{ id: "TEXT", label: "Text", icon: Type }] },
];
export const IMAGE_TOOL_GROUPS: EditorToolGroup[] = [
  // Photoshop's default toolbar groups, flyout order and names.
  { label: "Move tool", tools: [{ id: "move", label: "Move Tool", icon: MousePointer2, shortcut: "V" }] },
  { label: "Marquee tools", tools: [{ id: "select.rect", label: "Rectangular Marquee Tool", icon: SquareDashed, shortcut: "M" }, { id: "ellipseSelection", label: "Elliptical Marquee Tool", icon: Circle, shortcut: "M" }] },
  { label: "Lasso tools", tools: [{ id: "select.lasso", label: "Lasso Tool", icon: Lasso, shortcut: "L" }, { id: "polygonLasso", label: "Polygonal Lasso Tool", icon: LassoSelect, shortcut: "L" }, { id: "magneticLasso", label: "Magnetic Lasso Tool", icon: Magnet, shortcut: "L" }] },
  { label: "Object selection tools", tools: [{ id: "select.object", label: "Object Selection Tool", icon: SquareDashedMousePointer, shortcut: "W" }, { id: "select.quick", label: "Quick Selection Tool", icon: Brush, shortcut: "W" }, { id: "select.magicWand", label: "Magic Wand Tool", icon: Wand2, shortcut: "W" }] },
  { label: "Crop tools", tools: [{ id: "crop", label: "Crop Tool", icon: Crop, shortcut: "C" }, { id: "straighten", label: "Straighten Tool", icon: Ruler, shortcut: "C" }] },
  { label: "Eyedropper tool", tools: [{ id: "eyedropper", label: "Eyedropper Tool", icon: Pipette, shortcut: "I" }] },
  { label: "Healing tools", tools: [{ id: "paint.spotHealing", label: "Spot Healing Brush Tool", icon: Bandage, shortcut: "J" }, { id: "paint.healingBrush", label: "Healing Brush Tool", icon: Bandage, shortcut: "J" }, { id: "paint.patch", label: "Patch Tool", icon: Scan, shortcut: "J" }] },
  { label: "Brush tools", tools: [{ id: "paint.stroke", label: "Brush Tool", icon: Paintbrush, shortcut: "B" }, { id: "paint.pencil", label: "Pencil Tool", icon: Pencil, shortcut: "B" }, { id: "paint.colorReplacement", label: "Color Replacement Tool", icon: Palette, shortcut: "B" }, { id: "paint.mixerBrush", label: "Mixer Brush Tool", icon: Blend, shortcut: "B" }] },
  { label: "Clone stamp tool", tools: [{ id: "paint.cloneStamp", label: "Clone Stamp Tool", icon: Stamp, shortcut: "S" }] },
  { label: "History brush tool", tools: [{ id: "paint.historyBrush", label: "History Brush Tool", icon: History, shortcut: "Y" }] },
  { label: "Eraser tools", tools: [{ id: "erase", label: "Eraser Tool", icon: Eraser, shortcut: "E" }, { id: "paint.backgroundEraser", label: "Background Eraser Tool", icon: Eraser, shortcut: "E" }, { id: "paint.magicEraser", label: "Magic Eraser Tool", icon: Wand2, shortcut: "E" }] },
  { label: "Gradient tools", tools: [{ id: "paint.gradient", label: "Gradient Tool", icon: Blend, shortcut: "G" }, { id: "paint.bucket", label: "Paint Bucket Tool", icon: PaintBucket, shortcut: "G" }] },
  { label: "Blur tools", tools: [{ id: "paint.blur", label: "Blur Tool", icon: Droplets }, { id: "paint.sharpen", label: "Sharpen Tool", icon: Triangle }, { id: "paint.smudge", label: "Smudge Tool", icon: Fingerprint }] },
  { label: "Toning tools", tools: [{ id: "paint.dodge", label: "Dodge Tool", icon: Sun, shortcut: "O" }, { id: "paint.burn", label: "Burn Tool", icon: Flame, shortcut: "O" }, { id: "paint.sponge", label: "Sponge Tool", icon: Droplets, shortcut: "O" }] },
  { label: "Pen tools", tools: [{ id: "pen", label: "Pen Tool", icon: PenTool, shortcut: "P" }, { id: "pen.freeform", label: "Freeform Pen Tool", icon: PenLine, shortcut: "P" }, { id: "pen.curvature", label: "Curvature Pen Tool", icon: Spline, shortcut: "P" }] },
  { label: "Type tool", tools: [{ id: "text", label: "Horizontal Type Tool", icon: Type, shortcut: "T" }] },
  { label: "Path selection tools", tools: [{ id: "path.select", label: "Path Selection Tool", icon: MousePointer, shortcut: "A" }, { id: "path.direct", label: "Direct Selection Tool", icon: SquareMousePointer, shortcut: "A" }] },
  { label: "Shape tools", tools: [{ id: "shape.rect", label: "Rectangle Tool", icon: Square, shortcut: "U" }, { id: "shape.ellipse", label: "Ellipse Tool", icon: Circle, shortcut: "U" }, { id: "shape.line", label: "Line Tool", icon: Minus, shortcut: "U" }] },
  { label: "Hand tool", tools: [{ id: "hand", label: "Hand Tool", icon: Hand, shortcut: "H" }] },
  { label: "Zoom tool", tools: [{ id: "zoom", label: "Zoom Tool", icon: ZoomIn, shortcut: "Z" }] },
];
