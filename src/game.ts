import { AudioEngine } from "./audio";
import {
  WEAPONS,
  applyAutomaticUpgrades,
  applyGate,
  clamp,
  formatCount,
  formatScore,
  getStageDefinition,
  type GameSave,
  type GateChoice,
  type StageDefinition,
  type StageSegment,
  type WeaponType,
} from "./logic";

export type GameState = "menu" | "playing" | "paused" | "stageClear" | "lost";

type TargetKind = "enemy" | "tires" | "boss";

type Target = {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  radius: number;
  dead: boolean;
  phase: number;
};

type GatePair = {
  id: number;
  y: number;
  left: GateChoice;
  right: GateChoice;
  passed: boolean;
};

type WeaponGate = {
  id: number;
  y: number;
  left: WeaponType;
  right: WeaponType;
  passed: boolean;
};

type Projectile = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  splash: number;
  color: string;
  life: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

type CoinFx = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  life: number;
  delay: number;
};

export type HudData = {
  squad: number;
  score: number;
  progress: number;
  stage: number;
  coins: number;
  combo: number;
  weapon: WeaponType;
  bossHealth: number | null;
  bossMaxHealth: number | null;
};

export type StageResult = {
  stage: number;
  won: boolean;
  score: number;
  squad: number;
  coinsEarned: number;
  upgraded: Array<keyof GameSave["upgrades"]>;
  save: GameSave;
};

type GameCallbacks = {
  onStateChange: (state: GameState) => void;
  onHudUpdate: (data: HudData) => void;
  onMessage: (message: string, tone?: "good" | "bad" | "weapon") => void;
  onStageEnd: (result: StageResult) => void;
  onSave: (save: GameSave) => void;
};

const ROAD_MIN_X = 0.16;
const ROAD_MAX_X = 0.84;
const PLAYER_Y = 0.87;
const TRAVEL_SPEED = 0.055;
const TARGET_SPEED = 0.18;
const SEGMENT_LOOKAHEAD = 0.17;
const WEAPON_LABELS: Record<WeaponType, string> = {
  blaster: "BLASTER",
  machineGun: "MINIGUN",
  shotgun: "SHOTGUN",
  rocket: "ROCKET",
};

export class SquadRushGame {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private audio: AudioEngine;
  private callbacks: GameCallbacks;
  private save: GameSave;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private state: GameState = "menu";
  private stage: StageDefinition;
  private progress = 0;
  private playerX = 0.5;
  private targetX = 0.5;
  private pointerActive = false;
  private leftHeld = false;
  private rightHeld = false;
  private squad = 5;
  private weapon: WeaponType = "blaster";
  private score = 0;
  private stageCoins = 0;
  private combo = 0;
  private comboTimer = 0;
  private maxSquad = 5;
  private targets: Target[] = [];
  private gates: GatePair[] = [];
  private weaponGates: WeaponGate[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private coinFx: CoinFx[] = [];
  private spawnedSegments = new Set<number>();
  private nextId = 1;
  private fireTimer = 0;
  private lastTime = 0;
  private roadOffset = 0;
  private shake = 0;
  private flash = 0;
  private bossActive = false;
  private boss: Target | null = null;
  private transitionTimer = 0;
  private messageText = "";
  private messageLife = 0;
  private rushPulse = 0;

  constructor(
    canvas: HTMLCanvasElement,
    audio: AudioEngine,
    save: GameSave,
    callbacks: GameCallbacks,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.canvas = canvas;
    this.context = context;
    this.audio = audio;
    this.save = structuredClone(save);
    this.callbacks = callbacks;
    this.stage = getStageDefinition(
      this.save.currentStage,
      this.save.failures,
      this.save.upgrades,
      20260611,
      this.save.carrySquad,
    );
    this.bindInputs();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame((time) => this.loop(time));
  }

  start(): void {
    this.loadStage(this.save.currentStage);
  }

  retry(): void {
    this.loadStage(this.save.currentStage);
  }

  togglePause(): void {
    if (this.state === "playing") {
      this.setState("paused");
    } else if (this.state === "paused") {
      this.lastTime = performance.now();
      this.setState("playing");
    }
  }

  resume(): void {
    if (this.state === "paused") {
      this.lastTime = performance.now();
      this.setState("playing");
    }
  }

  getSave(): GameSave {
    return structuredClone(this.save);
  }

  private loadStage(stageNumber: number): void {
    this.stage = getStageDefinition(
      stageNumber,
      this.save.failures,
      this.save.upgrades,
      20260611,
      this.save.carrySquad,
    );
    this.progress = 0;
    this.playerX = 0.5;
    this.targetX = 0.5;
    this.squad = this.stage.startSquad;
    this.maxSquad = this.squad;
    this.weapon = "blaster";
    this.score = 0;
    this.stageCoins = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.targets = [];
    this.gates = [];
    this.weaponGates = [];
    this.projectiles = [];
    this.particles = [];
    this.coinFx = [];
    this.spawnedSegments.clear();
    this.fireTimer = 0;
    this.roadOffset = 0;
    this.shake = 0;
    this.flash = 0;
    this.bossActive = false;
    this.boss = null;
    this.transitionTimer = 0;
    this.showMessage(`STAGE ${stageNumber}`, "good", 1.4);
    this.setState("playing");
  }

  private setState(state: GameState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  private bindInputs(): void {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key.toLowerCase() === "p") {
        this.togglePause();
        return;
      }
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        this.leftHeld = true;
      }
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        this.rightHeld = true;
      }
    });
    window.addEventListener("keyup", (event) => {
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") this.leftHeld = false;
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") this.rightHeld = false;
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (this.state !== "playing") return;
      this.pointerActive = true;
      this.canvas.setPointerCapture(event.pointerId);
      this.updatePointer(event);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.pointerActive && this.state === "playing") this.updatePointer(event);
    });
    const release = () => {
      this.pointerActive = false;
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const normalized = (event.clientX - rect.left) / rect.width;
    this.targetX = clamp(normalized, ROAD_MIN_X, ROAD_MAX_X);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, rect.width);
    this.height = Math.max(520, rect.height);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private loop(time: number): void {
    const delta = Math.min((time - this.lastTime) / 1000 || 0, 0.05);
    this.lastTime = time;
    if (this.state === "playing") this.update(delta);
    if (this.state === "stageClear") this.updateTransition(delta);
    this.render(time / 1000);
    requestAnimationFrame((next) => this.loop(next));
  }

  private update(delta: number): void {
    const direction = Number(this.rightHeld) - Number(this.leftHeld);
    if (direction !== 0) this.targetX = clamp(this.targetX + direction * delta * 0.54, ROAD_MIN_X, ROAD_MAX_X);
    this.playerX += (this.targetX - this.playerX) * Math.min(1, delta * 11);
    this.roadOffset = (this.roadOffset + delta * 260) % 105;
    this.shake = Math.max(0, this.shake - delta * 3.4);
    this.flash = Math.max(0, this.flash - delta * 3.5);
    this.messageLife = Math.max(0, this.messageLife - delta);
    this.rushPulse = Math.max(0, this.rushPulse - delta * 2.4);
    this.comboTimer -= delta;
    if (this.comboTimer <= 0) this.combo = 0;
    this.audio.updateMusic(delta, Math.min(1, this.stage.stage / 12));

    if (!this.bossActive) {
      this.progress = Math.min(1, this.progress + (TRAVEL_SPEED / this.stage.length) * 22 * delta);
      this.spawnSegments();
      if (this.progress >= 0.985 && this.targets.length === 0 && this.gates.length === 0 && this.weaponGates.length === 0) {
        this.spawnBoss();
      }
    }

    this.updateWorld(delta);
    this.updateFiring(delta);
    this.updateProjectiles(delta);
    this.updateParticles(delta);
    this.updateCoinFx(delta);

    this.score += delta * (12 + this.combo * 1.8);
    this.maxSquad = Math.max(this.maxSquad, this.squad);
    this.pushHud();
  }

  private spawnSegments(): void {
    this.stage.segments.forEach((segment, index) => {
      if (this.spawnedSegments.has(index)) return;
      if (segment.at <= this.progress + SEGMENT_LOOKAHEAD) {
        this.spawnedSegments.add(index);
        this.spawnSegment(segment);
      }
    });
  }

  private spawnSegment(segment: StageSegment): void {
    if (segment.type === "gates") {
      this.gates.push({ id: this.nextId++, y: -85, left: segment.left, right: segment.right, passed: false });
      return;
    }
    if (segment.type === "weapon") {
      this.weaponGates.push({ id: this.nextId++, y: -85, left: segment.left, right: segment.right, passed: false });
      return;
    }
    if (segment.type === "tires") {
      this.targets.push({
        id: this.nextId++,
        kind: "tires",
        x: segment.x,
        y: -70,
        health: segment.health,
        maxHealth: segment.health,
        radius: 34,
        dead: false,
        phase: 0,
      });
      return;
    }
    const columns = Math.max(1, Math.min(3, Math.ceil(segment.count / 4)));
    for (let index = 0; index < segment.count; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = 0.5 + (column - (columns - 1) / 2) * segment.spread * 0.52;
      this.targets.push({
        id: this.nextId++,
        kind: "enemy",
        x,
        y: -45 - row * 44,
        health: segment.health,
        maxHealth: segment.health,
        radius: 15,
        dead: false,
        phase: index * 0.7,
      });
    }
  }

  private spawnBoss(): void {
    this.bossActive = true;
    this.audio.boss();
    this.boss = {
      id: this.nextId++,
      kind: "boss",
      x: 0.5,
      y: this.height * 0.19,
      health: this.stage.bossHealth,
      maxHealth: this.stage.bossHealth,
      radius: 62,
      dead: false,
      phase: 0,
    };
    this.targets.push(this.boss);
    this.showMessage("BOSS!", "bad", 1.2);
  }

  private updateWorld(delta: number): void {
    const speed = this.height * TARGET_SPEED;
    this.gates.forEach((gate) => {
      gate.y += speed * delta;
      if (!gate.passed && gate.y >= this.height * 0.76) {
        gate.passed = true;
        const choice = this.playerX < 0.5 ? gate.left : gate.right;
        const before = this.squad;
        this.squad = applyGate(this.squad, choice);
        const difference = this.squad - before;
        this.audio.gate();
        this.burst(this.px(this.playerX), this.height * PLAYER_Y, difference >= 0 ? "#62d472" : "#ff6d77", 24);
        this.showMessage(`${this.gateLabel(choice)} ${difference >= 0 ? `+${difference}` : difference}`, difference >= 0 ? "good" : "bad");
      }
    });
    this.gates = this.gates.filter((gate) => gate.y < this.height + 100 && !gate.passed);

    this.weaponGates.forEach((gate) => {
      gate.y += speed * delta;
      if (!gate.passed && gate.y >= this.height * 0.76) {
        gate.passed = true;
        this.weapon = this.playerX < 0.5 ? gate.left : gate.right;
        this.audio.gate();
        this.showMessage(WEAPON_LABELS[this.weapon], "weapon", 1.25);
      }
    });
    this.weaponGates = this.weaponGates.filter((gate) => gate.y < this.height + 100 && !gate.passed);

    this.targets.forEach((target) => {
      if (target.dead || target.kind === "boss") return;
      target.y += speed * delta;
      target.phase += delta;
      if (target.y >= this.height * 0.83) this.collideTarget(target);
    });
    this.targets = this.targets.filter((target) => !target.dead && target.y < this.height + 100);
  }

  private updateFiring(delta: number): void {
    this.fireTimer -= delta;
    const target = this.findTarget();
    if (!target || this.fireTimer > 0) return;
    const stats = WEAPONS[this.weapon];
    const rateMultiplier = 1 + this.save.upgrades.fireRate * 0.08;
    this.fireTimer = stats.interval / rateMultiplier;
    const shots = Math.min(stats.pellets, this.weapon === "shotgun" ? 5 : 1);
    const originX = this.px(this.playerX);
    const originY = this.height * (PLAYER_Y - 0.05);
    for (let index = 0; index < shots; index += 1) {
      const spread = shots === 1 ? 0 : (index - (shots - 1) / 2) * 0.085;
      const targetX = this.px(target.x + spread);
      const targetY = target.y;
      const angle = Math.atan2(targetY - originY, targetX - originX);
      const crowdPower = Math.max(1, Math.sqrt(this.squad) * 1.38 + Math.log10(this.squad + 1) * 0.9);
      const damage = stats.damage * (1 + this.save.upgrades.damage * 0.12) * crowdPower;
      this.projectiles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * 760,
        vy: Math.sin(angle) * 760,
        damage,
        splash: stats.splash,
        color: this.weapon === "rocket" ? "#ff8a3d" : this.weapon === "shotgun" ? "#ffe277" : "#fff4a9",
        life: 1.2,
      });
    }
    this.audio.shoot(this.weapon);
  }

  private findTarget(): Target | null {
    const live = this.targets.filter((target) => !target.dead && target.y < this.height * 0.82);
    if (live.length === 0) return null;
    return live.sort((a, b) => b.y - a.y || Math.abs(a.x - this.playerX) - Math.abs(b.x - this.playerX))[0];
  }

  private updateProjectiles(delta: number): void {
    this.projectiles.forEach((projectile) => {
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      projectile.life -= delta;
      for (const target of this.targets) {
        if (target.dead) continue;
        const dx = projectile.x - this.px(target.x);
        const dy = projectile.y - target.y;
        if (dx * dx + dy * dy < (target.radius + 8) ** 2) {
          projectile.life = 0;
          this.damageTarget(target, projectile.damage, projectile.splash);
          break;
        }
      }
    });
    this.projectiles = this.projectiles.filter((projectile) => projectile.life > 0);
  }

  private damageTarget(target: Target, damage: number, splash: number): void {
    target.health -= damage;
    this.burst(this.px(target.x), target.y, target.kind === "tires" ? "#555555" : "#ff665c", 3);
    const splashDeaths: Target[] = [];
    if (splash > 0) {
      this.targets.forEach((other) => {
        if (other === target || other.dead) return;
        const dx = this.px(other.x) - this.px(target.x);
        const dy = other.y - target.y;
        if (dx * dx + dy * dy < splash * splash) {
          other.health -= damage * 0.42;
          if (other.health <= 0) splashDeaths.push(other);
        }
      });
    }
    if (target.health <= 0) this.killTarget(target);
    splashDeaths.forEach((other) => this.killTarget(other));
  }

  private killTarget(target: Target): void {
    target.dead = true;
    const reward = target.kind === "boss" ? 30 + this.stage.stage * 6 : target.kind === "tires" ? 5 : 1;
    this.stageCoins += reward;
    this.combo += 1;
    this.comboTimer = 2.6;
    this.rushPulse = Math.min(1, this.rushPulse + 0.18);
    this.score += reward * 50 * Math.max(1, this.combo);
    this.audio.hit();
    this.burst(
      this.px(target.x),
      target.y,
      target.kind === "boss" ? "#b45cff" : this.combo >= 10 ? "#ffd84f" : "#ff765f",
      target.kind === "boss" ? 90 : 18 + Math.min(18, this.combo),
    );
    this.spawnCoins(this.px(target.x), target.y, Math.min(8, Math.max(1, Math.ceil(reward / 4))));
    if (target.kind === "boss") this.completeStage();
    else if (this.combo > 1 && this.combo % 5 === 0) this.showMessage(`${this.combo} COMBO`, "good", 0.8);
  }

  private collideTarget(target: Target): void {
    target.dead = true;
    const loss = target.kind === "tires"
      ? Math.max(1, Math.ceil(target.health / 22))
      : Math.max(1, Math.ceil(target.health / 9));
    this.squad = Math.max(0, this.squad - loss);
    this.combo = 0;
    this.shake = 0.8;
    this.flash = 0.6;
    this.audio.hit();
    this.showMessage(`-${loss}`, "bad", 0.75);
    this.burst(this.px(this.playerX), this.height * PLAYER_Y, "#ff5b61", 28);
    if (this.squad <= 0) this.failStage();
  }

  private completeStage(): void {
    if (this.state !== "playing") return;
    this.audio.win();
    this.save.coins += this.stageCoins;
    this.save.carrySquad = Math.max(this.save.carrySquad, Math.floor(this.squad * 1.12));
    this.save.currentStage = this.stage.stage + 1;
    this.save.highestStage = Math.max(this.save.highestStage, this.save.currentStage);
    this.save.bestScore = Math.max(this.save.bestScore, Math.floor(this.score));
    this.save.failures = 0;
    const upgradeResult = applyAutomaticUpgrades(this.save);
    this.save = upgradeResult.save;
    this.callbacks.onSave(this.getSave());
    this.transitionTimer = 2.6;
    this.setState("stageClear");
    this.callbacks.onStageEnd({
      stage: this.stage.stage,
      won: true,
      score: Math.floor(this.score),
      squad: this.squad,
      coinsEarned: this.stageCoins,
      upgraded: upgradeResult.upgraded,
      save: this.getSave(),
    });
  }

  private failStage(): void {
    if (this.state !== "playing") return;
    this.audio.lose();
    this.save.coins += this.stageCoins;
    this.save.failures += 1;
    this.save.bestScore = Math.max(this.save.bestScore, Math.floor(this.score));
    this.callbacks.onSave(this.getSave());
    this.setState("lost");
    this.callbacks.onStageEnd({
      stage: this.stage.stage,
      won: false,
      score: Math.floor(this.score),
      squad: 0,
      coinsEarned: this.stageCoins,
      upgraded: [],
      save: this.getSave(),
    });
  }

  private updateTransition(delta: number): void {
    this.transitionTimer -= delta;
    this.updateParticles(delta);
    this.updateCoinFx(delta);
    if (this.transitionTimer <= 0) this.loadStage(this.save.currentStage);
  }

  private updateParticles(delta: number): void {
    this.particles.forEach((particle) => {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vy += 85 * delta;
      particle.life -= delta;
    });
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  private pushHud(): void {
    this.callbacks.onHudUpdate({
      squad: this.squad,
      score: this.score,
      progress: this.progress,
      stage: this.stage.stage,
      coins: this.save.coins + this.stageCoins,
      combo: this.combo,
      weapon: this.weapon,
      bossHealth: this.boss && !this.boss.dead ? Math.max(0, this.boss.health) : null,
      bossMaxHealth: this.boss && !this.boss.dead ? this.boss.maxHealth : null,
    });
  }

  private showMessage(message: string, tone: "good" | "bad" | "weapon", duration = 0.95): void {
    this.messageText = message;
    this.messageLife = duration;
    this.callbacks.onMessage(message, tone);
  }

  private gateLabel(gate: GateChoice): string {
    if (gate.operation === "multiply") return `×${gate.value}`;
    if (gate.operation === "subtract") return `-${gate.value}`;
    return `+${gate.value}`;
  }

  private render(time: number): void {
    const context = this.context;
    context.save();
    if (this.shake > 0) {
      context.translate((Math.random() - 0.5) * 12 * this.shake, (Math.random() - 0.5) * 8 * this.shake);
    }
    this.drawWorld(context, time);
    this.drawGates(context);
    this.drawWeaponGates(context);
    this.targets.forEach((target) => this.drawTarget(context, target, time));
    this.drawProjectiles(context);
    if (this.state !== "menu") this.drawCrowd(context, time);
    this.drawParticles(context);
    this.drawCoinFx(context);
    if (this.messageLife > 0) this.drawCenterMessage(context);
    if (this.rushPulse > 0) this.drawRushPulse(context);
    if (this.flash > 0) {
      context.fillStyle = `rgba(255, 70, 75, ${this.flash * 0.2})`;
      context.fillRect(0, 0, this.width, this.height);
    }
    context.restore();
  }

  private drawWorld(context: CanvasRenderingContext2D, time: number): void {
    const sky = context.createLinearGradient(0, 0, 0, this.height * 0.48);
    sky.addColorStop(0, "#b8dded");
    sky.addColorStop(1, "#e9f3ed");
    context.fillStyle = sky;
    context.fillRect(0, 0, this.width, this.height);
    context.fillStyle = "#65dc58";
    context.fillRect(0, this.height * 0.27, this.width, this.height * 0.73);

    this.drawTrees(context, time);

    const leftTop = this.width * 0.32;
    const rightTop = this.width * 0.68;
    const leftBottom = this.width * 0.035;
    const rightBottom = this.width * 0.965;
    context.fillStyle = "#bfc4ca";
    context.beginPath();
    context.moveTo(leftTop, 0);
    context.lineTo(rightTop, 0);
    context.lineTo(rightBottom, this.height);
    context.lineTo(leftBottom, this.height);
    context.closePath();
    context.fill();

    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(3, this.width * 0.008);
    context.beginPath();
    context.moveTo(leftTop, 0);
    context.lineTo(leftBottom, this.height);
    context.moveTo(rightTop, 0);
    context.lineTo(rightBottom, this.height);
    context.stroke();

    context.save();
    context.strokeStyle = "rgba(255,255,255,0.94)";
    context.lineWidth = Math.max(3, this.width * 0.009);
    context.setLineDash([32, 36]);
    context.lineDashOffset = this.roadOffset;
    context.beginPath();
    context.moveTo(this.width / 2, -20);
    context.lineTo(this.width / 2, this.height + 20);
    context.stroke();
    context.restore();

    context.strokeStyle = "#80878b";
    context.lineWidth = 2;
    for (const side of [-1, 1]) {
      const bottom = side < 0 ? leftBottom - 8 : rightBottom + 8;
      const top = side < 0 ? leftTop - 3 : rightTop + 3;
      context.beginPath();
      context.moveTo(top, 0);
      context.lineTo(bottom, this.height);
      context.stroke();
    }
  }

  private drawTrees(context: CanvasRenderingContext2D, time: number): void {
    for (let index = 0; index < 14; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      const y = ((row * 145 + this.roadOffset * 1.4) % (this.height + 180)) - 60;
      const perspective = clamp(y / this.height, 0.15, 1);
      const roadEdge = side < 0
        ? this.width * (0.32 - 0.285 * perspective)
        : this.width * (0.68 + 0.285 * perspective);
      const x = roadEdge + side * (25 + (row % 3) * 18);
      const scale = 0.35 + perspective * 0.75;
      context.save();
      context.translate(x, y + Math.sin(time + index) * 1.2);
      context.scale(scale, scale);
      context.fillStyle = "#75503a";
      context.fillRect(-5, 2, 10, 34);
      context.fillStyle = index % 3 === 0 ? "#2e9d3d" : "#42b84c";
      context.beginPath();
      context.arc(-9, -8, 20, 0, Math.PI * 2);
      context.arc(9, -17, 24, 0, Math.PI * 2);
      context.arc(20, 1, 18, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  private drawGates(context: CanvasRenderingContext2D): void {
    this.gates.forEach((gate) => {
      const perspective = 0.5 + clamp(gate.y / this.height, 0, 1) * 0.75;
      const roadLeft = this.roadXAt(0, gate.y);
      const roadRight = this.roadXAt(1, gate.y);
      const mid = (roadLeft + roadRight) / 2;
      this.drawGateHalf(context, roadLeft, gate.y, mid - roadLeft, gate.left, perspective);
      this.drawGateHalf(context, mid, gate.y, roadRight - mid, gate.right, perspective);
    });
  }

  private drawGateHalf(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    choice: GateChoice,
    scale: number,
  ): void {
    const bad = choice.operation === "subtract";
    context.fillStyle = bad ? "rgba(244, 100, 113, 0.67)" : choice.operation === "multiply" ? "rgba(245, 211, 78, 0.72)" : "rgba(99, 225, 161, 0.7)";
    context.strokeStyle = "rgba(255,255,255,0.9)";
    context.lineWidth = 3;
    context.fillRect(x, y - 29 * scale, width, 58 * scale);
    context.strokeRect(x, y - 29 * scale, width, 58 * scale);
    context.fillStyle = "#ffffff";
    context.strokeStyle = "rgba(45,55,65,0.45)";
    context.lineWidth = 4;
    context.font = `900 ${Math.round(24 * scale)}px "Arial Rounded MT Bold", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const label = this.gateLabel(choice);
    context.strokeText(label, x + width / 2, y);
    context.fillText(label, x + width / 2, y);
  }

  private drawWeaponGates(context: CanvasRenderingContext2D): void {
    this.weaponGates.forEach((gate) => {
      const perspective = 0.5 + clamp(gate.y / this.height, 0, 1) * 0.75;
      const roadLeft = this.roadXAt(0, gate.y);
      const roadRight = this.roadXAt(1, gate.y);
      const mid = (roadLeft + roadRight) / 2;
      this.drawWeaponHalf(context, roadLeft, gate.y, mid - roadLeft, gate.left, perspective);
      this.drawWeaponHalf(context, mid, gate.y, roadRight - mid, gate.right, perspective);
    });
  }

  private drawWeaponHalf(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    weapon: WeaponType,
    scale: number,
  ): void {
    context.fillStyle = "rgba(121, 211, 244, 0.74)";
    context.strokeStyle = "#ffffff";
    context.lineWidth = 3;
    context.fillRect(x, y - 29 * scale, width, 58 * scale);
    context.strokeRect(x, y - 29 * scale, width, 58 * scale);
    context.fillStyle = "#ffffff";
    context.font = `800 ${Math.max(10, Math.round(15 * scale))}px "Arial Rounded MT Bold", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(WEAPON_LABELS[weapon], x + width / 2, y);
  }

  private drawTarget(context: CanvasRenderingContext2D, target: Target, time: number): void {
    if (target.dead) return;
    const x = this.px(target.x);
    if (target.kind === "enemy") {
      const scale = 0.55 + clamp(target.y / this.height, 0, 1) * 0.75;
      this.drawPerson(context, x, target.y + Math.sin(time * 7 + target.phase) * 2, "#e64f50", scale);
      this.drawHealthBadge(context, x, target.y - 28 * scale, target.health, target.maxHealth, scale);
      return;
    }
    if (target.kind === "tires") {
      const scale = 0.55 + clamp(target.y / this.height, 0, 1) * 0.7;
      context.save();
      context.translate(x, target.y);
      context.scale(scale, scale);
      for (let index = 0; index < 3; index += 1) {
        context.fillStyle = "#202326";
        context.beginPath();
        context.ellipse(0, 18 - index * 17, 36, 15, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#53575a";
        context.beginPath();
        context.ellipse(0, 14 - index * 17, 17, 7, 0, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
      this.drawHealthBadge(context, x, target.y - 46 * scale, target.health, target.maxHealth, scale);
      return;
    }
    this.drawBoss(context, target, time);
  }

  private drawBoss(context: CanvasRenderingContext2D, boss: Target, time: number): void {
    const x = this.px(boss.x);
    const y = boss.y + Math.sin(time * 2.3) * 3;
    const scale = Math.min(1.35, 0.95 + this.stage.stage * 0.015);
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.fillStyle = "rgba(36,29,48,0.2)";
    context.beginPath();
    context.ellipse(0, 54, 48, 13, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#803ec1";
    context.beginPath();
    context.roundRect(-37, -26, 74, 86, 24);
    context.fill();
    context.fillStyle = "#a552e0";
    context.beginPath();
    context.arc(0, -39, 29, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#6c2aa8";
    for (let index = 0; index < 5; index += 1) {
      context.beginPath();
      context.moveTo(-28 + index * 14, -60);
      context.lineTo(-22 + index * 14, -87 - (index % 2) * 8);
      context.lineTo(-14 + index * 14, -60);
      context.fill();
    }
    context.fillStyle = "#ff4f9c";
    context.beginPath();
    context.arc(-10, -40, 4, 0, Math.PI * 2);
    context.arc(10, -40, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  private drawHealthBadge(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    health: number,
    maxHealth: number,
    scale: number,
  ): void {
    const width = 46 * scale;
    const height = 17 * scale;
    context.fillStyle = "#222a31";
    context.beginPath();
    context.roundRect(x - width / 2, y - height / 2, width, height, 5 * scale);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = `800 ${Math.max(8, 11 * scale)}px "Arial Rounded MT Bold", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(formatCount(Math.max(0, health)), x, y);
    if (maxHealth > 50) {
      context.fillStyle = "#5dda6c";
      context.fillRect(x - width / 2, y + height / 2 + 2, width * clamp(health / maxHealth, 0, 1), 3);
    }
  }

  private drawCrowd(context: CanvasRenderingContext2D, time: number): void {
    const count = Math.min(72, Math.max(1, Math.round(10 + Math.log2(Math.max(1, this.squad)) * 6)));
    const centerX = this.px(this.playerX);
    const baseY = this.height * PLAYER_Y;
    const columns = Math.min(12, Math.ceil(Math.sqrt(count * 1.6)));
    for (let index = count - 1; index >= 0; index -= 1) {
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, count - row * columns);
      const column = index % columns;
      const spread = Math.min(this.width * 0.34, 24 * rowCount);
      const offsetX = rowCount === 1 ? 0 : (column / (rowCount - 1) - 0.5) * spread;
      const offsetY = row * 17 + Math.abs(offsetX) * 0.055;
      const bob = Math.sin(time * 8 + index * 0.8) * 1.5;
      this.drawPerson(context, centerX + offsetX, baseY + offsetY + bob, "#2478d2", row === 0 ? 0.92 : 0.72);
    }
    const badgeY = baseY - 40;
    context.fillStyle = "#172439";
    context.beginPath();
    context.roundRect(centerX - 34, badgeY - 15, 68, 30, 14);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "900 15px 'Arial Rounded MT Bold', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${formatCount(this.squad)}人`, centerX, badgeY);
  }

  private drawPerson(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    scale: number,
  ): void {
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.fillStyle = "rgba(26,45,72,0.17)";
    context.beginPath();
    context.ellipse(0, 16, 9, 4, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f0c7a7";
    context.beginPath();
    context.arc(0, -8, 6, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(-7, -2, 14, 16, 5);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-4, 10);
    context.lineTo(-7, 18);
    context.moveTo(4, 10);
    context.lineTo(7, 18);
    context.moveTo(-6, 2);
    context.lineTo(-11, 8);
    context.moveTo(6, 2);
    context.lineTo(11, 8);
    context.stroke();
    context.restore();
  }

  private drawProjectiles(context: CanvasRenderingContext2D): void {
    this.projectiles.forEach((projectile) => {
      context.strokeStyle = projectile.color;
      context.lineWidth = projectile.splash > 0 ? 6 : 3;
      context.shadowColor = projectile.color;
      context.shadowBlur = 8;
      context.beginPath();
      context.moveTo(projectile.x - projectile.vx * 0.018, projectile.y - projectile.vy * 0.018);
      context.lineTo(projectile.x, projectile.y);
      context.stroke();
      context.shadowBlur = 0;
    });
  }

  private drawParticles(context: CanvasRenderingContext2D): void {
    this.particles.forEach((particle) => {
      context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, particle.size, particle.size);
    });
    context.globalAlpha = 1;
  }

  private spawnCoins(x: number, y: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.coinFx.push({
        x,
        y,
        startX: x + (Math.random() - 0.5) * 40,
        startY: y + (Math.random() - 0.5) * 25,
        life: 1,
        delay: index * 0.045,
      });
    }
  }

  private updateCoinFx(delta: number): void {
    this.coinFx.forEach((coin) => {
      coin.delay -= delta;
      if (coin.delay > 0) return;
      coin.life -= delta * 1.35;
      const progress = 1 - clamp(coin.life, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      coin.x = coin.startX + (30 - coin.startX) * eased;
      coin.y = coin.startY + (this.height - 34 - coin.startY) * eased;
    });
    this.coinFx = this.coinFx.filter((coin) => coin.life > 0);
  }

  private drawCoinFx(context: CanvasRenderingContext2D): void {
    this.coinFx.forEach((coin) => {
      if (coin.delay > 0) return;
      context.fillStyle = "#ffd54d";
      context.strokeStyle = "#fff0a3";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(coin.x, coin.y, 6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
  }

  private drawCenterMessage(context: CanvasRenderingContext2D): void {
    const alpha = clamp(this.messageLife * 2.2, 0, 1);
    context.globalAlpha = alpha;
    context.fillStyle = "#ffffff";
    context.strokeStyle = this.messageText.includes("-") ? "#de4651" : "#238f4b";
    context.lineWidth = 7;
    context.font = `900 ${Math.min(54, this.width * 0.085)}px "Arial Rounded MT Bold", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.strokeText(this.messageText, this.width / 2, this.height * 0.59);
    context.fillText(this.messageText, this.width / 2, this.height * 0.59);
    context.globalAlpha = 1;
  }

  private drawRushPulse(context: CanvasRenderingContext2D): void {
    const gradient = context.createRadialGradient(
      this.width / 2,
      this.height * 0.72,
      0,
      this.width / 2,
      this.height * 0.72,
      this.width * 0.72,
    );
    gradient.addColorStop(0, `rgba(255, 223, 81, ${this.rushPulse * 0.1})`);
    gradient.addColorStop(0.58, "transparent");
    gradient.addColorStop(1, `rgba(255, 255, 255, ${this.rushPulse * 0.16})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);
  }

  private burst(x: number, y: number, color: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 150;
      const life = 0.3 + Math.random() * 0.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        color,
        size: 2 + Math.random() * 4,
      });
    }
  }

  private px(normalizedX: number): number {
    return this.roadXAt(normalizedX, this.height * PLAYER_Y);
  }

  private roadXAt(normalizedX: number, y: number): number {
    const perspective = clamp(y / this.height, 0, 1);
    const left = this.width * (0.32 - 0.285 * perspective);
    const right = this.width * (0.68 + 0.285 * perspective);
    return left + (right - left) * normalizedX;
  }

  getFormattedScore(score: number): string {
    return formatScore(score);
  }
}
