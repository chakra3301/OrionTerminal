import { parsePrototypeOperand, prototypeValueMatches, type PrototypeOperand } from './prototypeValues';
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const guid = (value: unknown): string | undefined => { const data = object(value); if (data && Number.isInteger(data.sessionID) && Number.isInteger(data.localID) && Number(data.sessionID) >= 0 && Number(data.localID) >= 0 && Number(data.sessionID) <= 0xffffffff && Number(data.localID) <= 0xffffffff) return `${data.sessionID}:${data.localID}`; };
export function nativePrototypeReference(value: unknown): string {
  const id = guid(value) ?? guid(object(value)?.guid);
  if (!id || object(value)?.assetRef) throw new Error('this external or missing variable reference');
  return id;
}
export function readNativePrototypeOperand(input: unknown, resolve: (id: string) => string): PrototypeOperand {
  let count = 0;
  const read = (input: unknown, depth: number): PrototypeOperand => {
    if (++count > 256 || depth > 16) throw new Error('an excessive variable expression');
    const data = object(input), value = object(data?.value);
    if (!data || !value) throw new Error('this variable value');
    if (data.dataType === 'ALIAS') return { type: 'variable', id: resolve(nativePrototypeReference(value.alias)) };
    if (data.dataType === 'EXPRESSION') {
      const expression = object(value.expressionValue), operator = expression?.expressionFunction;
      if (!Array.isArray(expression?.expressionArguments)) throw new Error('this variable expression');
      return { type: 'expression', operator: (operator === 'MULTIPLY' ? 'MULTIPLICATION' : operator === 'DIVIDE' ? 'DIVISION' : operator) as Extract<PrototypeOperand, { type: 'expression' }>['operator'], arguments: expression.expressionArguments.map(value => read(value, depth + 1)) };
    }
    const field = { BOOLEAN: 'boolValue', FLOAT: 'floatValue', STRING: 'textValue', COLOR: 'colorValue' }[String(data.dataType)];
    if (!field || !(field in value) || !prototypeValueMatches(String(data.dataType), value[field] as never)) throw new Error('this variable type');
    return { type: 'literal', value: value[field] as Extract<PrototypeOperand, { type: 'literal' }>['value'] };
  };
  try { return parsePrototypeOperand(read(input, 0)); } catch (error) { throw new Error(error instanceof Error ? error.message : 'this variable expression'); }
}
export function writeNativePrototypeOperand(input: PrototypeOperand, destination: (id: string) => { sessionID: number; localID: number }, type: (id: string) => string): Record<string, unknown> {
  if (input.type === 'variable') return { dataType: 'ALIAS', resolvedDataType: type(input.id), value: { alias: { guid: destination(input.id) } } };
  if (input.type === 'expression') return { dataType: 'EXPRESSION', value: { expressionValue: { expressionFunction: input.operator === 'MULTIPLICATION' ? 'MULTIPLY' : input.operator === 'DIVISION' ? 'DIVIDE' : input.operator, expressionArguments: input.arguments.map(value => writeNativePrototypeOperand(value, destination, type)) } } };
  const value = input.value, dataType = typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'number' ? 'FLOAT' : typeof value === 'string' ? 'STRING' : 'COLOR';
  return { dataType, resolvedDataType: dataType, value: { [dataType === 'BOOLEAN' ? 'boolValue' : dataType === 'FLOAT' ? 'floatValue' : dataType === 'STRING' ? 'textValue' : 'colorValue']: value } };
}
