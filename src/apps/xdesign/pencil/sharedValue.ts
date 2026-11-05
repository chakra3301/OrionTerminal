const MAX_VALUE_UNITS = 24 * 1024 * 1024;
const MAX_DEPTH = 128;
const arrays = { Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array };
type Wire = null | boolean | string | number | [string, unknown];

export function encodeSharedValue(value: unknown): string {
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): Wire {
    if (depth > MAX_DEPTH) throw new Error('Shared design value is too deeply nested.');
    if (item === undefined) return ['undefined', null];
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return Object.is(item, -0) ? ['negative-zero', null] : item;
    if (typeof item !== 'object' || !item || seen.has(item)) throw new Error('Unsupported shared design value.');
    seen.add(item);
    let result: Wire;
    if (Array.isArray(item)) result = ['array', item.map(value => visit(value, depth + 1))];
    else if (item instanceof Map) result = ['map', [...item].map(([key, value]) => [visit(key, depth + 1), visit(value, depth + 1)])];
    else if (item instanceof Set) result = ['set', [...item].map(value => visit(value, depth + 1))];
    else if (ArrayBuffer.isView(item) && !(item instanceof DataView) && Object.hasOwn(arrays, item.constructor.name)) {
      if (!Array.from(item as unknown as ArrayLike<number>).every(Number.isFinite)) throw new Error('Invalid shared binary numbers.');
      const bytes = new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      result = [item.constructor.name, btoa(binary)];
    } else if (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) {
      result = ['object', Object.keys(item).sort().map(key => [key, visit((item as Record<string, unknown>)[key], depth + 1)])];
    } else throw new Error('Unsupported shared design object.');
    seen.delete(item);
    return result;
  }
  const encoded = JSON.stringify(visit(value, 0));
  if (encoded.length > MAX_VALUE_UNITS) throw new Error('Shared design value exceeds its size limit.');
  return encoded;
}

export function decodeSharedValue(encoded: unknown): unknown {
  if (typeof encoded !== 'string' || encoded.length > MAX_VALUE_UNITS) throw new Error('Invalid shared design value.');
  function visit(item: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) throw new Error('Shared design value is too deeply nested.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string') throw new Error('Invalid shared design encoding.');
    const [tag, values] = item;
    if (tag === 'undefined' && values === null) return undefined;
    if (tag === 'negative-zero' && values === null) return -0;
    const ctor = arrays[tag as keyof typeof arrays];
    if (Object.hasOwn(arrays, tag) && ctor && typeof values === 'string') {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(values)) throw new Error('Invalid shared binary data.');
      const bytes = Uint8Array.from(atob(values), char => char.charCodeAt(0));
      if (bytes.byteLength % ctor.BYTES_PER_ELEMENT) throw new Error('Invalid shared binary alignment.');
      const result = new ctor(bytes.buffer);
      if (![...result].every(Number.isFinite)) throw new Error('Invalid shared binary numbers.');
      return result;
    }
    if (!Array.isArray(values)) throw new Error('Invalid shared design container.');
    if (tag === 'array') return values.map(value => visit(value, depth + 1));
    if (tag === 'set') return new Set(values.map(value => visit(value, depth + 1)));
    if (tag === 'map' || tag === 'object') {
      const result = tag === 'map' ? new Map<unknown, unknown>() : {} as Record<string, unknown>;
      for (const pair of values) {
        if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Invalid shared design entry.');
        const key = tag === 'map' ? visit(pair[0], depth + 1) : pair[0], value = visit(pair[1], depth + 1);
        if (result instanceof Map) {
          if (result.has(key)) throw new Error('Duplicate shared map entry.');
          result.set(key, value);
        } else {
          if (typeof key !== 'string' || Object.hasOwn(result, key)) throw new Error('Invalid shared object key.');
          Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
        }
      }
      return result;
    }
    throw new Error('Unsupported shared design encoding.');
  }
  return visit(JSON.parse(encoded), 0);
}
