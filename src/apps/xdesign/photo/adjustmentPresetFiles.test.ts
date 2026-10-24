import { describe, expect, it } from "vitest";
import { decodeAdjustmentPreset, encodeAdjustmentPreset, PRESET_FILE_TYPES } from "./adjustmentPresetFiles";

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map(pair => parseInt(pair, 16)));
const identityRecord = "000000ff000000ff0064";
// Bytes of files shipped with Photoshop 2026 (Levels is truncated to the four used records; the rest are identity).
const SHIPPED = {
  levels: "0002001400eb000000ff0064000000ff000000ff0064000000ff000000ff0064000000ff000000ff0064" + identityRecord.repeat(25),
  hueSaturation: "00020100ff6f00190000000000000000013b0159000f002d000000000000000f002d004b0069000000000000004b0069008700a5000000000000008700a500c300e100000000000000c300e100ff011d00000000000000ff011d013b0159000000000000",
  channelMixer: "0001000100640000000000000000000000000000000000000000000000000000000000000000000000000000",
  blackWhite: "00000010000000010000000000006e756c6c0000000a00000000526420206c6f6e67ffffffd800000000596c6c776c6f6e67000000eb0000000047726e206c6f6e67000000900000000043796e206c6f6e67ffffffbc00000000426c20206c6f6e67fffffffd000000004d676e746c6f6e67ffffff950000000775736554696e74626f6f6c000000000974696e74436f6c6f724f626a630000000100000000000052474243000000030000000052642020646f7562406c1fc03fc03fc00000000047726e20646f7562406a5fc03fc03fc000000000426c2020646f756240665fc03fc03fc00000000c62775072657365744b696e646c6f6e67000000030000001b626c61636b416e64576869746550726573657446696c654e616d6554455854000000010000",
  exposure: "00013f800000000000003f800000",
  curves: "000400050003000000000065008200ff00ff00020000000000ff00ff00020000000000ff00ff00020000000000ff00ff00020000000000ff00ff",
};

const tone = (inBlack: number, inWhite: number, gamma = 1) => ({ inBlack, inWhite, outBlack: 0, outWhite: 255, gamma });
const hue = (index: number) => ({ hue: index, saturation: -index || 0, lightness: index * 2, range: [-45, -15, 15, 45].map(value => value + index * 60) });
const SAMPLES: Record<string, Record<string, unknown>> = {
  levels: { ...tone(10, 240, 1.25), red: tone(5, 250, 0.8), green: tone(0, 255), blue: tone(20, 200, 2.5) },
  curves: { points: [[0, 0], [64, 40], [200, 220], [255, 255]], red: [[0, 10], [255, 245]], green: [[0, 0], [255, 255]], blue: [[0, 255], [255, 0]] },
  exposure: { exposure: 1.5, offset: -0.25, gamma: 2 },
  hueSaturation: { colorize: false, hue: -30, saturation: 40, lightness: -10, reds: hue(0), yellows: hue(1), greens: hue(2), cyans: hue(3), blues: hue(4), magentas: hue(5) },
  blackWhite: { reds: -40, yellows: 235, greens: 144, cyans: -68, blues: -3, magentas: -107, tint: true, tintColor: "#e1d3b3" },
  channelMixer: { monochrome: false, red: [100, 20, -10, 5], green: [0, 100, 0, 0], blue: [-30, 0, 130, -7] },
  selectiveColor: { method: "absolute", reds: [10, -20, 30, -40], yellows: [0, 0, 0, 0], greens: [1, 2, 3, 4], cyans: [0, 0, 0, 0], blues: [0, 0, 0, 0], magentas: [0, 0, 0, 0], whites: [-100, 100, 0, 0], neutrals: [5, 5, 5, 5], blacks: [0, 0, 0, 50] },
};

describe("adjustment preset files", () => {
  it("declares Photoshop's extension for every kind", () => {
    expect(Object.keys(PRESET_FILE_TYPES).sort()).toEqual(Object.keys(SAMPLES).sort());
    expect(PRESET_FILE_TYPES.levels).toEqual({ extension: "alv", name: "Levels Presets" });
    expect(PRESET_FILE_TYPES.selectiveColor?.extension).toBe("asv");
  });

  it.each(Object.keys(SAMPLES))("round-trips %s", kind => {
    const encoded = encodeAdjustmentPreset(kind, SAMPLES[kind]!, "RGB");
    expect(decodeAdjustmentPreset(kind, encoded, "RGB")).toEqual(SAMPLES[kind]!);
  });

  it("writes Photoshop's fixed sizes", () => {
    expect(encodeAdjustmentPreset("levels", SAMPLES.levels!, "RGB").length).toBe(2 + 29 * 10);
    expect(encodeAdjustmentPreset("channelMixer", SAMPLES.channelMixer!, "RGB").length).toBe(44);
    expect(encodeAdjustmentPreset("selectiveColor", SAMPLES.selectiveColor!, "RGB").length).toBe(84);
    expect(encodeAdjustmentPreset("exposure", SAMPLES.exposure!, "RGB").length).toBe(14);
  });

  it("writes the shipped curves layout: composite, R, G, B and an unused identity curve", () => {
    const out = encodeAdjustmentPreset("curves", { points: [[0, 0], [130, 101], [255, 255]] }, "RGB");
    expect(out).toEqual(bytes(SHIPPED.curves));
  });

  it("round-trips CMYK and Lab channels", () => {
    const cmyk = { ...tone(0, 255), cyan: tone(1, 250), magenta: tone(0, 255), yellow: tone(0, 255), black: tone(9, 200, 1.5) };
    expect(decodeAdjustmentPreset("levels", encodeAdjustmentPreset("levels", cmyk, "CMYK"), "CMYK")).toEqual(cmyk);
    const lab = { points: [[0, 0], [255, 255]], lightness: [[0, 5], [255, 250]], a: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
    expect(decodeAdjustmentPreset("curves", encodeAdjustmentPreset("curves", lab, "Lab"), "Lab")).toEqual(lab);
  });

  it("decodes shipped Levels 'Increase Contrast 2'", () => {
    const values = decodeAdjustmentPreset("levels", bytes(SHIPPED.levels), "RGB");
    expect(values).toMatchObject({ inBlack: 20, inWhite: 235, gamma: 1, red: tone(0, 255), blue: tone(0, 255) });
  });

  it("decodes shipped Curves 'Darker'", () => {
    expect(decodeAdjustmentPreset("curves", bytes(SHIPPED.curves), "RGB")).toMatchObject({ points: [[0, 0], [130, 101], [255, 255]], red: [[0, 0], [255, 255]] });
  });

  it("decodes shipped Exposure 'Plus 1.0'", () => {
    expect(decodeAdjustmentPreset("exposure", bytes(SHIPPED.exposure), "RGB")).toEqual({ exposure: 1, offset: 0, gamma: 1 });
  });

  it("decodes shipped Hue/Saturation 'Cyanotype' with the colorize hue wrapped to 0..360", () => {
    const values = decodeAdjustmentPreset("hueSaturation", bytes(SHIPPED.hueSaturation), "RGB");
    expect(values).toMatchObject({ colorize: true, hue: 215, saturation: 25, lightness: 0 });
    expect(values.reds).toMatchObject({ range: [-45, -15, 15, 45] });
    expect(values.magentas).toMatchObject({ range: [255, 285, 315, 345] });
    expect(values.cyans).toMatchObject({ range: [135, 165, 195, 225] });
  });

  it("writes a colorize hue back as Photoshop's -180..180", () => {
    const out = encodeAdjustmentPreset("hueSaturation", decodeAdjustmentPreset("hueSaturation", bytes(SHIPPED.hueSaturation), "RGB"), "RGB");
    expect(out.slice(0, 10)).toEqual(bytes(SHIPPED.hueSaturation).slice(0, 10));
    expect(out.slice(16)).toEqual(bytes(SHIPPED.hueSaturation).slice(16));
  });

  it("decodes shipped Channel Mixer 'Black & White with Red Filter'", () => {
    expect(decodeAdjustmentPreset("channelMixer", bytes(SHIPPED.channelMixer), "RGB")).toEqual({ monochrome: true, gray: [100, 0, 0, 0] });
  });

  it("decodes shipped Black & White 'Infrared'", () => {
    expect(decodeAdjustmentPreset("blackWhite", bytes(SHIPPED.blackWhite), "RGB")).toEqual({
      reds: -40, yellows: 235, greens: 144, cyans: -68, blues: -3, magentas: -107, tint: false, tintColor: "#e1d3b3",
    });
  });

  it("clamps out-of-range values", () => {
    const out = encodeAdjustmentPreset("exposure", { exposure: 99, offset: 9, gamma: 0 }, "RGB");
    expect(decodeAdjustmentPreset("exposure", out, "RGB")).toEqual({ exposure: 20, offset: 0.5, gamma: 0.01 });
  });

  it.each(Object.keys(SAMPLES))("rejects malformed %s data", kind => {
    expect(() => decodeAdjustmentPreset(kind, new Uint8Array(), "RGB")).toThrow(/^This is not a .* preset file\.$/);
    expect(() => decodeAdjustmentPreset(kind, bytes("ffff0000"), "RGB")).toThrow(/^This is not a .* preset file\.$/);
  });

  it("names the adjustment in the message and rejects unknown kinds", () => {
    expect(() => decodeAdjustmentPreset("levels", new Uint8Array(), "RGB")).toThrow("This is not a Levels preset file.");
    expect(() => decodeAdjustmentPreset("invert", new Uint8Array(), "RGB")).toThrow("Presets are not supported");
    expect(() => encodeAdjustmentPreset("invert", {}, "RGB")).toThrow("Presets are not supported");
  });
});
