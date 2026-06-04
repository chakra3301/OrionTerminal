export const orionClaude = {
  name: "Orix47",
  subtitle: "subscription · Claude CLI",
  accentColor: "var(--neon-cyan)",
  systemPrompt:
    "You are Claude embedded inside Orion, an AI-first code editor. You have " +
    "read-access to the file being edited. Help the user write, refactor, and explain " +
    "code. Reply concisely. Reference code by line or symbol when relevant.",
  openingLine:
    "I see Orion wires the file tree, editor, and visualizer in one workspace. " +
    "Want me to extract the layout into a Workspace component, or keep it inline?",
  suggestionChips: [
    "Explain this file",
    "Refactor useClaude hook",
    "Add tests",
    "Fix the warning",
  ],
};
