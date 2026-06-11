import "./style.css";
import { AudioEngine } from "./audio";
import { SwarmGame, type GameResult, type HudData } from "./game";

const getElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const canvas = getElement<HTMLCanvasElement>("game-canvas");
const menuScreen = getElement("menu-screen");
const pauseScreen = getElement("pause-screen");
const resultScreen = getElement("result-screen");
const hud = getElement("hud");
const toast = getElement("toast");
const startButton = getElement<HTMLButtonElement>("start-button");
const pauseButton = getElement<HTMLButtonElement>("pause-button");
const resumeButton = getElement<HTMLButtonElement>("resume-button");
const restartButton = getElement<HTMLButtonElement>("restart-button");
const soundButton = getElement<HTMLButtonElement>("sound-button");
const squadValue = getElement("squad-value");
const scoreValue = getElement("score-value");
const progressFill = getElement("progress-fill");
const zoneLabel = getElement("zone-label");
const bestScore = getElement("best-score");
const finalScore = getElement("final-score");
const finalBest = getElement("final-best");
const maxSquad = getElement("max-squad");
const resultEyebrow = getElement("result-eyebrow");
const resultTitle = getElement("result-title");
const resultMessage = getElement("result-message");
const statusIndicator = getElement("status-indicator");

const storageKey = "squad-rush-best";
let best = Number.parseInt(localStorage.getItem(storageKey) ?? "0", 10) || 0;
let toastTimeout = 0;

const audio = new AudioEngine();
const game = new SwarmGame(canvas, audio, {
  onStateChange: (state) => {
    const inGame = state === "playing" || state === "paused";
    menuScreen.classList.toggle("is-hidden", state !== "menu");
    pauseScreen.classList.toggle("is-hidden", state !== "paused");
    resultScreen.classList.toggle("is-hidden", state !== "won" && state !== "lost");
    hud.classList.toggle("is-hidden", !inGame);
    pauseButton.classList.toggle("is-active", state === "paused");
    statusIndicator.innerHTML =
      state === "playing"
        ? "<i></i> 勇往直前"
        : state === "paused"
          ? "<i></i> 暫停中"
          : "<i></i> 準備出發";
  },
  onHudUpdate: (data: HudData) => {
    squadValue.textContent = data.squad.toString().padStart(2, "0");
    scoreValue.textContent = game.getFormattedScore(data.score);
    progressFill.style.transform = `scaleX(${data.progress})`;
    zoneLabel.textContent = `0${data.zone + 1} / ${game.getZoneName(data.zone)}`;
  },
  onToast: (message, tone = "neutral") => {
    window.clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add("is-visible");
    toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 1300);
  },
  onEnd: (result: GameResult) => {
    best = Math.max(best, result.score);
    localStorage.setItem(storageKey, best.toString());
    updateBest();
    renderResult(result);
  },
});

function updateBest(): void {
  const formatted = game.getFormattedScore(best);
  bestScore.textContent = formatted;
  finalBest.textContent = formatted;
}

function renderResult(result: GameResult): void {
  finalScore.textContent = game.getFormattedScore(result.score);
  maxSquad.textContent = result.maxSquad.toString().padStart(2, "0");
  if (result.won) {
    resultEyebrow.innerHTML = "<span></span> 完美勝利！";
    resultTitle.textContent = "巨人倒下了";
    resultMessage.textContent = "你帶領夥伴攻下城堡，成為草原上的新英雄！";
    resultScreen.dataset.result = "won";
  } else {
    resultEyebrow.innerHTML = "<span></span> 差一點點！";
    resultTitle.textContent = "挑戰失敗";
    resultMessage.textContent = "再多招募一些夥伴，下次一定能打敗巨人！";
    resultScreen.dataset.result = "lost";
  }
}

function beginGame(): void {
  void audio.unlock();
  game.start();
}

startButton.addEventListener("click", beginGame);
restartButton.addEventListener("click", beginGame);
pauseButton.addEventListener("click", () => game.togglePause());
resumeButton.addEventListener("click", () => game.resume());
soundButton.addEventListener("click", async () => {
  await audio.unlock();
  const muted = audio.toggleMute();
  soundButton.classList.toggle("is-muted", muted);
  soundButton.setAttribute("aria-label", muted ? "開啟聲音" : "關閉聲音");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) game.togglePause();
});

updateBest();
