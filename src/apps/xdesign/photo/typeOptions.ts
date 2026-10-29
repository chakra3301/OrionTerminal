import { useEffect, useRef, useState } from "react";
import { rangeStyle } from "./ImageTypographyPanel";
import { controlsLocked, runPhotoCommand, usePhotoWorkspace } from "./runtime";
import type { PhotoTextRun } from "./types";

export type Face = { weight: number; italic: boolean };
const WEIGHTS: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
const WEIGHT_OF: Record<string, number> = Object.fromEntries(Object.entries(WEIGHTS).map(([weight, name]) => [name.toLowerCase(), Number(weight)]));
export const BASIC_STYLES = ["Regular", "Italic", "Bold", "Bold Italic"];

export const faceName = ({ weight, italic }: Face) => {
  const name = WEIGHTS[Math.round(weight / 100) * 100] ?? String(weight);
  return italic ? (name === "Regular" ? "Italic" : `${name} Italic`) : name;
};
function faceOf(name: string): Face {
  const italic = /italic|oblique/i.test(name), base = name.replace(/\s*(italic|oblique)\s*/i, "").trim().toLowerCase();
  return { weight: base ? WEIGHT_OF[base] ?? (Number(base) || 400) : 400, italic };
}
// Regular must reset weight/italic when restyling an existing layer, but stay out of type.create's params.
export function typeStyleParams(style: string, reset = false) {
  const { weight, italic } = faceOf(style);
  return { ...(weight !== 400 || reset ? { weight } : {}), ...(italic || reset ? { italic } : {}) };
}
/** The Font Style menu: the family's faces lightest first, or Photoshop's four basic styles until the engine has listed them. */
export function faceStyles(faces: Face[], current: string): string[] {
  const names = [...faces].sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic)).map(faceName);
  return [...new Set([...(names.length ? names : BASIC_STYLES), current])];
}
export function layerFaceName(runs: PhotoTextRun[] | undefined): string | null {
  const weight = runs && rangeStyle(runs, [0, Number.MAX_SAFE_INTEGER], "weight"), italic = runs && rangeStyle(runs, [0, Number.MAX_SAFE_INTEGER], "italic");
  return typeof weight === "number" && typeof italic === "boolean" ? faceName({ weight, italic }) : null;
}

const STANDARD = [["none", "None"], ["sharp", "Sharp"], ["crisp", "Crisp"], ["strong", "Strong"], ["smooth", "Smooth"]] as const;
export type TypeAntialias = typeof STANDARD[number][0];
const isMac = () => typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform);
/** [id, label, supported]. Photoshop adds the system's LCD pair; the engine has no Mac modes and draws its Windows ones as Sharp, so both pairs stay off. */
export function antialiasEntries(mac = isMac()): [string, string, boolean][] {
  return [...STANDARD.map(([id, label]): [string, string, boolean] => [id, label, true]), ...(mac ? [["macLcd", "Mac LCD", false], ["mac", "Mac", false]] as [string, string, boolean][] : [["windowsLcd", "Windows LCD", false], ["windows", "Windows", false]] as [string, string, boolean][])];
}
export function typeAntialias(value: unknown): TypeAntialias {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  return key === "windowslcd" || key === "windows" ? "sharp" : STANDARD.find(([id]) => id === key)?.[0] ?? "smooth";
}
export const typeSize = (value: number) => Number.isFinite(value) ? Math.round(Math.min(1296, Math.max(.01, value)) * 100) / 100 : null;

/** The engine's faces for `family`, asked once per family when the workspace is idle; an empty list means use the basic styles. */
export function useFamilyFaces(family: string): Face[] {
  const locked = usePhotoWorkspace(controlsLocked), [faces, setFaces] = useState<{ family: string; list: Face[] }>({ family: "", list: [] }), asked = useRef("");
  useEffect(() => {
    if (!family || locked || asked.current === family) return;
    asked.current = family;
    void runPhotoCommand("type.fonts", { family }).then(result => {
      const list = (result as { faces?: unknown } | undefined)?.faces;
      setFaces({ family, list: Array.isArray(list) ? list.filter((face): face is Face => typeof face?.weight === "number").map(face => ({ weight: face.weight, italic: face.italic === true })) : [] });
    }, () => setFaces({ family, list: [] }));
  }, [family, locked]);
  return faces.family === family ? faces.list : [];
}
