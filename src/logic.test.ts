import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAVE,
  applyAutomaticUpgrades,
  applyGate,
  bossHealthFor,
  formatCount,
  getStageDefinition,
  migrateSave,
  startingSquad,
  upgradeCost,
  weaponDps,
} from "./logic";

describe("Squad Rush rules", () => {
  it("applies all gate operations and never removes the final unit", () => {
    expect(applyGate(5, { operation: "add", value: 9 })).toBe(14);
    expect(applyGate(14, { operation: "multiply", value: 2 })).toBe(28);
    expect(applyGate(5, { operation: "subtract", value: 99 })).toBe(1);
  });

  it("formats the large crowds used by later stages", () => {
    expect(formatCount(505)).toBe("505");
    expect(formatCount(12_184)).toBe("12K");
    expect(formatCount(1_250_000)).toBe("1.3M");
  });

  it("provides seven authored stages with gates, weapons, enemies, tires, and bosses", () => {
    for (let stage = 1; stage <= 7; stage += 1) {
      const definition = getStageDefinition(stage);
      expect(definition.stage).toBe(stage);
      expect(definition.bossHealth).toBeGreaterThan(0);
      expect(definition.segments.some((segment) => segment.type === "gates")).toBe(true);
      expect(definition.segments.some((segment) => segment.type === "weapon")).toBe(true);
      expect(definition.segments.some((segment) => segment.type === "enemies")).toBe(true);
      expect(definition.segments.some((segment) => segment.type === "tires")).toBe(true);
    }
  });

  it("generates deterministic endless stages with a viable positive gate", () => {
    const first = getStageDefinition(18, 0, DEFAULT_SAVE.upgrades, 42);
    const second = getStageDefinition(18, 0, DEFAULT_SAVE.upgrades, 42);
    expect(first).toEqual(second);
    const gates = first.segments.filter((segment) => segment.type === "gates");
    expect(gates.length).toBeGreaterThan(1);
    for (const gate of gates) {
      expect([gate.left, gate.right].some((choice) => choice.operation !== "subtract")).toBe(true);
    }
  });

  it("scales gently and applies failure mercy to bosses", () => {
    expect(bossHealthFor(8)).toBeGreaterThan(bossHealthFor(7));
    expect(bossHealthFor(12)).toBeLessThan(bossHealthFor(20));
    expect(bossHealthFor(12, 3)).toBeLessThan(bossHealthFor(12, 0));
  });

  it("makes permanent upgrades meaningful", () => {
    const upgrades = { squad: 3, damage: 2, fireRate: 2 };
    expect(startingSquad(1, upgrades)).toBe(14);
    expect(weaponDps("machineGun", upgrades)).toBeGreaterThan(weaponDps("machineGun", DEFAULT_SAVE.upgrades));
    expect(upgradeCost("damage", 3)).toBeGreaterThan(upgradeCost("damage", 2));
    expect(startingSquad(8, upgrades, 50_000)).toBe(50_000);
  });

  it("automatically purchases balanced upgrades without overspending", () => {
    const result = applyAutomaticUpgrades({ ...structuredClone(DEFAULT_SAVE), coins: 500 });
    expect(result.upgraded.length).toBeGreaterThan(0);
    expect(result.save.coins).toBeGreaterThanOrEqual(0);
    const levels = Object.values(result.save.upgrades);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1);
  });

  it("migrates missing and legacy save data", () => {
    expect(migrateSave(null, 123).bestScore).toBe(123);
    const save = migrateSave({
      version: 2,
      coins: 10,
      carrySquad: 12_500,
      currentStage: 9,
      highestStage: 12,
      bestScore: 500,
      failures: 2,
      upgrades: { squad: 2, damage: 3, fireRate: 4 },
    });
    expect(save.currentStage).toBe(9);
    expect(save.carrySquad).toBe(12_500);
    expect(save.upgrades.fireRate).toBe(4);
  });
});
