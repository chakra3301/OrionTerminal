import { writeFigArchive, type FigParseResult } from '@open-pencil/fig';
import { ByteBuffer, compileSchema, decodeBinarySchema } from '@open-pencil/kiwi/schema-runtime';
import { inflateSync } from 'fflate';

export function encodeFigArchive(parsed: FigParseResult): Uint8Array {
  const schema = compileSchema(decodeBinarySchema(new ByteBuffer(inflateSync(parsed.figSchemaDeflated)))) as { encodeMessage(message: unknown): Uint8Array };
  return writeFigArchive({ schemaDeflated: parsed.figSchemaDeflated, kiwiData: schema.encodeMessage({ type: 'NODE_CHANGES', nodeChanges: parsed.nodeChanges, blobs: parsed.blobs.map(bytes => ({ bytes })) }), thumbnailPNG: parsed.thumbnailPNG ?? new Uint8Array(), metaJSON: parsed.metaJSON ?? '{}', images: parsed.images.map(([hash, data]) => ({ name: `images/${hash}`, data })), figKiwiVersion: parsed.figKiwiVersion });
}
