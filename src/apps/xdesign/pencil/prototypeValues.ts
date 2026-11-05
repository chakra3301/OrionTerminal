// Included in exported components; keep this module independent of the editor.
export type PrototypeColor = { r: number; g: number; b: number; a: number };
export type PrototypeValue = boolean | number | string | PrototypeColor;
export type PrototypeOperand = { type: 'literal'; value: PrototypeValue } | { type: 'variable'; id: string } | { type: 'expression'; operator: PrototypeOperator; arguments: PrototypeOperand[] };
export const PROTOTYPE_OPERATORS = ['ADDITION', 'SUBTRACTION', 'MULTIPLICATION', 'DIVISION', 'EQUALS', 'NOT_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'AND', 'OR', 'NOT', 'NEGATE'] as const;
export type PrototypeOperator = typeof PROTOTYPE_OPERATORS[number];
export type PrototypeVariables = {
  variables: { id: string; name: string; type: 'BOOLEAN' | 'FLOAT' | 'STRING' | 'COLOR'; collectionId: string; valuesByMode: Record<string, PrototypeValue | { aliasId: string }> }[];
  collections: { id: string; name: string; defaultModeId: string; modes: { modeId: string; name: string }[] }[];
  modes: Record<string, string>;
};
export type PrototypeSession = { values: Record<string, PrototypeValue>; modes: Record<string, string> };
export const emptyPrototypeSession = (): PrototypeSession => ({ values: {}, modes: {} });
const valueRecord = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export function validPrototypeValue(value: unknown): value is PrototypeValue {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 4096;
  const color = valueRecord(value);
  return !!color && ['r', 'g', 'b', 'a'].every(key => typeof color[key] === 'number' && Number.isFinite(color[key]) && Number(color[key]) >= 0 && Number(color[key]) <= 1);
}
export function parsePrototypeOperand(input: unknown, resolve: (id: string) => string = id => id): PrototypeOperand {
  let count = 0;
  const parse = (input: unknown, depth: number): PrototypeOperand => {
    if (++count > 256 || depth > 16) throw new Error('Use an expression with at most 256 operands and 16 levels.');
    const data = valueRecord(input);
    if (data?.type === 'literal' && validPrototypeValue(data.value)) return { type: 'literal', value: typeof data.value === 'object' ? { ...data.value } : data.value };
    if (data?.type === 'variable' && typeof data.id === 'string' && data.id && data.id.length <= 256) return { type: 'variable', id: resolve(data.id) };
    if (data?.type === 'expression' && PROTOTYPE_OPERATORS.includes(data.operator as PrototypeOperator) && Array.isArray(data.arguments) && data.arguments.length === (['NOT', 'NEGATE'].includes(String(data.operator)) ? 1 : 2)) return { type: 'expression', operator: data.operator as PrototypeOperator, arguments: data.arguments.map(value => parse(value, depth + 1)) };
    throw new Error('Choose a supported literal, variable or expression.');
  };
  return parse(input, 0);
}
export function mapPrototypeOperand(operand: PrototypeOperand, map: (id: string) => string): PrototypeOperand {
  return operand.type === 'variable' ? { ...operand, id: map(operand.id) } : operand.type === 'expression' ? { ...operand, arguments: operand.arguments.map(value => mapPrototypeOperand(value, map)) } : operand;
}
export function prototypeOperandIds(operand: PrototypeOperand): string[] {
  return operand.type === 'variable' ? [operand.id] : operand.type === 'expression' ? operand.arguments.flatMap(prototypeOperandIds) : [];
}
export function prototypeVariableValue(definitions: PrototypeVariables, session: PrototypeSession, id: string, inheritedModes: Record<string, string> = {}, seen = new Set<string>()): PrototypeValue {
  if (seen.has(id) || seen.size >= 256) throw new Error('A prototype variable alias is cyclic or too deeply nested.');
  seen.add(id);
  const variable = definitions.variables.find(variable => variable.id === id);
  if (!variable) throw new Error('A prototype variable is missing.');
  const collection = definitions.collections.find(collection => collection.id === variable.collectionId);
  if (!collection) throw new Error('A prototype variable collection is missing.');
  const ownMode = (modes: Record<string, string>) => Object.hasOwn(modes, collection.id) ? modes[collection.id] : undefined;
  const mode = ownMode(inheritedModes) ?? ownMode(session.modes) ?? ownMode(definitions.modes) ?? collection.defaultModeId;
  const value = Object.hasOwn(session.values, id) ? session.values[id] : variable.valuesByMode[mode] ?? variable.valuesByMode[collection.defaultModeId];
  if (value && typeof value === 'object' && 'aliasId' in value) {
    const aliased = prototypeVariableValue(definitions, session, value.aliasId, inheritedModes, seen);
    if (!prototypeValueMatches(variable.type, aliased)) throw new Error('A prototype alias has the wrong variable type.');
    return aliased;
  }
  if (!validPrototypeValue(value) || !prototypeValueMatches(variable.type, value)) throw new Error('A prototype variable has an invalid value.');
  return value;
}
export function prototypeValueMatches(type: string, value: PrototypeValue): boolean {
  return type === 'BOOLEAN' ? typeof value === 'boolean' : type === 'FLOAT' ? typeof value === 'number' : type === 'STRING' ? typeof value === 'string' : type === 'COLOR' && typeof value === 'object';
}
export function evaluatePrototypeOperand(operand: PrototypeOperand, definitions: PrototypeVariables, session: PrototypeSession): PrototypeValue {
  // Parse once before evaluating, including inactive operands, to bound authored input.
  const parsed = parsePrototypeOperand(operand);
  const evaluate = (operand: PrototypeOperand): PrototypeValue => {
    if (operand.type === 'literal') return operand.value;
    if (operand.type === 'variable') return prototypeVariableValue(definitions, session, operand.id);
    const operator = operand.operator, left = evaluate(operand.arguments[0]!);
    if (operator === 'NOT') { if (typeof left !== 'boolean') throw new Error('Not needs a boolean.'); return !left; }
    if (operator === 'NEGATE') { if (typeof left !== 'number') throw new Error('Negate needs a number.'); return -left; }
    if (operator === 'AND' || operator === 'OR') {
      if (typeof left !== 'boolean') throw new Error('Logical expressions need booleans.');
      if (operator === 'AND' && !left || operator === 'OR' && left) return left;
      const right = evaluate(operand.arguments[1]!); if (typeof right !== 'boolean') throw new Error('Logical expressions need booleans.'); return right;
    }
    const right = evaluate(operand.arguments[1]!);
    if (operator === 'EQUALS' || operator === 'NOT_EQUAL') {
      const equal = typeof left === 'object' && typeof right === 'object' ? ['r', 'g', 'b', 'a'].every(key => left[key as keyof PrototypeColor] === right[key as keyof PrototypeColor]) : left === right;
      return operator === 'EQUALS' ? equal : !equal;
    }
    if (operator === 'ADDITION' && typeof left === 'string' && typeof right === 'string') { const result = left + right; if (!validPrototypeValue(result)) throw new Error('Prototype strings support at most 4,096 characters.'); return result; }
    if (['LESS_THAN', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL'].includes(operator)) {
      if (!(typeof left === 'number' && typeof right === 'number' || typeof left === 'string' && typeof right === 'string')) throw new Error('Compare two numbers or two strings.');
      return operator === 'LESS_THAN' ? left < right : operator === 'LESS_THAN_OR_EQUAL' ? left <= right : operator === 'GREATER_THAN' ? left > right : left >= right;
    }
    if (typeof left !== 'number' || typeof right !== 'number') throw new Error('Arithmetic expressions need numbers.');
    const result = operator === 'ADDITION' ? left + right : operator === 'SUBTRACTION' ? left - right : operator === 'MULTIPLICATION' ? left * right : left / right;
    if (!Number.isFinite(result)) throw new Error('This prototype expression does not produce a finite number.');
    return result;
  };
  return evaluate(parsed);
}
export function assignPrototypeVariable(definitions: PrototypeVariables, session: PrototypeSession, id: string, operand: PrototypeOperand): PrototypeSession {
  const variable = definitions.variables.find(variable => variable.id === id);
  if (!variable) throw new Error('Choose an existing prototype variable.');
  const value = evaluatePrototypeOperand(operand, definitions, session);
  if (!prototypeValueMatches(variable.type, value)) throw new Error('The expression must match the assigned variable type.');
  return { ...session, values: { ...session.values, [id]: value } };
}
export function setPrototypeSessionMode(definitions: PrototypeVariables, session: PrototypeSession, collectionId: string, modeId: string): PrototypeSession {
  if (!definitions.collections.find(collection => collection.id === collectionId)?.modes.some(mode => mode.modeId === modeId)) throw new Error('Choose an existing mode in this collection.');
  return { ...session, modes: { ...session.modes, [collectionId]: modeId } };
}
