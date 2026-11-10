import { collectNodeFontFaces, fontManager } from '@open-pencil/core/text';
import type { FontLoadedSource, FontManager } from '@open-pencil/core/text';
import type { SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit } from 'canvaskit-wasm';

const MAX_FACES = 128;
const MAX_REGISTRATIONS = 512;
const MAX_FONT_BYTES = 64 * 1024 * 1024;
const MAX_FONT_FILE_BYTES = 16 * 1024 * 1024;
const FONT_SOURCES = new Set<FontLoadedSource>(['local', 'bundled', 'fallback', 'google', 'fontshare', 'fontsource', 'cache', 'registered']);

export type NativeReactFontFace = { family: string; style: string; source: FontLoadedSource };
export type NativeReactFontRegistration = { family: string; bytes: ArrayBuffer; primaryFaces: string[]; cacheFace: string };
export type NativeReactFontSnapshot = {
  version: 1;
  faces: NativeReactFontFace[];
  registrations: NativeReactFontRegistration[];
  cjkFallbackFamilies: string[];
  arabicFallbackFamilies: string[];
};

const faceKey = (family: string, style: string) => `${family}\0${style}`;
function copyBytes(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  if (!bytes.byteLength || bytes.byteLength > MAX_FONT_FILE_BYTES) throw new Error('A required font file is empty or exceeds the 16MB transfer limit.');
  return bytes.slice().buffer;
}
function sameBytes(a: ArrayBuffer, b: ArrayBuffer) {
  if (a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a), right = new Uint8Array(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}
function arrayBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  return value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
function addFace(manager: FontManager, faces: Map<string, { metadata: NativeReactFontFace; sourceBytes: ArrayBuffer }>, family: string, style: string) {
  if (!family.trim() || !style.trim()) throw new Error('A required font face has incomplete family or style metadata.');
  const key = faceKey(family, style);
  if (faces.has(key)) return;
  if (faces.size >= MAX_FACES) throw new Error('This export needs more than 128 font faces.');
  const source = manager.loadedFontSource(family, style), bytes = manager.loadedData(family, style);
  if (!source || !bytes) throw new Error(`Load ${family} ${style} before exporting this design.`);
  if (!bytes.byteLength || bytes.byteLength > MAX_FONT_FILE_BYTES) throw new Error(`${family} ${style} exceeds the 16MB font transfer limit.`);
  faces.set(key, { metadata: { family, style, source }, sourceBytes: bytes });
}

export function captureNativeReactFonts(kit: CanvasKit, textNodes: readonly SceneNode[], manager: FontManager = fontManager): NativeReactFontSnapshot {
  const required = new Map<string, { metadata: NativeReactFontFace; sourceBytes: ArrayBuffer }>();
  for (const node of textNodes) for (const face of collectNodeFontFaces(node)) addFace(manager, required, face.family, face.style);
  const cjkFallbackFamilies = [...manager.getCJKFallbackFamilies()], arabicFallbackFamilies = [...manager.getArabicFallbackFamilies()];
  for (const family of cjkFallbackFamilies) addFace(manager, required, family, 'Regular');
  for (const family of arabicFallbackFamilies) addFace(manager, required, family, 'Regular');

  const provider = kit.TypefaceFontProvider.Make();
  if (!provider) throw new Error('This export could not allocate a temporary font provider.');
  const registrations: NativeReactFontRegistration[] = [], primarySeen = new Set<string>();
  const firstFaceByFamily = new Map<string, string>(), activeFaceByFamily = new Map<string, string>();
  for (const key of required.keys()) if (!firstFaceByFamily.has(required.get(key)!.metadata.family)) firstFaceByFamily.set(required.get(key)!.metadata.family, key);
  let totalBytes = 0;
  const register = provider.registerFont;
  provider.registerFont = (bytes, family) => {
    register.call(provider, bytes, family);
    if (![...required.values()].some(face => face.metadata.family === family)) return;
    if (registrations.length >= MAX_REGISTRATIONS) throw new Error('This export needs more than 512 font registrations.');
    const copied = copyBytes(bytes); totalBytes += copied.byteLength;
    if (totalBytes > MAX_FONT_BYTES) throw new Error('Required fonts exceed the 64MB export transfer limit.');
    const primaryFaces: string[] = [];
    for (const [key, face] of required) {
      if (face.metadata.family === family && !primarySeen.has(key) && face.sourceBytes === bytes) {
        primarySeen.add(key); primaryFaces.push(key);
      }
    }
    const cacheFace = primaryFaces[0] ?? activeFaceByFamily.get(family) ?? firstFaceByFamily.get(family);
    if (!cacheFace) return;
    registrations.push({ family, bytes: copied, primaryFaces, cacheFace });
    if (primaryFaces.length) activeFaceByFamily.set(family, primaryFaces[0]!);
  };
  try {
    manager.attachProvider(kit, provider);
    for (const key of required.keys()) if (!primarySeen.has(key)) throw new Error(`The public font provider did not register required face ${key.replace('\0', ' ')}.`);
    return { version: 1, faces: [...required.values()].map(face => face.metadata), registrations, cjkFallbackFamilies, arabicFallbackFamilies };
  } finally {
    provider.registerFont = register;
    manager.detachProvider(provider);
    if (!provider.isDeleted()) provider.delete();
  }
}

function existingRegistrations(kit: CanvasKit, manager: FontManager, families: ReadonlySet<string>) {
  const provider = kit.TypefaceFontProvider.Make();
  if (!provider) throw new Error('This worker could not allocate a font cache inspection provider.');
  const registrations = new Map<string, (ArrayBuffer | Uint8Array)[]>();
  let overflow = false;
  const register = provider.registerFont;
  provider.registerFont = (bytes, family) => {
    register.call(provider, bytes, family);
    if (!families.has(family)) return;
    const values = registrations.get(family) ?? [];
    if (values.length >= MAX_REGISTRATIONS) { overflow = true; return; }
    values.push(bytes); registrations.set(family, values);
  };
  try {
    manager.attachProvider(kit, provider);
    if (overflow) throw new Error('This worker has more than 512 cached font registrations for the selected families.');
    return registrations;
  } finally {
    provider.registerFont = register;
    manager.detachProvider(provider);
    if (!provider.isDeleted()) provider.delete();
  }
}

export function installNativeReactFonts(kit: CanvasKit, snapshot: NativeReactFontSnapshot, manager: FontManager = fontManager) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.faces) || !Array.isArray(snapshot.registrations) || !Array.isArray(snapshot.cjkFallbackFamilies) || !Array.isArray(snapshot.arabicFallbackFamilies) || snapshot.faces.length > MAX_FACES || snapshot.registrations.length > MAX_REGISTRATIONS) throw new Error('Invalid or oversized native React font bundle.');
  const faces = new Map<string, NativeReactFontFace>();
  for (const face of snapshot.faces) {
    if (!face || typeof face.family !== 'string' || typeof face.style !== 'string' || !face.family.trim() || !face.style.trim() || !FONT_SOURCES.has(face.source)) throw new Error('Invalid font face metadata in the native React bundle.');
    const key = faceKey(face.family, face.style);
    if (faces.has(key)) throw new Error('The native React bundle contains duplicate font faces.');
    faces.set(key, face);
  }
  let totalBytes = 0;
  for (const registration of snapshot.registrations) {
    if (!registration || typeof registration.family !== 'string' || !registration.family.trim() || !(registration.bytes instanceof ArrayBuffer) || !Array.isArray(registration.primaryFaces) || typeof registration.cacheFace !== 'string') throw new Error('Invalid font registration in the native React bundle.');
    if (!registration.bytes.byteLength || registration.bytes.byteLength > MAX_FONT_FILE_BYTES) throw new Error('A bundled font file exceeds the 16MB transfer limit.');
    totalBytes += registration.bytes.byteLength;
    if (totalBytes > MAX_FONT_BYTES) throw new Error('Bundled fonts exceed the 64MB transfer limit.');
    if (!faces.has(registration.cacheFace) || faces.get(registration.cacheFace)!.family !== registration.family) throw new Error('A bundled font registration has no matching cache face.');
    for (const key of registration.primaryFaces) if (!faces.has(key) || faces.get(key)!.family !== registration.family) throw new Error('A bundled primary font registration has no matching face.');
  }
  const covered = new Set(snapshot.registrations.flatMap(registration => registration.primaryFaces));
  if (covered.size !== faces.size || [...faces.keys()].some(key => !covered.has(key))) throw new Error('The native React bundle is missing a required primary font face.');

  const families = new Set(snapshot.faces.map(face => face.family)), existing = existingRegistrations(kit, manager, families), cursors = new Map<string, number>();
  const registrations = snapshot.registrations.map(registration => {
    const candidates = existing.get(registration.family) ?? [], start = cursors.get(registration.family) ?? 0;
    let match = -1;
    for (let i = start; i < candidates.length; i++) {
      const bytes = arrayBuffer(candidates[i]!);
      if (sameBytes(bytes, registration.bytes)) { match = i; break; }
    }
    if (match < 0) return registration;
    cursors.set(registration.family, match + 1);
    const bytes = arrayBuffer(candidates[match]!);
    return { ...registration, bytes };
  });

  const provider = kit.TypefaceFontProvider.Make();
  if (!provider) throw new Error('This worker could not allocate its font provider.');
  const finalPrimary = new Map<string, ArrayBuffer>();
  for (const registration of registrations) for (const key of registration.primaryFaces) finalPrimary.set(key, registration.bytes);
  try {
    manager.attachProvider(kit, provider);
    for (const registration of registrations) {
      if (registration.primaryFaces.length) {
        for (const key of registration.primaryFaces) {
          const face = faces.get(key)!;
          const existing = manager.loadedData(face.family, face.style);
          if (existing && !sameBytes(existing, registration.bytes)) throw new Error(`Worker font cache conflicts with ${face.family} ${face.style}.`);
          manager.markLoaded(face.family, face.style, existing ?? registration.bytes, face.source);
        }
      } else {
        const face = faces.get(registration.cacheFace)!;
        manager.markLoaded(face.family, face.style, registration.bytes, face.source);
      }
    }
    for (const [key, bytes] of finalPrimary) {
      const face = faces.get(key)!;
      manager.markLoaded(face.family, face.style, bytes, face.source);
    }
    for (const family of snapshot.cjkFallbackFamilies) manager.setCJKFallbackFamily(family);
    for (const family of snapshot.arabicFallbackFamilies) manager.setArabicFallbackFamily(family);
    return { provider, dispose() { manager.detachProvider(provider); if (!provider.isDeleted()) provider.delete(); } };
  } catch (error) {
    manager.detachProvider(provider);
    if (!provider.isDeleted()) provider.delete();
    throw error;
  }
}
