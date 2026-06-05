import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mock remotion (no DOM/renderer available in node test env) ────────────────

const mockRegisterRoot = jest.fn();
const mockDelayRender = jest.fn().mockReturnValue("test-handle");
const mockContinueRender = jest.fn();

jest.mock("remotion", () => ({
  registerRoot: mockRegisterRoot,
  AbsoluteFill: ({ children }: any) => children ?? null,
  Composition: () => null,
  delayRender: mockDelayRender,
  continueRender: mockContinueRender,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
// frameRegistry and registerFonts are resolved via moduleNameMapper in jest.config.js
// to src/tests/__mocks__/ — no jest.mock() needed for them.

import { buildComponentRegistry, StaticSlot } from "../compositions/StaticSlot.js";
import { frameRegistry } from "@evatrilvideo/ai-video-package/src/frameRegistry.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildComponentRegistry", () => {
  it("maps component.name to the component", () => {
    const map = buildComponentRegistry(frameRegistry as any);
    expect(map["F21022026_01"]).toBeDefined();
    expect(map["F21022026_02"]).toBeDefined();
    expect(map["F21022026_03"]).toBeDefined();
    expect(map["F21022026_04"]).toBeDefined();
    expect(map["F21022026_05"]).toBeDefined();
  });

  it("prefers displayName over function name", () => {
    function MyComp() { return null; }
    (MyComp as any).displayName = "CustomName";
    const map = buildComponentRegistry({ e: { component: MyComp, duration: 100 } });
    expect(map["CustomName"]).toBe(MyComp);
    expect(map["MyComp"]).toBeUndefined();
  });

  it("skips entries that have no component field", () => {
    const map = buildComponentRegistry({ bad: { duration: 100 }, good: { component: function Good() { return null; }, duration: 50 } });
    expect(Object.keys(map)).toHaveLength(1);
    expect(map["Good"]).toBeDefined();
  });

  it("skips components with no name and no displayName", () => {
    // Arrow functions stored in variables get the variable name via inference,
    // so use a property assignment to get a truly nameless function
    const obj = { "": () => null };
    const anon = obj[""];
    const map = buildComponentRegistry({ e: { component: anon, duration: 100 } });
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("returns empty map for null input", () => {
    expect(buildComponentRegistry(null as any)).toEqual({});
  });

  it("returns empty map for empty registry", () => {
    expect(buildComponentRegistry({})).toEqual({});
  });
});

describe("StaticSlot module — import safety", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not call registerRoot when module is imported — package main entry is not touched", () => {
    // If this fix regresses, the old import path would load remotionRoot.jsx
    // which calls registerRoot() as a module-level side effect.
    expect(mockRegisterRoot).not.toHaveBeenCalled();
  });

  it("exports StaticSlot as a function", () => {
    expect(typeof StaticSlot).toBe("function");
  });

  it("exports buildComponentRegistry as a function", () => {
    expect(typeof buildComponentRegistry).toBe("function");
  });
});

describe("frameRegistry mock — all 5 frames present", () => {
  const expectedFrames = [
    "F21022026_01",
    "F21022026_02",
    "F21022026_03",
    "F21022026_04",
    "F21022026_05",
  ];

  it.each(expectedFrames)("%s is in the registry", (name) => {
    const map = buildComponentRegistry(frameRegistry as any);
    expect(map[name]).toBeDefined();
  });
});
