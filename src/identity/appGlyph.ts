import archives from "@/assets/dock/glyph-archives.png";
import orion from "@/assets/dock/glyph-orion.png";
import xdesign from "@/assets/dock/glyph-xdesign.png";
import incubator from "@/assets/dock/glyph-rosie.png";
import { generateGlyph } from "./glyph";

const APPROVED: Readonly<Record<string, string>> = { archives, orion, xdesign, incubator };
export function appGlyph(id: string): string {
  return APPROVED[id] ?? generateGlyph(`app:${id}`).uri;
}
