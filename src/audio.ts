type ToneOptions = {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  endFrequency?: number;
};

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private beatTimer = 0;
  private beatStep = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.18, this.context.currentTime, 0.025);
    }
    return this.muted;
  }

  updateMusic(delta: number, intensity: number): void {
    if (!this.context || this.muted) return;
    this.beatTimer -= delta;
    if (this.beatTimer > 0) return;

    const interval = 0.28 - intensity * 0.06;
    this.beatTimer = interval;
    const bass = [55, 55, 73.42, 65.41][this.beatStep % 4];
    this.tone({ frequency: bass, duration: 0.12, type: "sawtooth", gain: 0.035 });
    if (this.beatStep % 2 === 0) {
      this.noise(0.035, 0.018);
    }
    this.beatStep += 1;
  }

  move(): void {
    this.tone({ frequency: 180, endFrequency: 280, duration: 0.07, type: "square", gain: 0.05 });
  }

  recruit(): void {
    this.chord([440, 554.37, 659.25], 0.12, "sine", 0.035);
  }

  crystal(): void {
    this.chord([880, 1174.66], 0.16, "sine", 0.025);
  }

  hit(): void {
    this.noise(0.13, 0.08);
    this.tone({ frequency: 95, endFrequency: 44, duration: 0.18, type: "sawtooth", gain: 0.07 });
  }

  gate(): void {
    this.chord([220, 329.63, 440], 0.22, "triangle", 0.04);
  }

  boss(): void {
    this.chord([55, 58.27, 82.41], 0.65, "sawtooth", 0.055);
  }

  win(): void {
    [261.63, 329.63, 392, 523.25].forEach((frequency, index) => {
      window.setTimeout(() => {
        this.tone({ frequency, duration: 0.3, type: "triangle", gain: 0.055 });
      }, index * 100);
    });
  }

  lose(): void {
    this.tone({ frequency: 180, endFrequency: 42, duration: 0.7, type: "sawtooth", gain: 0.075 });
  }

  private tone(options: ToneOptions): void {
    if (!this.context || !this.master || this.muted) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = options.type ?? "sine";
    oscillator.frequency.setValueAtTime(options.frequency, now);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, now + options.duration);
    }
    gain.gain.setValueAtTime(options.gain ?? 0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + options.duration);
  }

  private chord(frequencies: number[], duration: number, type: OscillatorType, gain: number): void {
    frequencies.forEach((frequency) => this.tone({ frequency, duration, type, gain }));
  }

  private noise(duration: number, gainValue: number): void {
    if (!this.context || !this.master || this.muted) return;
    const length = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    source.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.value = 800;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
  }
}
