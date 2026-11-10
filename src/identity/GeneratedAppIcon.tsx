import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import { generateGlyph } from "./glyph";

export function generatedAppIcon(id: string): LucideIcon {
  const glyph = generateGlyph(`app:${id}`);
  const Icon = forwardRef<SVGSVGElement, LucideProps>(({ size = 24, color = "currentColor", absoluteStrokeWidth: _absolute, ...props }, ref) =>
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 64 64" {...props} ref={ref}>
      <path d={glyph.path} fill={color} fillRule="evenodd" stroke="none" />
    </svg>);
  Icon.displayName = "GeneratedAppIcon";
  return Icon;
}
