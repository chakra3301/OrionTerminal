import type { Editor } from "@open-pencil/core/editor";
import { resolveVariable } from "@open-pencil/scene-graph/variables";
import type { SceneGraph, Variable, VariableValue } from "@open-pencil/scene-graph";

const isAlias = (value: VariableValue | undefined): value is { aliasId: string } =>
  !!value && typeof value === "object" && "aliasId" in value;

/** Check every mode so switching themes cannot introduce a reference cycle. */
export function validateVariableAlias(graph: SceneGraph, variable: Variable, targetId: string) {
  const target = graph.variables.get(targetId);
  if (!target) throw new Error("The referenced variable no longer exists");
  if (target.type !== variable.type) throw new Error("Variable aliases must have the same type");
  const pending = [targetId], visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === variable.id) throw new Error("This alias would create a circular variable reference");
    if (visited.has(id)) continue;
    visited.add(id);
    const next = graph.variables.get(id);
    if (next) for (const value of Object.values(next.valuesByMode)) if (isAlias(value)) pending.push(value.aliasId);
  }
}

export function setVariableAlias(editor: Editor, variableId: string, modeId: string, targetId: string | null) {
  const variable = editor.graph.variables.get(variableId);
  if (!variable || !editor.graph.variableCollections.get(variable.collectionId)?.modes.some(mode => mode.modeId === modeId)) throw new Error("Select an existing variable and mode");
  if (targetId) {
    validateVariableAlias(editor.graph, variable, targetId);
    editor.updateVariableValue(variableId, modeId, { aliasId: targetId });
  } else if (isAlias(variable.valuesByMode[modeId])) {
    const resolved = resolveVariable(editor.graph, variableId, modeId);
    const fallback = variable.type === "COLOR" ? { r: 0, g: 0, b: 0, a: 1 } : variable.type === "FLOAT" ? 0 : variable.type === "BOOLEAN" ? false : "";
    editor.updateVariableValue(variableId, modeId, resolved ?? fallback);
  }
}
