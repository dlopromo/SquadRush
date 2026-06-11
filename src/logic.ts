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
  [[{ operation: "add", value: 9 }, { operation: "subtract", value: 2 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 7 }], [{ operation: "add", value: 12 }, { operation: "add", value: 5 }]],
  [[{ operation: "add", value: 12 }, { operation: "subtract", value: 12 }], [{ operation: "add", value: 27 }, { operation: "add", value: 38 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 20 }]],
  [[{ operation: "add", value: 39 }, { operation: "multiply", value: 2 }], [{ operation: "add", value: 53 }, { operation: "add", value: 61 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 47 }]],
  [[{ operation: "add", value: 103 }, { operation: "add", value: 228 }], [{ operation: "add", value: 304 }, { operation: "add", value: 659 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 410 }]],
  [[{ operation: "add", value: 102 }, { operation: "add", value: 38 }], [{ operation: "add", value: 233 }, { operation: "add", value: 668 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 1200 }]],
  [[{ operation: "add", value: 11719 }, { operation: "add", value: 11895 }], [{ operation: "add", value: 8084 }, { operation: "add", value: 6104 }], [{ operation: "multiply", value: 2 }, { operation: "add", value: 19219 }]],
  [[{ operation: "add", value: 6130 }, { operation: "add", value: 1417 }], [{ operation: "add", value: 8084 }, { operation: "add", value: 6104 }], [{ operation: "add", value: 2689 }, { operation: "multiply", value: 2 }]],
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

export function startingSquad(stage: number, upgrades: UpgradeLevels, carrySquad = 0): number {
  const stageCarry = stage <= 7 ? Math.floor((stage - 1) ** 2 * 7) : Math.floor(260 * 1.5 ** (stage - 8));
  return Math.max(5 + upgrades.squad * 3 + stageCarry, Math.floor(carrySquad));
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
    { type: "gates", at: 0.12, left: gates[0][0], right: gates[0][1] },
    { type: "enemies", at: 0.24, count: 4 + stage, health: Math.max(1, Math.floor(2 * strength)), spread: 0.32 },
    { type: "tires", at: 0.34, health: Math.floor(16 * strength), x: stage % 2 ? 0.67 : 0.33 },
    { type: "gates", at: 0.44, left: gates[1][0], right: gates[1][1] },
    { type: "enemies", at: 0.56, count: 6 + stage, health: Math.max(1, Math.floor(2.6 * strength)), spread: 0.45 },
    {
      type: "weapon",
      at: 0.65,
      left: stage % 3 === 0 ? "rocket" : "machineGun",
      right: stage % 2 === 0 ? "shotgun" : "rocket",
    },
    { type: "tires", at: 0.74, health: Math.floor(24 * strength), x: stage % 2 ? 0.32 : 0.68 },
    { type: "gates", at: 0.82, left: gates[2][0], right: gates[2][1] },
    { type: "enemies", at: 0.9, count: 8 + stage, health: Math.max(1, Math.floor(3 * strength)), spread: 0.4 },
  ];
  return {
    stage,
    length: 22 + stage * 0.7,
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
  const slots = 10 + Math.min(5, Math.floor(tier / 3));
  for (let index = 0; index < slots; index += 1) {
    const at = 0.08 + index * (0.82 / slots);
    const roll = random();
    if (index % 4 === 0) {
      const gain = Math.max(12, Math.floor(start * (0.18 + random() * 0.28)));
      const strong: GateChoice = random() > 0.62
        ? { operation: "multiply", value: random() > 0.78 ? 3 : 2 }
        : { operation: "add", value: gain };
      const gentle: GateChoice = random() > 0.75
        ? { operation: "subtract", value: Math.max(1, Math.floor(gain * 0.25)) }
        : { operation: "add", value: Math.max(4, Math.floor(gain * 0.55)) };
      segments.push(random() > 0.5
        ? { type: "gates", at, left: strong, right: gentle }
        : { type: "gates", at, left: gentle, right: strong });
    } else if (roll < 0.5) {
      segments.push({
        type: "enemies",
        at,
        count: 5 + Math.floor(random() * 8),
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
      segments.push({
        type: "weapon",
        at,
        left: options[Math.floor(random() * options.length)],
        right: options[Math.floor(random() * options.length)],
      });
    }
  }
  return {
    stage,
    length: 27 + Math.min(10, tier * 0.35),
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
