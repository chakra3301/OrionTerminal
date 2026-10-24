import { expect, it } from 'vitest';
import { assignPrototypeVariable, emptyPrototypeSession, evaluatePrototypeOperand, parsePrototypeOperand, prototypeVariableValue, setPrototypeSessionMode, type PrototypeOperand, type PrototypeVariables } from './prototypeValues';
import { executeDesignActions, allDesignActions, mapDesignActions, type DesignNavigation } from './reactExportRuntime';
const literal = (value: number | boolean | string): PrototypeOperand => ({ type: 'literal', value });
const variable = (id = 'count'): PrototypeOperand => ({ type: 'variable', id });
const expression = (operator: Extract<PrototypeOperand, { type: 'expression' }>['operator'], ...args: PrototypeOperand[]): PrototypeOperand => ({ type: 'expression', operator, arguments: args });
const definitions: PrototypeVariables = { modes: {}, collections: [{ id: 'theme', name: 'Theme', defaultModeId: 'light', modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }] }, { id: 'other', name: 'Other', defaultModeId: 'other-mode', modes: [{ modeId: 'other-mode', name: 'Default' }] }], variables: [
  { id: 'count', name: 'Count', type: 'FLOAT', collectionId: 'theme', valuesByMode: { light: 0, dark: 10 } },
  { id: 'show', name: 'Show', type: 'BOOLEAN', collectionId: 'theme', valuesByMode: { light: false, dark: true } },
  { id: 'alias', name: 'Alias', type: 'FLOAT', collectionId: 'other', valuesByMode: { 'other-mode': { aliasId: 'count' } } },
] };
const action = (patch: Partial<DesignNavigation>): DesignNavigation => ({ action: 'back', transition: 'instant', duration: 0, ...patch });
it('uses each alias collection mode, inherits node modes and preserves assignments across page mode switches', () => {
  const session = setPrototypeSessionMode(definitions, emptyPrototypeSession(), 'theme', 'dark'); expect(prototypeVariableValue(definitions, session, 'alias')).toBe(10); expect(prototypeVariableValue(definitions, session, 'alias', { theme: 'light' })).toBe(0);
  const assigned = assignPrototypeVariable(definitions, session, 'count', literal(3)); expect(prototypeVariableValue(definitions, setPrototypeSessionMode(definitions, assigned, 'theme', 'light'), 'alias')).toBe(3); expect(definitions.variables[0]!.valuesByMode.dark).toBe(10);
});
it.each([
  ['ADDITION', 3, 2, 5], ['SUBTRACTION', 3, 2, 1], ['MULTIPLICATION', 3, 2, 6], ['DIVISION', 3, 2, 1.5], ['EQUALS', 3, 3, true], ['NOT_EQUAL', 3, 2, true], ['LESS_THAN', 2, 3, true], ['LESS_THAN_OR_EQUAL', 3, 3, true], ['GREATER_THAN', 3, 2, true], ['GREATER_THAN_OR_EQUAL', 3, 3, true], ['AND', true, false, false], ['OR', false, true, true], ['ADDITION', 'hello ', 'there', 'hello there'],
] as const)('evaluates %s with typed operands', (operator, left, right, expected) => { expect(evaluatePrototypeOperand(expression(operator, literal(left), literal(right)), definitions, emptyPrototypeSession())).toBe(expected); });
it('supports unary operations and lazy boolean operands without evaluating an inactive missing variable', () => {
  expect(evaluatePrototypeOperand(expression('NOT', literal(false)), definitions, emptyPrototypeSession())).toBe(true); expect(evaluatePrototypeOperand(expression('NEGATE', literal(2)), definitions, emptyPrototypeSession())).toBe(-2);
  expect(evaluatePrototypeOperand(expression('AND', literal(false), variable('missing')), definitions, emptyPrototypeSession())).toBe(false); expect(evaluatePrototypeOperand(expression('OR', literal(true), variable('missing')), definitions, emptyPrototypeSession())).toBe(true);
});
it('rejects invalid arity, nonfinite arithmetic, wrong assignment types, unknown modes and alias cycles', () => {
  expect(() => parsePrototypeOperand(expression('NOT', literal(true), literal(false)))).toThrow(); expect(() => evaluatePrototypeOperand(expression('DIVISION', literal(1), literal(0)), definitions, emptyPrototypeSession())).toThrow('finite'); expect(() => assignPrototypeVariable(definitions, emptyPrototypeSession(), 'show', literal(1))).toThrow('type'); expect(() => setPrototypeSessionMode(definitions, emptyPrototypeSession(), 'theme', 'other-mode')).toThrow('mode');
  const cyclic = structuredClone(definitions); cyclic.variables[0]!.valuesByMode.light = { aliasId: 'alias' }; expect(() => prototypeVariableValue(cyclic, emptyPrototypeSession(), 'count')).toThrow('cyclic');
});
it('bounds expression depth, total actions and conditional depth including inactive branches', () => {
  let operand = literal(1); for (let index = 0; index < 17; index++) operand = expression('NEGATE', operand); expect(() => parsePrototypeOperand(operand)).toThrow('16 levels');
  const tooMany = action({ action: 'conditional', branches: [{ condition: literal(false), actions: Array.from({ length: 64 }, () => action({})) }] }); expect(() => allDesignActions(tooMany)).toThrow('64');
  let tree = action({}); for (let index = 0; index < 10; index++) tree = action({ action: 'conditional', branches: [{ actions: [tree] }] }); expect(() => allDesignActions(tree)).toThrow('eight');
});
it('executes only the first matching branch using the preceding assignment, then continues the outer sequence', async () => {
  let session = emptyPrototypeSession(); const played: string[] = [];
  const link = action({ action: 'sequence', actions: [action({ action: 'set-variable', variable: 'count', value: expression('ADDITION', variable(), literal(1)) }), action({ action: 'conditional', branches: [{ condition: expression('EQUALS', variable(), literal(1)), actions: [action({ action: 'set-mode', collection: 'theme', mode: 'dark' }), action({ action: 'navigate', target: 'first' })] }, { condition: literal(true), actions: [action({ action: 'navigate', target: 'second' })] }, { actions: [action({ action: 'navigate', target: 'else' })] }] }), action({ action: 'back' })] });
  expect(await executeDesignActions(link, definitions, () => session, async next => { session = next; return true; }, async action => { played.push(action.target ?? action.action); return true; }, () => true)).toBe(true); expect(played).toEqual(['first', 'back']); expect(session.values.count).toBe(1); expect(session.modes.theme).toBe('dark');
  const mapped = mapDesignActions(link, action => ({ ...action, ...(action.target ? { target: `copy:${action.target}` } : {}) })); expect(allDesignActions(mapped).filter(action => action.target).map(action => action.target)).toEqual(['copy:first', 'copy:second', 'copy:else']);
});
it('stops a branch and the outer sequence after cancellation or a declined action', async () => {
  const link = action({ action: 'conditional', branches: [{ actions: [action({ action: 'navigate', target: 'first' }), action({ action: 'back' })] }] }); const played: string[] = [];
  expect(await executeDesignActions(link, definitions, emptyPrototypeSession, async () => true, async action => { played.push(action.action); return false; }, () => true)).toBe(false); expect(played).toEqual(['navigate']);
});
