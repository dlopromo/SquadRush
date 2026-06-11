import { AudioEngine } from "./audio";
import {
  canDefeat,
  clamp,
  formatScore,
  moveLane,
  progressAt,
  resolveDamage,
  resolveGate,
  resolveRecruit,
  zoneAt,
} from "./logic";

type GameState = "menu" | "playing" | "paused" | "won" | "lost";
type EntityKind = "recruit" | "crystal" | "hazard" | "enemy" | "gate";
type GateOperation = "add" | "multiply";

type Entity = {
  id: number;
  kind: EntityKind;
  lane: number;
  y: number;
  size: number;
  value: number;
  operation?: GateOperation;
  hit: boolean;
  phase: number;
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

type Bolt = {
  lane: number;
  y: number;
  speed: number;
};

type GameCallbacks = {
  onStateChange: (state: GameState) => void;
  onHudUpdate: (data: HudData) => void;
  onToast: (message: string, tone?: "good" | "bad" | "neutral") => void;
  onEnd: (result: GameResult) => void;
};

export type HudData = {
  squad: number;
  score: number;
  progress: number;
  zone: number;
};

export type GameResult = {
  won: boolean;
  score: number;
  maxSquad: number;
};

const GAME_DURATION = 52;
const BOSS_START = 0.84;
const ZONES = [
  { name: "青青草原", bg: "#86d7ff", road: "#e9d5aa", accent: "#64b84d" },
  { name: "櫻花山道", bg: "#9bdcff", road: "#e7cda7", accent: "#f58bb2" },
  { name: "巨人城堡", bg: "#ffc777", road: "#d9c19a", accent: "#ef765c" },
] as const;

export class SwarmGame {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private audio: AudioEngine;
  private callbacks: GameCallbacks;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private state: GameState = "menu";
  private lastTime = 0;
  private elapsed = 0;
  private lane = 1;
  private playerX = 0;
  private targetX = 0;
  private squad = 6;
  private maxSquad = 6;
  private score = 0;
  private energy = 0;
  private entities: Entity[] = [];
  private particles: Particle[] = [];
  private bolts: Bolt[] = [];
  private spawnTimer = 0;
  private entityId = 0;
  private roadOffset = 0;
  private shake = 0;
  private flash = 0;
  private bossHealth = 100;
  private bossActive = false;
  private bossShotTimer = 0;
  private pointerActive = false;
  private previousPointerX = 0;
  private backgroundSeed = Array.from({ length: 32 }, (_, index) => ({
    x: ((index * 47) % 101) / 100,
    y: ((index * 73) % 97) / 96,
    size: 1 + (index % 3),
  }));

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine, callbacks: GameCallbacks) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is not available");
    this.canvas = canvas;
    this.context = context;
    this.audio = audio;
    this.callbacks = callbacks;
    this.bindInputs();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    requestAnimationFrame((time) => this.loop(time));
  }

  start(): void {
    this.elapsed = 0;
    this.lane = 1;
    this.squad = 6;
    this.maxSquad = 6;
    this.score = 0;
    this.energy = 0;
    this.entities = [];
    this.particles = [];
    this.bolts = [];
    this.spawnTimer = 0.45;
    this.roadOffset = 0;
    this.shake = 0;
    this.flash = 0;
    this.bossHealth = 100;
    this.bossActive = false;
    this.bossShotTimer = 0.8;
    this.playerX = this.laneX(this.lane);
    this.targetX = this.playerX;
    this.setState("playing");
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
      if (this.state !== "playing" || event.repeat) return;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        this.shiftLane(-1);
      }
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        this.shiftLane(1);
      }
    });

    this.canvas.addEventListener("pointerdown", (event) => {
      if (this.state !== "playing") return;
      this.pointerActive = true;
      this.previousPointerX = event.clientX;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.pointerActive || this.state !== "playing") return;
      const rect = this.canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const nextLane = clamp(Math.floor((localX / rect.width) * 3), 0, 2);
      if (nextLane !== this.lane && Math.abs(event.clientX - this.previousPointerX) > 4) {
        this.lane = nextLane;
        this.targetX = this.laneX(this.lane);
        this.audio.move();
        this.previousPointerX = event.clientX;
      }
    });
    const releasePointer = () => {
      this.pointerActive = false;
    };
    this.canvas.addEventListener("pointerup", releasePointer);
    this.canvas.addEventListener("pointercancel", releasePointer);
  }

  private shiftLane(direction: -1 | 1): void {
    const next = moveLane(this.lane, direction);
    if (next === this.lane) return;
    this.lane = next;
    this.targetX = this.laneX(this.lane);
    this.audio.move();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, rect.width);
    this.height = Math.max(480, rect.height);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.playerX = this.laneX(this.lane);
    this.targetX = this.playerX;
  }

  private loop(time: number): void {
    const delta = Math.min((time - this.lastTime) / 1000 || 0, 0.05);
    this.lastTime = time;
    if (this.state === "playing") this.update(delta);
    this.render(time / 1000);
    requestAnimationFrame((nextTime) => this.loop(nextTime));
  }

  private update(delta: number): void {
    const progress = progressAt(this.elapsed, GAME_DURATION);
    const bossWasActive = this.bossActive;
    this.elapsed += delta;
    this.roadOffset = (this.roadOffset + delta * (280 + progress * 100)) % 120;
    this.playerX += (this.targetX - this.playerX) * Math.min(1, delta * 12);
    this.shake = Math.max(0, this.shake - delta * 2.8);
    this.flash = Math.max(0, this.flash - delta * 3.2);
    this.audio.updateMusic(delta, progress);

    if (progress >= BOSS_START) {
      this.bossActive = true;
      if (!bossWasActive) {
        this.entities = [];
        this.audio.boss();
        this.callbacks.onToast("小心！城堡巨人出現了", "bad");
      }
      this.updateBoss(delta, progress);
    } else {
      this.updateSpawning(delta, progress);
    }

    const speed = 285 + progress * 115;
    this.entities.forEach((entity) => {
      entity.y += speed * delta;
      entity.phase += delta;
      if (!entity.hit && entity.y > this.height * 0.72 && entity.y < this.height * 0.88) {
        if (Math.abs(this.playerX - this.laneX(entity.lane)) < this.laneWidth() * 0.35) {
          this.resolveEntity(entity);
        }
      }
    });
    this.entities = this.entities.filter((entity) => entity.y < this.height + 100 && !entity.hit);

    this.bolts.forEach((bolt) => {
      bolt.y += bolt.speed * delta;
      if (
        bolt.y > this.height * 0.72 &&
        bolt.y < this.height * 0.88 &&
        Math.abs(this.playerX - this.laneX(bolt.lane)) < this.laneWidth() * 0.3
      ) {
        bolt.y = this.height + 100;
        const damage = Math.max(2, Math.ceil(this.squad * 0.16));
        this.squad = resolveDamage(this.squad, damage);
        this.shake = 0.75;
        this.flash = 0.55;
        this.audio.hit();
        this.burst(this.playerX, this.height * 0.79, "#ff704d", 16);
        this.callbacks.onToast(`巨石命中 −${damage}`, "bad");
        if (this.squad <= 0) this.finish(false);
      }
    });
    this.bolts = this.bolts.filter((bolt) => bolt.y < this.height + 80);

    this.particles.forEach((particle) => {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vy += 45 * delta;
      particle.life -= delta;
    });
    this.particles = this.particles.filter((particle) => particle.life > 0);

    this.score += delta * (35 + this.squad * 0.8);
    this.maxSquad = Math.max(this.maxSquad, this.squad);
    this.callbacks.onHudUpdate({
      squad: this.squad,
      score: this.score,
      progress,
      zone: zoneAt(progress),
    });
  }

  private updateSpawning(delta: number, progress: number): void {
    this.spawnTimer -= delta;
    if (this.spawnTimer > 0) return;
    const difficulty = progress * 0.24;
    this.spawnTimer = Math.max(0.42, 0.76 - difficulty) + Math.random() * 0.16;

    const roll = Math.random();
    let kind: EntityKind = "recruit";
    if (roll > 0.78) kind = "enemy";
    else if (roll > 0.63) kind = "hazard";
    else if (roll > 0.47) kind = "crystal";
    else if (roll > 0.35 && progress > 0.12) kind = "gate";

    const lane = Math.floor(Math.random() * 3);
    const basePower = Math.max(2, Math.floor(3 + progress * 9));
    const entity: Entity = {
      id: this.entityId++,
      kind,
      lane,
      y: -70,
      size: kind === "gate" ? 48 : 34,
      value: basePower,
      hit: false,
      phase: Math.random() * 10,
    };

    if (kind === "recruit") entity.value = 2 + Math.floor(Math.random() * 5);
    if (kind === "crystal") entity.value = 80 + Math.floor(Math.random() * 80);
    if (kind === "hazard") entity.value = 2 + Math.floor(progress * 5);
    if (kind === "enemy") entity.value = basePower + Math.floor(Math.random() * 4);
    if (kind === "gate") {
      entity.operation = Math.random() > 0.55 ? "multiply" : "add";
      entity.value = entity.operation === "multiply" ? 1.5 : 5 + Math.floor(progress * 7);
    }
    this.entities.push(entity);

    if (Math.random() > 0.77 && kind !== "gate") {
      const secondLane = (lane + 1 + Math.floor(Math.random() * 2)) % 3;
      const alternateKind: EntityKind = kind === "enemy" || kind === "hazard" ? "recruit" : "hazard";
      this.entities.push({
        id: this.entityId++,
        kind: alternateKind,
        lane: secondLane,
        y: -70,
        size: 34,
        value: alternateKind === "recruit" ? 3 + Math.floor(Math.random() * 4) : 2 + Math.floor(progress * 4),
        hit: false,
        phase: Math.random() * 10,
      });
    }
  }

  private updateBoss(delta: number, progress: number): void {
    this.bossShotTimer -= delta;
    if (this.bossShotTimer <= 0 && this.bossHealth > 0) {
      this.bossShotTimer = Math.max(0.48, 0.9 - (progress - BOSS_START) * 2.2);
      this.bolts.push({
        lane: Math.floor(Math.random() * 3),
        y: this.height * 0.22,
        speed: 300 + progress * 90,
      });
    }
    const damagePerSecond = 1.3 + this.squad * 0.19;
    this.bossHealth = Math.max(0, this.bossHealth - damagePerSecond * delta);
    this.score += damagePerSecond * delta * 10;
    if (Math.random() < delta * 8) {
      this.burst(
        this.width / 2 + (Math.random() - 0.5) * this.width * 0.25,
        this.height * 0.2 + (Math.random() - 0.5) * 50,
        "#ffd343",
        2,
      );
    }
    if (this.bossHealth <= 0) this.finish(true);
    else if (this.elapsed >= GAME_DURATION && this.bossHealth > 0) this.finish(false);
  }

  private resolveEntity(entity: Entity): void {
    entity.hit = true;
    const x = this.laneX(entity.lane);
    const y = entity.y;
    switch (entity.kind) {
      case "recruit":
        this.squad = resolveRecruit(this.squad, entity.value);
        this.score += entity.value * 120;
        this.audio.recruit();
        this.burst(x, y, "#64c952", 14);
        this.callbacks.onToast(`夥伴加入 +${entity.value}`, "good");
        break;
      case "crystal":
        this.energy += entity.value;
        this.score += entity.value;
        if (this.energy >= 300) {
          this.energy -= 300;
          this.squad = resolveRecruit(this.squad, 4);
          this.callbacks.onToast("士氣滿滿：夥伴 +4", "good");
        } else {
          this.callbacks.onToast(`金幣 +${entity.value}`, "neutral");
        }
        this.audio.crystal();
        this.burst(x, y, "#ffd343", 12);
        break;
      case "hazard":
        this.squad = resolveDamage(this.squad, entity.value);
        this.shake = 0.55;
        this.flash = 0.35;
        this.audio.hit();
        this.burst(x, y, "#ff704d", 18);
        this.callbacks.onToast(`踩到陷阱 −${entity.value}`, "bad");
        if (this.squad <= 0) this.finish(false);
        break;
      case "enemy":
        if (canDefeat(this.squad, entity.value)) {
          this.squad = resolveDamage(this.squad, entity.value);
          this.score += entity.value * 180;
          this.shake = 0.22;
          this.audio.hit();
          this.burst(x, y, "#ff835f", 24);
          this.callbacks.onToast(`擊敗敵軍 −${entity.value}`, "neutral");
        } else {
          this.squad = 0;
          this.shake = 1;
          this.audio.lose();
          this.burst(x, y, "#ef4b3e", 34);
          this.finish(false);
        }
        break;
      case "gate": {
        const before = this.squad;
        this.squad = resolveGate(this.squad, entity.operation ?? "add", entity.value);
        this.score += (this.squad - before) * 100;
        this.audio.gate();
        this.burst(x, y, "#63c952", 22);
        const label = entity.operation === "multiply" ? `×${entity.value}` : `+${entity.value}`;
        this.callbacks.onToast(`魔法之門 ${label}`, "good");
        break;
      }
    }
    this.maxSquad = Math.max(this.maxSquad, this.squad);
  }

  private finish(won: boolean): void {
    if (this.state !== "playing") return;
    if (won) {
      this.score += this.squad * 500 + 5000;
      this.audio.win();
    } else {
      this.audio.lose();
    }
    this.setState(won ? "won" : "lost");
    this.callbacks.onEnd({
      won,
      score: Math.floor(this.score),
      maxSquad: this.maxSquad,
    });
  }

  private render(time: number): void {
    const context = this.context;
    const progress = progressAt(this.elapsed, GAME_DURATION);
    const zone = ZONES[zoneAt(progress)];
    context.save();
    if (this.shake > 0) {
      context.translate((Math.random() - 0.5) * 14 * this.shake, (Math.random() - 0.5) * 10 * this.shake);
    }
    this.drawBackground(context, zone, progress, time);
    this.drawRoad(context, zone, time);
    this.entities.forEach((entity) => this.drawEntity(context, entity, time));
    this.bolts.forEach((bolt) => this.drawBolt(context, bolt));
    if (this.bossActive) this.drawBoss(context, time);
    if (this.state !== "menu") this.drawSquad(context, time);
    this.drawParticles(context);
    if (this.flash > 0) {
      context.fillStyle = `rgba(255, 72, 35, ${this.flash * 0.22})`;
      context.fillRect(0, 0, this.width, this.height);
    }
    context.restore();
  }

  private drawBackground(
    context: CanvasRenderingContext2D,
    zone: (typeof ZONES)[number],
    progress: number,
    time: number,
  ): void {
    context.fillStyle = zone.bg;
    context.fillRect(0, 0, this.width, this.height);
    const sky = context.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, zone.bg);
    sky.addColorStop(0.5, "#dff5ff");
    sky.addColorStop(0.501, zoneAt(progress) === 2 ? "#c8a36b" : "#83c969");
    sky.addColorStop(1, zoneAt(progress) === 2 ? "#8f754f" : "#4c9d43");
    context.fillStyle = sky;
    context.fillRect(0, 0, this.width, this.height);

    context.fillStyle = "rgba(255,255,255,0.88)";
    for (let index = 0; index < 6; index += 1) {
      const cloudX = ((this.backgroundSeed[index].x * this.width + time * (5 + index)) % (this.width + 140)) - 70;
      const cloudY = 50 + this.backgroundSeed[index].y * this.height * 0.22;
      context.beginPath();
      context.arc(cloudX, cloudY, 23, 0, Math.PI * 2);
      context.arc(cloudX + 26, cloudY - 8, 30, 0, Math.PI * 2);
      context.arc(cloudX + 57, cloudY + 2, 22, 0, Math.PI * 2);
      context.fill();
    }

    const horizon = this.height * 0.34;
    context.fillStyle = zoneAt(progress) === 2 ? "#755d47" : "#67b756";
    context.beginPath();
    context.moveTo(0, horizon + 38);
    for (let x = 0; x <= this.width; x += 70) {
      context.lineTo(x, horizon + Math.sin(x * 0.018) * 28);
    }
    context.lineTo(this.width, this.height);
    context.lineTo(0, this.height);
    context.closePath();
    context.fill();

    if (progress > 0.68) {
      this.drawCastle(context, this.width / 2, horizon - 12);
    } else {
      for (let index = 0; index < 10; index += 1) {
        const side = index % 2 === 0 ? 0.13 : 0.87;
        const x = this.width * side + Math.sin(index * 4.1) * this.width * 0.08;
        const y = horizon + 35 + (index % 5) * 68;
        this.drawTree(context, x, y, zoneAt(progress) === 1);
      }
    }
  }

  private drawRoad(context: CanvasRenderingContext2D, zone: (typeof ZONES)[number], time: number): void {
    const roadLeft = this.width * 0.08;
    const roadRight = this.width * 0.92;
    context.fillStyle = zone.road;
    context.beginPath();
    context.moveTo(this.width * 0.31, 0);
    context.lineTo(this.width * 0.69, 0);
    context.lineTo(roadRight, this.height);
    context.lineTo(roadLeft, this.height);
    context.closePath();
    context.fill();

    context.strokeStyle = "rgba(112,82,51,0.42)";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(this.width * 0.31, 0);
    context.lineTo(roadLeft, this.height);
    context.moveTo(this.width * 0.69, 0);
    context.lineTo(roadRight, this.height);
    context.stroke();

    for (let y = -80 + this.roadOffset; y < this.height + 100; y += 120) {
      const perspective = clamp(y / this.height, 0.08, 1);
      context.fillStyle = perspective > 0.65 ? "rgba(132,100,63,0.22)" : "rgba(132,100,63,0.11)";
      const laneWidth = this.laneWidthAt(y);
      for (let lane = 0; lane < 3; lane += 1) {
        const x = this.laneXAt(lane, y);
        context.fillRect(x - laneWidth * 0.11, y, laneWidth * 0.22, 2 + perspective * 3);
      }
    }

    const pebbleY = (time * 80) % this.height;
    context.fillStyle = "rgba(128,92,57,0.22)";
    context.beginPath();
    context.ellipse(this.width * 0.46, pebbleY, 6, 3, 0, 0, Math.PI * 2);
    context.fill();
  }

  private drawEntity(context: CanvasRenderingContext2D, entity: Entity, time: number): void {
    const x = this.laneXAt(entity.lane, entity.y);
    const scale = 0.45 + clamp(entity.y / this.height, 0, 1) * 0.75;
    const size = entity.size * scale;
    context.save();
    context.translate(x, entity.y + Math.sin(time * 5 + entity.phase) * 3);
    context.scale(scale, scale);

    switch (entity.kind) {
      case "recruit":
        this.drawRunner(context, 0, 0, "#48aef0", 0.9, true);
        context.fillStyle = "#2c8742";
        this.drawLabel(context, `+${entity.value}`, 0, -32);
        break;
      case "crystal":
        context.rotate(time * 1.8 + entity.phase);
        context.shadowColor = "#ffd343";
        context.shadowBlur = 18;
        context.fillStyle = "#ffd343";
        context.beginPath();
        context.moveTo(0, -size * 0.56);
        context.lineTo(size * 0.34, 0);
        context.lineTo(0, size * 0.56);
        context.lineTo(-size * 0.34, 0);
        context.closePath();
        context.fill();
        context.shadowBlur = 0;
        break;
      case "hazard":
        context.rotate(Math.sin(time * 2 + entity.phase) * 0.1);
        context.fillStyle = "#7b5a3a";
        for (let spike = 0; spike < 8; spike += 1) {
          context.save();
          context.rotate((spike / 8) * Math.PI * 2);
          context.fillRect(-3, -30, 6, 17);
          context.restore();
        }
        context.beginPath();
        context.arc(0, 0, 18, 0, Math.PI * 2);
        context.fill();
        this.drawLabel(context, `−${entity.value}`, 0, -37, "#d84539");
        break;
      case "enemy":
        this.drawEnemy(context, entity.value, time);
        break;
      case "gate": {
        const accent = "#56c64e";
        context.strokeStyle = accent;
        context.lineWidth = 3;
        context.shadowColor = accent;
        context.shadowBlur = 12;
        context.strokeRect(-36, -42, 72, 84);
        context.shadowBlur = 0;
        context.fillStyle = "rgba(255,255,255,0.68)";
        context.fillRect(-34, -40, 68, 80);
        const value = entity.operation === "multiply" ? `×${entity.value}` : `+${entity.value}`;
        context.fillStyle = accent;
        context.font = "800 21px 'Arial Narrow', sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(value, 0, 0);
        break;
      }
    }
    context.restore();
  }

  private drawEnemy(context: CanvasRenderingContext2D, power: number, time: number): void {
    const bob = Math.sin(time * 7) * 1.5;
    this.drawRunner(context, -10, bob + 2, "#e45a4f", 0.85);
    this.drawRunner(context, 10, bob - 1, "#e45a4f", 0.85);
    context.fillStyle = "#bd322d";
    context.beginPath();
    context.arc(0, -35, 13, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "800 14px 'Arial Rounded MT Bold', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`${power}`, 0, -35);
  }

  private drawSquad(context: CanvasRenderingContext2D, time: number): void {
    const playerY = this.height * 0.8;
    const visible = Math.min(this.squad, 24);
    for (let index = visible - 1; index >= 0; index -= 1) {
      const row = Math.floor(index / 5);
      const rowCount = Math.min(5, visible - row * 5);
      const column = index % 5;
      const spread = Math.min(this.laneWidth() * 0.7, 86);
      const offsetX = rowCount === 1 ? 0 : (column / (rowCount - 1) - 0.5) * spread;
      const offsetY = row * 22 + Math.abs(offsetX) * 0.06;
      const pulse = Math.sin(time * 5 + index * 0.7) * 1.5;
      this.drawRunner(context, this.playerX + offsetX, playerY + offsetY + pulse, "#48aef0", row === 0 ? 1 : 0.78);
    }

    if (this.squad > visible) {
      context.fillStyle = "#10120f";
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(this.playerX + 44, playerY + 54, 18, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#ffffff";
      context.font = "800 11px ui-monospace, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(`+${this.squad - visible}`, this.playerX + 44, playerY + 54);
    }
  }

  private drawRunner(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    scale: number,
    neutral = false,
  ): void {
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.shadowColor = "rgba(45, 92, 40, 0.3)";
    context.shadowBlur = 4;
    context.fillStyle = "#f4c8a3";
    context.beginPath();
    context.arc(0, -8, 7, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(-7, -2, 14, 16, 5);
    context.fill();
    context.strokeStyle = neutral ? "#2a76a9" : "#2b78ad";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-4, 11);
    context.lineTo(-7, 21);
    context.moveTo(4, 11);
    context.lineTo(7, 21);
    context.moveTo(-6, 2);
    context.lineTo(-12, 9);
    context.moveTo(6, 2);
    context.lineTo(12, 9);
    context.stroke();
    context.fillStyle = "#5b3828";
    context.beginPath();
    context.arc(0, -11, 7, Math.PI, Math.PI * 2);
    context.fill();
    context.restore();
  }

  private drawBoss(context: CanvasRenderingContext2D, time: number): void {
    const x = this.width / 2;
    const y = this.height * 0.18;
    const pulse = 1 + Math.sin(time * 2.4) * 0.035;
    context.save();
    context.translate(x, y);
    context.scale(pulse, pulse);
    context.rotate(Math.sin(time * 0.8) * 0.035);
    context.shadowColor = "rgba(85,48,29,0.35)";
    context.shadowBlur = 18;
    context.fillStyle = "#9e6746";
    context.beginPath();
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2 - Math.PI / 2;
      const radius = index % 2 === 0 ? 72 : 48;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius * 0.64;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "#d49a70";
    context.beginPath();
    context.arc(0, 0, 25, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#2f211b";
    context.beginPath();
    context.arc(-9, -3, 3, 0, Math.PI * 2);
    context.arc(9, -3, 3, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#2f211b";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(-11, 12);
    context.lineTo(11, 12);
    context.stroke();
    context.restore();

    const barWidth = Math.min(300, this.width * 0.52);
    context.fillStyle = "rgba(0,0,0,0.7)";
    context.fillRect(x - barWidth / 2, y + 70, barWidth, 10);
    context.fillStyle = "#e65744";
    context.fillRect(x - barWidth / 2 + 2, y + 72, (barWidth - 4) * (this.bossHealth / 100), 6);
    context.fillStyle = "#5a3025";
    context.font = "700 10px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("城堡巨人", x, y + 96);
  }

  private drawBolt(context: CanvasRenderingContext2D, bolt: Bolt): void {
    const x = this.laneXAt(bolt.lane, bolt.y);
    const gradient = context.createLinearGradient(x, bolt.y - 45, x, bolt.y + 18);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(1, "#745137");
    context.strokeStyle = gradient;
    context.lineWidth = 6;
    context.shadowColor = "#5e3d29";
    context.shadowBlur = 14;
    context.beginPath();
    context.moveTo(x, bolt.y - 45);
    context.lineTo(x, bolt.y + 18);
    context.stroke();
    context.shadowBlur = 0;
  }

  private drawParticles(context: CanvasRenderingContext2D): void {
    this.particles.forEach((particle) => {
      context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, particle.size, particle.size);
    });
    context.globalAlpha = 1;
  }

  private burst(x: number, y: number, color: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 160;
      const life = 0.35 + Math.random() * 0.45;
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

  private drawLabel(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color = "#2f873f",
  ): void {
    context.fillStyle = color;
    context.font = "800 14px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, x, y);
  }

  private laneWidth(): number {
    return this.width * 0.22;
  }

  private laneWidthAt(y: number): number {
    const perspective = clamp(y / this.height, 0, 1);
    return this.width * (0.115 + perspective * 0.14);
  }

  private laneX(lane: number): number {
    return this.width * (0.28 + lane * 0.22);
  }

  private laneXAt(lane: number, y: number): number {
    const perspective = clamp(y / this.height, 0, 1);
    const spacing = this.width * (0.12 + perspective * 0.1);
    return this.width / 2 + (lane - 1) * spacing;
  }

  private drawTree(context: CanvasRenderingContext2D, x: number, y: number, blossom: boolean): void {
    const scale = 0.45 + clamp(y / this.height, 0, 1) * 0.55;
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.fillStyle = "#785235";
    context.fillRect(-6, 0, 12, 34);
    context.fillStyle = blossom ? "#f38faf" : "#4ea44b";
    context.beginPath();
    context.arc(-15, 0, 22, 0, Math.PI * 2);
    context.arc(10, -13, 27, 0, Math.PI * 2);
    context.arc(25, 7, 20, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  private drawCastle(context: CanvasRenderingContext2D, x: number, y: number): void {
    context.save();
    context.translate(x, y);
    context.fillStyle = "#8b7564";
    context.fillRect(-70, -32, 140, 64);
    context.fillRect(-104, -60, 45, 92);
    context.fillRect(59, -60, 45, 92);
    context.fillStyle = "#675446";
    context.fillRect(-18, 0, 36, 32);
    context.fillStyle = "#ef765c";
    context.beginPath();
    context.moveTo(-110, -60);
    context.lineTo(-81, -94);
    context.lineTo(-53, -60);
    context.moveTo(53, -60);
    context.lineTo(81, -94);
    context.lineTo(110, -60);
    context.fill();
    context.restore();
  }

  getZoneName(index: number): string {
    return ZONES[clamp(index, 0, 2)].name;
  }

  getFormattedScore(score: number): string {
    return formatScore(score);
  }
}
