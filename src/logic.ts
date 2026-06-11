export const LANE_COUNT = 3;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function moveLane(current: number, direction: -1 | 1): number {
  return clamp(current + direction, 0, LANE_COUNT - 1);
}

export function resolveRecruit(squad: number, amount: number): number {
  return clamp(squad + Math.max(0, Math.floor(amount)), 0, 99);
}

export function resolveDamage(squad: number, damage: number): number {
  return Math.max(0, squad - Math.max(0, Math.ceil(damage)));
}

export function canDefeat(squad: number, enemyPower: number): boolean {
  return squad > enemyPower;
}

export function resolveGate(squad: number, operation: "add" | "multiply", value: number): number {
  if (operation === "multiply") {
    return clamp(Math.floor(squad * value), 0, 99);
  }
  return resolveRecruit(squad, value);
}

export function progressAt(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  return clamp(elapsed / duration, 0, 1);
}

export function zoneAt(progress: number): 0 | 1 | 2 {
  if (progress < 0.34) return 0;
  if (progress < 0.68) return 1;
  return 2;
}

export function formatScore(score: number): string {
  return Math.max(0, Math.floor(score)).toString().padStart(6, "0");
}
