import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAVE,
  applyAutomaticUpgrades,
  applyGate,
  bossHealthFor,
  carrySquadForNextStage,
  encounterHealth,
  formatCount,
  getStageDefinition,
  migrateSave,
  squadDps,
  startingSquad,
  upgradeCost,
  visibleVolleyCount,
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
    const multipliers = gates.flatMap((gate) => [gate.left, gate.right])
      .filter((choice) => choice.operation === "multiply");
    expect(multipliers.length).toBeLessThanOrEqual(1);
    expect(multipliers.every((choice) => choice.value === 2)).toBe(true);
    const weaponGates = first.segments.filter((segment) => segment.type === "weapon");
    expect(weaponGates.every((gate) => gate.left !== gate.right)).toBe(true);
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
    expect(startingSquad(8, upgrades, 50_000)).toBeLessThan(500);
  });

  it("keeps fixed gates and enemy density within a controlled level curve", () => {
    for (let stage = 1; stage <= 7; stage += 1) {
      const definition = getStageDefinition(stage);
      const gates = definition.segments.filter((segment) => segment.type === "gates");
      const choices = gates.flatMap((gate) => [gate.left, gate.right]);
      expect(choices.filter((choice) => choice.operation === "multiply").length).toBeLessThanOrEqual(1);
      expect(choices.every((choice) => choice.operation !== "multiply" || choice.value === 2)).toBe(true);
      expect(Math.max(...choices.filter((choice) => choice.operation === "add").map((choice) => choice.value)))
        .toBeLessThanOrEqual(30);
      const enemies = definition.segments.filter((segment) => segment.type === "enemies");
      expect(enemies.length).toBeGreaterThanOrEqual(5);
      expect(enemies.every((wave) => wave.count >= 12)).toBe(true);
    }
  });

  it("scales visible volleys without spawning one projectile per huge squad", () => {
    expect(visibleVolleyCount(5, "blaster")).toBeLessThan(visibleVolleyCount(100, "blaster"));
    expect(visibleVolleyCount(100, "blaster")).toBeLessThanOrEqual(visibleVolleyCount(10_000, "blaster"));
    expect(visibleVolleyCount(10_000, "blaster")).toBe(50);
    expect(visibleVolleyCount(10_000, "rocket")).toBeLessThanOrEqual(50);
  });

  it("derives encounter durability from the actual squad firepower", () => {
    const upgrades = { squad: 0, damage: 2, fireRate: 1 };
    const dps = squadDps(80, "machineGun", upgrades);
    const health = encounterHealth(80, "machineGun", upgrades, 8);
    expect(health / dps).toBeCloseTo(8, 1);
    expect(encounterHealth(160, "machineGun", upgrades, 8)).toBeGreaterThan(health);
  });

  it("soft-caps the squad carried into the next level", () => {
    const upgrades = { squad: 2, damage: 0, fireRate: 0 };
    const carried = carrySquadForNextStage(50_000, 8, upgrades);
    expect(carried).toBeLessThan(500);
    expect(startingSquad(8, upgrades, carried)).toBe(carried);
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
