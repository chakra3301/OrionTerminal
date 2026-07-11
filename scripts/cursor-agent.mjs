#!/usr/bin/env node
/**
 * Headless Cursor SDK runner for Orion Terminal.
 * Reads one JSON config line on stdin, streams NDJSON events on stdout.
 *
 * Config: { apiKey, model, prompt, cwd, systemAppend?, agentId? }
 * Events: { type:"sdk", message } | { type:"agent", agentId } | { type:"fatal", message }
 */

import { Agent, Cursor, CursorAgentError } from "@cursor/sdk";

// When stdout is piped to Tauri, force line delivery so events stream live.
if (process.stdout.isTTY === false && process.stdout._handle?.setBlocking) {
  process.stdout._handle.setBlocking(true);
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function assistantHasText(message) {
  if (message?.type !== "assistant") return false;
  const blocks = message.message?.content;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((b) => b?.type === "text" && String(b.text ?? "").trim());
}

function fullPrompt(prompt, systemAppend) {
  if (!systemAppend?.trim()) return prompt;
  return `[System instructions]\n${systemAppend.trim()}\n\n${prompt}`;
}

async function probe(apiKey) {
  try {
    await Cursor.me({ apiKey });
    emit({ type: "probe", ok: true });
    process.exit(0);
  } catch (err) {
    emit({
      type: "probe",
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

async function run(config) {
  const { apiKey, model, prompt, cwd, systemAppend, agentId } = config;
  if (!apiKey?.trim()) throw new Error("apiKey is required");
  if (!prompt?.trim()) throw new Error("prompt is required");

  const opts = {
    apiKey: apiKey.trim(),
    model: { id: model || "composer-2.5" },
    local: { cwd: cwd || process.cwd(), settingSources: [] },
  };

  const agent = agentId?.trim()
    ? await Agent.resume(agentId.trim(), opts)
    : await Agent.create(opts);

  emit({ type: "agent", agentId: agent.agentId });
  emit({ type: "progress", phase: "send" });

  try {
    const run = await agent.send(fullPrompt(prompt, systemAppend));
    let sawAssistantText = false;
    for await (const message of run.stream()) {
      emit({ type: "sdk", message });
      if (assistantHasText(message)) sawAssistantText = true;
    }
    const result = await run.wait();
    // Some runs only surface the final answer on RunResult, not in stream().
    if (!sawAssistantText && result.result?.trim()) {
      emit({
        type: "sdk",
        message: {
          type: "assistant",
          agent_id: agent.agentId,
          run_id: result.id,
          message: {
            role: "assistant",
            content: [{ type: "text", text: result.result.trim() }],
          },
        },
      });
    }
    emit({ type: "result", status: result.status, agentId: agent.agentId, runId: result.id });
    if (result.status === "error") {
      const msg = result.result?.trim() || "run failed";
      emit({ type: "fatal", message: msg });
      process.exitCode = 2;
    }
  } finally {
    await agent.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--probe") {
    const key = args[1] || process.env.CURSOR_API_KEY;
    if (!key) {
      emit({ type: "probe", ok: false, message: "no api key" });
      process.exit(1);
    }
    await probe(key);
    return;
  }

  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const config = JSON.parse(raw || "{}");
  // Mirror Node/SDK stderr into the bridge stream so Tauri can surface it.
  const origErr = console.error;
  console.error = (...args) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    emit({ type: "stderr", text });
    origErr.apply(console, args);
  };

  try {
    await run(config);
  } catch (err) {
    const message =
      err instanceof CursorAgentError
        ? `${err.message} (retryable=${err.isRetryable})`
        : err instanceof Error
          ? err.message
          : String(err);
    emit({ type: "fatal", message });
    process.exit(1);
  }
}

await main();
