// @vitest-environment node
import { expect, it } from "vitest";
import { CompanionRequestReactions, type CompanionRequestState } from "./companionRequests";

const idle: CompanionRequestState = { threadId: "thread", running: false, error: null, messages: [] };
const result = (text: string): CompanionRequestState => ({ ...idle, messages: [{ id: "reply", role: "assistant", content: text, pending: false }] });

it("adds pointing on start and clapping once on successful completion", () => {
  const reactions = new CompanionRequestReactions(idle);
  expect(reactions.observe({ ...idle, running: true })).toEqual(["Kneeling Pointing"]);
  expect(reactions.observe(result("Finished the requested changes."))).toEqual(["Clapping"]);
  expect(reactions.observe(result("Finished the requested changes."))).toEqual([]);
});

it("preserves Angry and adds Rejected on errors without double-triggering at exit", () => {
  const reactions = new CompanionRequestReactions({ ...idle, running: true });
  expect(reactions.observe({ ...idle, running: true, error: "Request failed" })).toEqual(["Angry", "Rejected"]);
  expect(reactions.observe({ ...idle, error: "Request failed" })).toEqual([]);
});

it("reacts to a refusal and a request for input, including structured assistant text", () => {
  const reactions = new CompanionRequestReactions({ ...idle, running: true });
  expect(reactions.observe(result("I cannot help with that request."))).toEqual(["Rejected"]);
  reactions.observe({ ...idle, running: true });
  expect(reactions.observe({ ...idle, messages: [{ id: "reply", role: "assistant", content: [{ type: "text", text: "Which option should I use?" }] }] })).toEqual(["Surprised"]);
});

it("uses the final outcome after recovering from an intermediate denied operation", () => {
  const reactions = new CompanionRequestReactions({ ...idle, running: true });
  expect(reactions.observe({ ...idle, messages: [{ id: "reply", role: "assistant", content: [
    { type: "text", text: "Access denied. I will try the available path." },
    { type: "text", text: "Saved successfully." },
  ] }] })).toEqual(["Clapping"]);
});

it("does not celebrate a canceled request, old thread load, or empty tool-only turn", () => {
  const reactions = new CompanionRequestReactions({ ...idle, running: true });
  expect(reactions.observe({ ...idle, messages: [{ id: "pending", role: "assistant", content: "partial", pending: true }] })).toEqual([]);
  reactions.observe({ ...idle, running: true });
  expect(reactions.observe({ ...result("Old reply"), threadId: "old-thread" })).toEqual([]);
  reactions.observe({ ...idle, running: true });
  expect(reactions.observe(idle)).toEqual([]);
});
