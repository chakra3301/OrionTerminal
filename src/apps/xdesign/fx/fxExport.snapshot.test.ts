import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ dispose: vi.fn(), loseContext: vi.fn() }));
vi.mock("./compositor", () => ({ createCompositor: () => ({ render: vi.fn(), updateSource: vi.fn(), dropSource: vi.fn(), dispose: m.dispose }) }));
import { renderFxSnapshot } from "./fxExport";
import { emptyFxDoc } from "./fxStore";

afterEach(() => { vi.restoreAllMocks(); m.dispose.mockClear(); m.loseContext.mockClear(); });

it("gives its WebGL context back after each snapshot, so repeated captures can't push out the editor's", async () => {
  const gl = { getExtension: (name: string) => name === "WEBGL_lose_context" ? { loseContext: m.loseContext } : null };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(new Blob()));
  expect(await renderFxSnapshot({ ...emptyFxDoc().scene, layers: [] }, 0, 64, 36)).toBeInstanceOf(Blob);
  expect(m.dispose).toHaveBeenCalledTimes(1);
  expect(m.loseContext).toHaveBeenCalledTimes(1);
  expect(m.dispose.mock.invocationCallOrder[0]).toBeLessThan(m.loseContext.mock.invocationCallOrder[0]!);
});
