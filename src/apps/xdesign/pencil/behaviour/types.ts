import type { ComponentPropertyDefinition as NativeDefinition } from '@open-pencil/scene-graph';
export type ComponentPropertyDefinition = Omit<NativeDefinition,'type'> & { type: NativeDefinition['type'] | 'SLOT' };
