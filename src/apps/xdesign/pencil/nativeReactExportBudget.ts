import type { NativeReactFontSnapshot } from './nativeReactFonts';

export const NATIVE_REACT_EXPORT_LIMITS = {
  nodes: 20_000,
  images: 24 * 1024 * 1024,
  fonts: 64 * 1024 * 1024,
  wasm: 16 * 1024 * 1024,
  generatedCode: 128 * 1024 * 1024,
} as const;

const sizedStringKey = Symbol('sized-json-string');
type SizedJsonString = { [sizedStringKey]: number };
const sizedJsonString = (length: number): SizedJsonString => ({ [sizedStringKey]: length });

export function base64Length(byteLength: number): number {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new Error('Invalid native React resource length.');
  return Math.ceil(byteLength / 3) * 4;
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

function jsonStringLength(value: string): number {
  let bytes = 2;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) bytes += 2;
    else if (code < 0x20 || code === 0x3c || code === 0x2028 || code === 0x2029) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++; }
      else bytes += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else bytes += utf8Length(value[i]!);
  }
  return bytes;
}

export function measureJsonLiteralBytes(value: unknown): number {
  const active = new Set<object>();
  const measure = (item: unknown, arrayEntry = false): number => {
    if (item === null) return 4;
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') return arrayEntry ? 4 : 0;
    if (typeof item === 'string') return jsonStringLength(item);
    if (typeof item === 'boolean') return item ? 4 : 5;
    if (typeof item === 'number') return Number.isFinite(item) ? JSON.stringify(item)!.length : 4;
    if (typeof item === 'bigint') throw new Error('Native React data cannot contain BigInt values.');
    if (typeof item !== 'object') return 0;
    if (sizedStringKey in item) return (item as SizedJsonString)[sizedStringKey] + 2;
    if (active.has(item)) throw new Error('Native React data contains a cycle.');
    active.add(item);
    let bytes: number;
    if (Array.isArray(item)) {
      bytes = 2;
      for (let i = 0; i < item.length; i++) bytes += (i ? 1 : 0) + measure(item[i], true);
    } else {
      const entries = Object.entries(item).filter(([, entry]) => entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol');
      bytes = 2;
      entries.forEach(([key, entry], index) => { bytes += (index ? 1 : 0) + jsonStringLength(key) + 1 + measure(entry); });
    }
    active.delete(item);
    return bytes;
  };
  return measure(value);
}

export function assertNativeReactResourceBudgets(nodeCount: number, imageBytes: number, fontBytes: number, wasmBytes: number) {
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0 || nodeCount > NATIVE_REACT_EXPORT_LIMITS.nodes) throw new Error('This native React export exceeds 20,000 source layers.');
  if (!Number.isSafeInteger(imageBytes) || imageBytes < 0 || imageBytes > NATIVE_REACT_EXPORT_LIMITS.images) throw new Error('React export supports up to 24 MB of embedded images; export a smaller selection.');
  if (!Number.isSafeInteger(fontBytes) || fontBytes < 0 || fontBytes > NATIVE_REACT_EXPORT_LIMITS.fonts) throw new Error('Required font files exceed the 64MB native React export limit.');
  if (!Number.isSafeInteger(wasmBytes) || wasmBytes < 0 || wasmBytes > NATIVE_REACT_EXPORT_LIMITS.wasm) throw new Error('Invalid native renderer WASM asset.');
  return { nodeCount, imageBytes, fontBytes, wasmBytes, base64Bytes: base64Length(imageBytes) + base64Length(fontBytes) + base64Length(wasmBytes) };
}

export type NativeReactCodeBudgetInput = {
  componentName: string;
  valuesRuntime: string;
  designRuntime: string;
  protocol: string;
  routeRuntime: string;
  transitionRuntime: string;
  playbackRuntime: string;
  clientRuntime: string;
  nativeRuntime: string;
  worker: string;
  graph: string;
  ids: string[];
  rootId: string;
  fonts: NativeReactFontSnapshot;
  wasmBytes: number;
  model: { nodes: unknown[]; width: number; height: number; byteLength?: number; prototypeVariables?: unknown };
  assetCredits: unknown[];
};

export function estimateNativeReactCodeBytes(input: NativeReactCodeBudgetInput): number {
  const fontAsset = {
    ...input.fonts,
    registrations: input.fonts.registrations.map(registration => ({ ...registration, bytes: sizedJsonString(base64Length(registration.bytes.byteLength)) })),
  };
  const assetsAsset = { worker: input.worker, wasm: sizedJsonString(base64Length(input.wasmBytes)), graph: input.graph, ids: input.ids, rootId: input.rootId, fonts: fontAsset };
  const modelAsset = { nodes: input.model.nodes, width: input.model.width, height: input.model.height, ...(input.model.byteLength !== undefined ? { byteLength: input.model.byteLength } : {}), ...(input.model.prototypeVariables ? { prototypeVariables: input.model.prototypeVariables } : {}) };
  const prefix = '"use client";\n\n', join = '\n\n';
  const sources = [input.valuesRuntime, input.designRuntime, input.protocol, input.routeRuntime, input.transitionRuntime, input.playbackRuntime, input.clientRuntime, input.nativeRuntime];
  return utf8Length(prefix) + sources.reduce((total, source) => total + utf8Length(source) + utf8Length(join), 0)
    + utf8Length('export const designAssetCredits = ') + measureJsonLiteralBytes(input.assetCredits)
    + utf8Length(';\nconst nativeAssets = ') + measureJsonLiteralBytes(assetsAsset)
    + utf8Length(';\nconst initialModel: NativeReactModel = ') + measureJsonLiteralBytes(modelAsset)
    + utf8Length(`;\n\nexport default function ${input.componentName}(props: NativeReactProps) { return <NativeDesignView assets={nativeAssets} initialModel={initialModel} {...props}/>; }\n`);
}

export function assertNativeReactMinimumCodeBudget(input: Omit<NativeReactCodeBudgetInput, 'graph' | 'model' | 'assetCredits'>) {
  return assertNativeReactCodeBudget({ ...input, graph: '', model: { nodes: [], width: 0, height: 0 }, assetCredits: [] });
}

export function assertNativeReactCodeBudget(input: NativeReactCodeBudgetInput): number {
  const bytes = estimateNativeReactCodeBytes(input);
  if (!Number.isSafeInteger(bytes) || bytes > NATIVE_REACT_EXPORT_LIMITS.generatedCode) throw new Error('This native React export exceeds 128MB. Export a smaller selection.');
  return bytes;
}
