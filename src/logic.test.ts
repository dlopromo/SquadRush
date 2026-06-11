import { describe, expect, it } from "vitest";
import {
  canDefeat,
  formatScore,
  moveLane,
  progressAt,
  resolveDamage,
  resolveGate,
  resolveRecruit,
  zoneAt,
} from "./logic";

describe("runner game logic", () => {
  it("keeps lane movement within three lanes", () => {
    expect(moveLane(0, -1)).toBe(0);
    expect(moveLane(1, 1)).toBe(2);
    expect(moveLane(2, 1)).toBe(2);
  });

  it("recruits units and caps the squad", () => {
    expect(resolveRecruit(6, 5)).toBe(11);
    expect(resolveRecruit(98, 10)).toBe(99);
  });

  it("resolves damage without negative squad values", () => {
    expect(resolveDamage(12, 4)).toBe(8);
    expect(resolveDamage(3, 9)).toBe(0);
  });

  it("requires a strictly larger squad to defeat enemies", () => {
    expect(canDefeat(8, 7)).toBe(true);
    expect(canDefeat(8, 8)).toBe(false);
  });

  it("supports additive and multiplier gates", () => {
    expect(resolveGate(10, "add", 8)).toBe(18);
    expect(resolveGate(10, "multiply", 1.5)).toBe(15);
  });

  it("maps progress into all three zones", () => {
    expect(progressAt(15, 60)).toBe(0.25);
    expect(progressAt(90, 60)).toBe(1);
    expect(zoneAt(0.2)).toBe(0);
    expect(zoneAt(0.5)).toBe(1);
    expect(zoneAt(0.9)).toBe(2);
  });

  it("formats scores for the HUD", () => {
    expect(formatScore(42.9)).toBe("000042");
  });
});
