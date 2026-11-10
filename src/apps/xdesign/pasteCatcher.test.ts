import { afterEach, expect, it, vi } from "vitest";
import { catchPaste, clipboardImage } from "./pasteCatcher";

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

const host = () => { const element = document.createElement("section"), button = document.createElement("button"); element.append(button); document.body.append(element); button.focus(); return { element, button }; };
const pasteEvent = (files: File[]) => { const event = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { files } }); return event; };

it("hands the paste data to the caller, keeps it from bubbling and restores focus", () => {
  const { element, button } = host(), paste = vi.fn(), missing = vi.fn(), bubbled = vi.fn();
  element.addEventListener("paste", bubbled);
  catchPaste(element, paste, missing);
  const field = document.activeElement as HTMLTextAreaElement;
  expect(field.className).toBe("xd-paste-catcher");
  const image = new File([], "image.png", { type: "image/png" }), event = pasteEvent([new File([], "notes.txt", { type: "text/plain" }), image]);
  field.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(bubbled).not.toHaveBeenCalled();
  expect(clipboardImage(paste.mock.calls[0]![0])).toBe(image);
  expect(document.activeElement).toBe(button);
  expect(element.querySelector(".xd-paste-catcher")).toBeNull();
  expect(missing).not.toHaveBeenCalled();
});

it("falls back once when no paste event arrives", () => {
  vi.useFakeTimers();
  const { element, button } = host(), paste = vi.fn(), missing = vi.fn();
  catchPaste(element, paste, missing);
  vi.advanceTimersByTime(500);
  expect(missing).toHaveBeenCalledTimes(1);
  expect(paste).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(button);
  expect(element.querySelector(".xd-paste-catcher")).toBeNull();
});
