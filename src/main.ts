import "./style.css";
import { AudioEngine } from "./audio";
import { SquadRushGame, type GameState, type HudData, type StageResult } from "./game";
import { formatCount, migrateSave, type GameSave, type WeaponType } from "./logic";

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as T;
};

const SAVE_KEY = "squad-rush-save-v2";
const LEGACY_BEST_KEY = "squad-rush-best";
const legacyBest = Number.parseInt(localStorage.getItem(LEGACY_BEST_KEY) ?? "0", 10) || 0;
let save = loadSave();
let toastTimer = 0;

const canvas = element<HTMLCanvasElement>("game-canvas");
const hud = element("hud");
const menuScreen = element("menu-screen");
const pauseScreen = element("pause-screen");
const clearScreen = element("clear-screen");
const resultScreen = element("result-screen");
const progressFill = element("progress-fill");
const progressRunner = element("progress-runner");
const bossBar = element("boss-bar");
const bossFill = element("boss-fill");
const bossLabel = element("boss-label");
const stageValue = element("stage-value");
const coinValue = element("coin-value");
const comboStat = element("combo-stat");
const comboValue = element("combo-value");
const weaponValue = element("weapon-value");
const weaponIcon = element("weapon-icon");
const bestStage = element("best-stage");
const menuCoins = element("menu-coins");
const clearStage = element("clear-stage");
const clearCoins = element("clear-coins");
const upgradeMessage = element("upgrade-message");
const finalStage = element("final-stage");
const finalScore = element("final-score");
const finalCoins = element("final-coins");
const toast = element("toast");
const startButton = element<HTMLButtonElement>("start-button");
const pauseButton = element<HTMLButtonElement>("pause-button");
const soundButton = element<HTMLButtonElement>("sound-button");
const resumeButton = element<HTMLButtonElement>("resume-button");
const restartButton = element<HTMLButtonElement>("restart-button");

const audio = new AudioEngine();
const game = new SquadRushGame(canvas, audio, save, {
  onStateChange: renderState,
  onHudUpdate: renderHud,
  onMessage: showToast,
  onStageEnd: renderStageResult,
  onSave: persistSave,
});

function loadSave(): GameSave {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return migrateSave(raw ? JSON.parse(raw) : null, legacyBest);
  } catch {
    return migrateSave(null, legacyBest);
  }
}

function persistSave(next: GameSave): void {
  save = next;
  localStorage.setItem(SAVE_KEY, JSON.stringify(next));
  renderMenuStats();
}

function renderMenuStats(): void {
  bestStage.textContent = save.highestStage.toString();
  menuCoins.textContent = formatCount(save.coins);
}

function renderState(state: GameState): void {
  menuScreen.classList.toggle("is-hidden", state !== "menu");
  pauseScreen.classList.toggle("is-hidden", state !== "paused");
  clearScreen.classList.toggle("is-hidden", state !== "stageClear");
  resultScreen.classList.toggle("is-hidden", state !== "lost");
  hud.classList.toggle("is-hidden", state === "menu");
  pauseButton.classList.toggle("is-active", state === "paused");
}

function renderHud(data: HudData): void {
  const progress = Math.min(1, data.progress);
  progressFill.style.transform = `scaleX(${progress})`;
  progressRunner.style.left = `${progress * 100}%`;
  stageValue.textContent = data.stage.toString();
  coinValue.textContent = formatCount(data.coins);
  comboValue.textContent = data.combo.toString();
  comboStat.classList.toggle("is-hidden", data.combo < 2);
  weaponValue.textContent = weaponName(data.weapon);
  weaponIcon.dataset.weapon = data.weapon;

  const showBoss = data.bossHealth !== null && data.bossMaxHealth !== null;
  bossBar.classList.toggle("is-hidden", !showBoss);
  if (showBoss) {
    bossFill.style.transform = `scaleX(${Math.max(0, data.bossHealth! / data.bossMaxHealth!)})`;
    bossLabel.textContent = `BOSS ${formatCount(data.bossHealth!)}`;
  }
}

function weaponName(weapon: WeaponType): string {
  if (weapon === "machineGun") return "MINIGUN";
  if (weapon === "shotgun") return "SHOTGUN";
  if (weapon === "rocket") return "ROCKET";
  return "BLASTER";
}

function showToast(message: string, tone: "good" | "bad" | "weapon" = "good"): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 900);
}

function renderStageResult(result: StageResult): void {
  if (result.won) {
    clearStage.textContent = result.stage.toString();
    clearCoins.textContent = `+${formatCount(result.coinsEarned)} COINS`;
    if (result.upgraded.length > 0) {
      const labels = result.upgraded.map((kind) =>
        kind === "squad" ? "START SQUAD" : kind === "damage" ? "DAMAGE" : "FIRE RATE",
      );
      upgradeMessage.textContent = `${labels.join(" + ")} UPGRADED!`;
    } else {
      upgradeMessage.textContent = `STAGE ${result.stage + 1} NEXT`;
    }
    return;
  }
  finalStage.textContent = result.stage.toString();
  finalScore.textContent = game.getFormattedScore(result.score);
  finalCoins.textContent = `+${formatCount(result.coinsEarned)}`;
}

function begin(): void {
  void audio.unlock();
  game.start();
}

startButton.addEventListener("click", begin);
restartButton.addEventListener("click", () => {
  void audio.unlock();
  game.retry();
});
pauseButton.addEventListener("click", () => game.togglePause());
resumeButton.addEventListener("click", () => game.resume());
soundButton.addEventListener("click", () => {
  void audio.unlock();
  const muted = audio.toggleMute();
  soundButton.classList.toggle("is-muted", muted);
  soundButton.setAttribute("aria-label", muted ? "開啟聲音" : "關閉聲音");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) game.togglePause();
});

renderMenuStats();
