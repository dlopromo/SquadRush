export type WeaponType = "blaster" | "machineGun" | "shotgun" | "rocket";
export type GateOperation = "add" | "subtract" | "multiply";

export type GateChoice = {
  operation: GateOperation;
  value: number;
};

export type StageSegment =
  | { type: "gates"; at: number; left: GateChoice; right: GateChoice }
  | { type: "enemies"; at: number; count: number; health: number; spread: number }
  | { type: "tires"; at: number; health: number; x: number }
  | { type: "weapon"; at: number; left: WeaponType; right: WeaponType };

export type StageDefinition = {
  stage: number;
  length: number;
  startSquad: number;
  bossHealth: number;
  segments: StageSegment[];
  seed: number;
};

export type UpgradeLevels = {
  squad: number;
  damage: number;
  fireRate: number;
};

export type GameSave = {
  version: 2;
  coins: number;
  carrySquad: number;
  currentStage: number;
  highestStage: number;
  bestScore: number;
  failures: number;
  upgrades: UpgradeLevels;
};

export const DEFAULT_SAVE: GameSave = {
  version: 2,
  coins: 0,
  carrySquad: 0,
  currentStage: 1,
  highestStage: 1,
  bestScore: 0,
  failures: 0,
  upgrades: { squad: 0, damage: 0, fireRate: 0 },
};

export const WEAPONS: Record<WeaponType, { damage: number; interval: number; pellets: number; splash: number }> = {
  blaster: { damage: 1.3, interval: 0.23, pellets: 1, splash: 0 },
  machineGun: { damage: 0.82, interval: 0.095, pellets: 1, splash: 0 },
  shotgun: { damage: 1.15, interval: 0.48, pellets: 5, splash: 0 },
  rocket: { damage: 5.8, interval: 0.72, pellets: 1, splash: 36 },
};

const FIXED_GATES: Array<Array<[GateChoice, GateChoice]>> = [
  [[{ operation: "add", value: 3 }, { operation: "subtract", value: 1 }], [{ operation: "add", value: 5 }, { operation: "add", value: 2 }], [{ operation: "add", value: 6 }, { operation: "add", value: 3 }]],
  [[{ operation: "add", value: 5 }, { operation: "subtract", value: 2 }], [{ operation: "add", value: 8 }, { operation: "add", value: 4 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 7 }]],
  [[{ operation: "add", value: 7 }, { operation: "add", value: 4 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 9 }], [{ operation: "add", value: 11 }, { operation: "subtract", value: 3 }]],
  [[{ operation: "add", value: 10 }, { operation: "add", value: 6 }], [{ operation: "add", value: 13 }, { operation: "subtract", value: 4 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 12 }]],
  [[{ operation: "add", value: 13 }, { operation: "subtract", value: 5 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 15 }], [{ operation: "add", value: 18 }, { operation: "add", value: 10 }]],
  [[{ operation: "add", value: 17 }, { operation: "add", value: 10 }], [{ operation: "add", value: 21 }, { operation: "subtract", value: 7 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 20 }]],
  [[{ operation: "add", value: 22 }, { operation: "subtract", value: 8 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 25 }], [{ operation: "add", value: 29 }, { operation: "add", value: 16 }]],
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function applyGate(squad: number, gate: GateChoice): number {
  if (gate.operation === "multiply") return Math.max(1, Math.floor(squad * gate.value));
  if (gate.operation === "subtract") return Math.max(1, squad - Math.floor(gate.value));
  return Math.max(1, squad + Math.floor(gate.value));
}

export function formatCount(value: number): string {
  const count = Math.max(0, Math.floor(value));
  if (count < 1000) return count.toLocaleString("en-US");
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}K`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

export function formatScore(value: number): string {
  return Math.max(0, Math.floor(value)).toString().padStart(7, "0");
}

export function weaponDps(weapon: WeaponType, upgrades: UpgradeLevels): number {
  const stats = WEAPONS[weapon];
  const damageMultiplier = 1 + upgrades.damage * 0.12;
  const rateMultiplier = 1 + upgrades.fireRate * 0.08;
  return (stats.damage * stats.pellets * damageMultiplier * rateMultiplier) / stats.interval;
}

export function crowdPower(squad: number): number {
  const safeSquad = Math.max(1, squad);
  return Math.max(1, Math.sqrt(safeSquad) * 1.38 + Math.log10(safeSquad + 1) * 0.9);
}

export function squadDps(squad: number, weapon: WeaponType, upgrades: UpgradeLevels): number {
  return crowdPower(squad) * weaponDps(weapon, upgrades);
}

export function visibleVolleyCount(squad: number, weapon: WeaponType): number {
  const weaponFactor = weapon === "rocket" ? 0.45 : weapon === "shotgun" ? 0.72 : 1;
  return Math.min(50, Math.max(1, Math.round((2 + Math.sqrt(Math.max(1, squad)) * 2.35) * weaponFactor)));
}

export function encounterHealth(
  squad: number,
  weapon: WeaponType,
  upgrades: UpgradeLevels,
  secondsToDefeat: number,
  count = 1,
): number {
  return Math.max(1, Math.round((squadDps(squad, weapon, upgrades) * secondsToDefeat) / Math.max(1, count)));
}

export function carrySquadForNextStage(squad: number, nextStage: number, upgrades: UpgradeLevels): number {
  const baseline = 5 + upgrades.squad * 3 + Math.max(0, nextStage - 1) * 5;
  const cap = Math.round(baseline * (2.6 + Math.min(1.4, nextStage * 0.08)));
  return Math.min(Math.max(baseline, Math.floor(squad * 0.72)), cap);
}

export function startingSquad(stage: number, upgrades: UpgradeLevels, carrySquad = 0): number {
  const baseline = 5 + upgrades.squad * 3 + Math.max(0, stage - 1) * 5;
  const carryCap = Math.round(baseline * (2.6 + Math.min(1.4, stage * 0.08)));
  return Math.max(baseline, Math.min(Math.floor(carrySquad), carryCap));
}

export function bossHealthFor(stage: number, failures = 0): number {
  const base = stage <= 7 ? 145 * 1.58 ** (stage - 1) : 4_800 * 1.27 ** (stage - 7);
  const mercy = Math.max(0.72, 1 - failures * 0.08);
  return Math.floor(base * mercy);
}

export function upgradeCost(kind: keyof UpgradeLevels, level: number): number {
  const base = kind === "squad" ? 35 : kind === "damage" ? 50 : 45;
  return Math.floor(base * 1.58 ** level);
}

export function applyAutomaticUpgrades(save: GameSave): { save: GameSave; upgraded: Array<keyof UpgradeLevels> } {
  const next = structuredClone(save);
  const upgraded: Array<keyof UpgradeLevels> = [];
  const order: Array<keyof UpgradeLevels> = ["squad", "damage", "fireRate"];
  let bought = true;
  while (bought) {
    bought = false;
    const candidate = order
      .map((kind) => ({ kind, cost: upgradeCost(kind, next.upgrades[kind]), level: next.upgrades[kind] }))
      .sort((a, b) => a.level - b.level || a.cost - b.cost)
      .find((item) => item.cost <= next.coins);
    if (candidate) {
      next.coins -= candidate.cost;
      next.upgrades[candidate.kind] += 1;
      upgraded.push(candidate.kind);
      bought = true;
    }
  }
  return { save: next, upgraded };
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function fixedStage(stage: number, failures: number, upgrades: UpgradeLevels, carrySquad: number): StageDefinition {
  const gates = FIXED_GATES[stage - 1];
  const strength = 1 + (stage - 1) * 0.38;
  const segments: StageSegment[] = [
    { type: "gates", at: 0.08, left: gates[0][0], right: gates[0][1] },
    { type: "enemies", at: 0.16, count: 10 + stage * 2, health: Math.max(1, Math.floor(2 * strength)), spread: 0.42 },
    { type: "tires", at: 0.24, health: Math.floor(16 * strength), x: stage % 2 ? 0.67 : 0.33 },
    { type: "enemies", at: 0.31, count: 12 + stage * 2, health: Math.max(1, Math.floor(2.3 * strength)), spread: 0.46 },
    { type: "gates", at: 0.39, left: gates[1][0], right: gates[1][1] },
    { type: "enemies", at: 0.47, count: 14 + stage * 2, health: Math.max(1, Math.floor(2.6 * strength)), spread: 0.52 },
    {
      type: "weapon",
      at: 0.57,
      left: stage % 3 === 0 ? "rocket" : "machineGun",
      right: stage % 2 === 0 ? "shotgun" : "rocket",
    },
    { type: "enemies", at: 0.64, count: 16 + stage * 2, health: Math.max(1, Math.floor(2.8 * strength)), spread: 0.5 },
    { type: "tires", at: 0.71, health: Math.floor(24 * strength), x: stage % 2 ? 0.32 : 0.68 },
    { type: "enemies", at: 0.77, count: 15 + stage * 2, health: Math.max(1, Math.floor(2.8 * strength)), spread: 0.48 },
    { type: "gates", at: 0.84, left: gates[2][0], right: gates[2][1] },
    { type: "enemies", at: 0.91, count: 18 + stage * 2, health: Math.max(1, Math.floor(3 * strength)), spread: 0.5 },
  ];
  return {
    stage,
    length: 18 + stage * 0.55,
    startSquad: startingSquad(stage, upgrades, carrySquad),
    bossHealth: bossHealthFor(stage, failures),
    segments,
    seed: stage * 7919,
  };
}

function endlessStage(
  stage: number,
  failures: number,
  upgrades: UpgradeLevels,
  seed: number,
  carrySquad: number,
): StageDefinition {
  const random = mulberry32(seed + stage * 7919);
  const tier = stage - 7;
  const start = startingSquad(stage, upgrades, carrySquad);
  const segments: StageSegment[] = [];
  const slots = 14 + Math.min(6, Math.floor(tier / 3));
  let multiplierUsed = false;
  for (let index = 0; index < slots; index += 1) {
    const at = 0.055 + index * (0.89 / slots);
    const roll = random();
    if (index % 4 === 0) {
      const levelBaseline = start + index * Math.max(3, Math.round(start * 0.09));
      const gain = Math.max(4, Math.floor(levelBaseline * (0.08 + random() * 0.1)));
      const useMultiplier: boolean = multiplierUsed === false && index >= 4 && random() > 0.72;
      const strong: GateChoice = useMultiplier
        ? { operation: "multiply", value: 2 }
        : { operation: "add", value: gain };
      if (useMultiplier) multiplierUsed = true;
      const gentle: GateChoice = random() > 0.75
        ? { operation: "subtract", value: Math.max(1, Math.floor(levelBaseline * (0.04 + random() * 0.04))) }
        : { operation: "add", value: Math.max(3, Math.floor(gain * 0.58)) };
      segments.push(random() > 0.5
        ? { type: "gates", at, left: strong, right: gentle }
        : { type: "gates", at, left: gentle, right: strong });
    } else if (roll < 0.5) {
      segments.push({
        type: "enemies",
        at,
        count: Math.min(42, 16 + Math.floor(tier * 0.75) + Math.floor(random() * 10)),
        health: Math.floor((2.5 + tier * 0.4) * (0.75 + random() * 0.3)),
        spread: 0.25 + random() * 0.35,
      });
    } else if (roll < 0.8) {
      segments.push({
        type: "tires",
        at,
        health: Math.floor(30 * 1.12 ** tier * (0.75 + random() * 0.3)),
        x: random() < 0.5 ? 0.3 : 0.7,
      });
    } else {
      const options: WeaponType[] = ["machineGun", "shotgun", "rocket"];
      const leftIndex = Math.floor(random() * options.length);
      const rightOffset = 1 + Math.floor(random() * (options.length - 1));
      segments.push({
        type: "weapon",
        at,
        left: options[leftIndex],
        right: options[(leftIndex + rightOffset) % options.length],
      });
    }
  }
  return {
    stage,
    length: 21 + Math.min(8, tier * 0.28),
    startSquad: start,
    bossHealth: bossHealthFor(stage, failures),
    segments,
    seed,
  };
}

export function getStageDefinition(
  stage: number,
  failures = 0,
  upgrades: UpgradeLevels = DEFAULT_SAVE.upgrades,
  seed = 20260611,
  carrySquad = 0,
): StageDefinition {
  const safeStage = Math.max(1, Math.floor(stage));
  return safeStage <= 7
    ? fixedStage(safeStage, failures, upgrades, carrySquad)
    : endlessStage(safeStage, failures, upgrades, seed, carrySquad);
}

export function migrateSave(value: unknown, legacyBest = 0): GameSave {
  if (!value || typeof value !== "object") return { ...structuredClone(DEFAULT_SAVE), bestScore: legacyBest };
  const raw = value as Partial<GameSave>;
  if (raw.version !== 2) return { ...structuredClone(DEFAULT_SAVE), bestScore: Math.max(legacyBest, raw.bestScore ?? 0) };
  return {
    version: 2,
    coins: Math.max(0, Math.floor(raw.coins ?? 0)),
    carrySquad: Math.max(0, Math.floor(raw.carrySquad ?? 0)),
    currentStage: Math.max(1, Math.floor(raw.currentStage ?? 1)),
    highestStage: Math.max(1, Math.floor(raw.highestStage ?? 1)),
    bestScore: Math.max(legacyBest, Math.floor(raw.bestScore ?? 0)),
    failures: Math.max(0, Math.floor(raw.failures ?? 0)),
    upgrades: {
      squad: Math.max(0, Math.floor(raw.upgrades?.squad ?? 0)),
      damage: Math.max(0, Math.floor(raw.upgrades?.damage ?? 0)),
      fireRate: Math.max(0, Math.floor(raw.upgrades?.fireRate ?? 0)),
    },
  };
}
