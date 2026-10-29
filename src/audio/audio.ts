import { FactionId } from '../data/factions';

/**
 * Everything is synthesized with Web Audio — no sound files to download.
 * Music is a generative pentatonic piece (plucked zither over a drone, with war drums when
 * the game turns tense); sound effects are short noise/oscillator recipes.
 */

export type Sfx =
  | 'pick'
  | 'place'
  | 'ui'
  | 'check'
  | 'crash' // rook
  | 'stomp' // horse
  | 'cannon-fire'
  | 'explosion'
  | 'slash' // pawn
  | 'seal' // advisor / elephant
  | 'gong' // king
  | 'victory';

export type MusicTheme = 'menu' | 'battle';

/** Pentatonic intervals (宮商角徵羽) and a home key per faction, so each matchup has its own colour. */
const PENTATONIC = [0, 2, 4, 7, 9];
const FACTION_ROOT: Record<FactionId, number> = {
  chu: 50, // D — 楚調
  han: 48, // C
  shu: 52, // E
  wei: 45, // A
  wu: 53, // F
  qin: 43, // G (low)
  tang: 55, // G
  song: 47, // B
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private musicVolume = 0.5;
  private sfxVolume = 0.8;

  private theme: MusicTheme | null = null;
  private root = 50;
  private tension = false;
  private timer = 0;
  private nextBeat = 0;
  private beat = 0;
  private melodyDegree = 5;
  private drone: { stop(): void } | null = null;
  /** Music requested before audio was unlocked; started on unlock. */
  private pending: [MusicTheme, FactionId | undefined] | null = null;

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.pending) {
      const [theme, faction] = this.pending;
      this.pending = null;
      this.playMusic(theme, faction);
    }
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);

    // Gentle compression keeps explosions from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(this.master);

    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(comp);
    this.sfxBus.connect(comp);
    this.applyVolumes();

    // Synthetic hall reverb: decaying stereo noise.
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(comp);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolumes(music: number, sfx: number) {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.55, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, t, 0.05);
  }

  // ---------- building blocks ----------

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, out: AudioNode, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    this.env(g, t, peak, attack, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  private noiseBurst(t: number, dur: number, peak: number, filter: BiquadFilterType, freq: number, out: AudioNode, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.004, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    return f;
  }

  /** Low boom with a falling pitch — the body of drums and explosions. */
  private boom(t: number, from: number, to: number, dur: number, peak: number, out: AudioNode) {
    const o = this.osc('sine', from, t, dur, peak, out, 0.003);
    o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
  }

  /** Plucked zither note: bright attack, slight pitch settle, mellowing tail. */
  private pluck(freq: number, t: number, peak: number, out: AudioNode, dur = 1.6) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 9, t);
    f.frequency.exponentialRampToValueAtTime(freq * 2, t + 0.5);
    f.connect(out);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    f.connect(send).connect(this.reverb);
    [
      [1, 1],
      [2, 0.45],
      [3, 0.2],
      [4.02, 0.08],
    ].forEach(([mult, amp]) => {
      const o = this.osc(mult === 1 ? 'triangle' : 'sine', freq * mult * 1.012, t, dur / mult, peak * amp, f, 0.004);
      o.frequency.exponentialRampToValueAtTime(freq * mult, t + 0.06);
    });
  }

  private gong(t: number, base: number, peak: number, out: AudioNode) {
    [1, 1.48, 2.09, 2.76, 3.42, 4.1].forEach((m, i) => {
      const o = this.osc('sine', base * m, t, 3.5 - i * 0.4, peak / (1 + i * 0.7), out, 0.01);
      o.frequency.setValueAtTime(base * m * 1.01, t);
      o.frequency.exponentialRampToValueAtTime(base * m, t + 0.8);
    });
    this.noiseBurst(t, 0.3, peak * 0.4, 'bandpass', 1800, out, 0.8);
  }

  private drum(t: number, peak: number, out: AudioNode) {
    this.boom(t, 150, 55, 0.45, peak, out);
    this.noiseBurst(t, 0.08, peak * 0.5, 'lowpass', 600, out);
  }

  // ---------- sound effects ----------

  play(name: Sfx) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.01;
    const out = this.sfxBus;
    const verb = this.reverb;
    switch (name) {
      case 'pick':
        this.noiseBurst(t, 0.035, 0.25, 'bandpass', 2600, out, 4);
        this.osc('sine', 1300, t, 0.04, 0.08, out);
        break;
      case 'place':
        this.boom(t, 210, 120, 0.12, 0.5, out);
        this.noiseBurst(t, 0.05, 0.3, 'bandpass', 1100, out, 2);
        break;
      case 'ui':
        this.osc('sine', 880, t, 0.06, 0.08, out);
        break;
      case 'check':
        // Three war-drum hits and a low horn.
        for (let i = 0; i < 3; i++) this.drum(t + i * 0.16, i === 2 ? 0.9 : 0.6, out);
        this.drum(t, 0.4, verb);
        {
          const o = this.osc('sawtooth', 110, t + 0.3, 0.9, 0.08, out, 0.15);
          o.frequency.linearRampToValueAtTime(98, t + 1.2);
        }
        break;
      case 'crash':
        this.noiseBurst(t, 0.45, 0.8, 'lowpass', 3500, out);
        this.noiseBurst(t, 0.3, 0.4, 'highpass', 3000, verb);
        this.boom(t, 120, 45, 0.5, 0.8, out);
        break;
      case 'stomp':
        this.boom(t, 90, 35, 0.7, 1, out);
        this.noiseBurst(t, 0.25, 0.6, 'lowpass', 400, out);
        this.noiseBurst(t, 0.6, 0.2, 'lowpass', 900, verb);
        break;
      case 'cannon-fire':
        this.boom(t, 160, 60, 0.35, 0.7, out);
        this.noiseBurst(t, 0.2, 0.5, 'bandpass', 1500, out, 0.7);
        break;
      case 'explosion': {
        const f = this.noiseBurst(t, 1.1, 1, 'lowpass', 5000, out);
        f.frequency.exponentialRampToValueAtTime(300, t + 0.9);
        this.boom(t, 100, 30, 1, 1, out);
        this.noiseBurst(t, 1.4, 0.4, 'lowpass', 1200, verb);
        break;
      }
      case 'slash': {
        const f = this.noiseBurst(t, 0.22, 0.6, 'bandpass', 900, out, 2);
        f.frequency.exponentialRampToValueAtTime(7000, t + 0.18);
        [2400, 3610].forEach((fr) => this.osc('sine', fr, t + 0.12, 0.6, 0.07, verb));
        this.boom(t + 0.12, 140, 70, 0.2, 0.4, out);
        break;
      }
      case 'seal':
        [880, 1320, 1760, 2640].forEach((fr, i) => this.osc('sine', fr, t + i * 0.07, 1.4, 0.12, verb));
        this.osc('sine', 440, t, 1.6, 0.18, out, 0.05);
        this.boom(t + 0.35, 200, 90, 0.3, 0.5, out);
        break;
      case 'gong':
        this.gong(t, 98, 0.5, out);
        this.gong(t, 98, 0.3, verb);
        break;
      case 'victory': {
        const notes = [0, 2, 4, 7, 9, 12, 16, 19].map((i) => this.root + 12 + i);
        notes.forEach((n, i) => this.pluck(midi(n), t + i * 0.11, 0.3, out, 2.2));
        this.gong(t + 0.95, 82, 0.5, out);
        this.gong(t + 0.95, 82, 0.4, verb);
        break;
      }
    }
  }

  // ---------- generative music ----------

  playMusic(theme: MusicTheme, faction?: FactionId) {
    if (!this.ctx) {
      this.pending = [theme, faction];
      return;
    }
    const root = faction ? FACTION_ROOT[faction] : 50;
    if (this.theme === theme && this.root === root) return;
    this.stopMusic();
    this.theme = theme;
    this.root = root;
    this.beat = 0;
    this.nextBeat = this.ctx.currentTime + 0.2;
    this.startDrone();
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  /** Adds war drums under the music (check, endgame). */
  setTension(on: boolean) {
    this.tension = on;
  }

  stopMusic() {
    window.clearInterval(this.timer);
    this.drone?.stop();
    this.drone = null;
    this.theme = null;
  }

  private startDrone() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    g.connect(f).connect(this.musicBus);
    const oscs = [0, 7, 12].flatMap((iv) =>
      [-4, 4].map((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(this.root - 24 + iv);
        o.detune.value = cents;
        o.connect(g);
        o.start(t);
        return o;
      }),
    );
    this.drone = {
      stop: () => {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0.0001, now, 0.5);
        oscs.forEach((o) => o.stop(now + 3));
      },
    };
  }

  private schedule() {
    const ctx = this.ctx!;
    const battle = this.theme === 'battle';
    const step = 60 / (battle ? 84 : 60) / 2; // eighth notes
    while (this.nextBeat < ctx.currentTime + 0.25) {
      this.playStep(this.nextBeat, this.beat, battle);
      this.nextBeat += step * (this.beat % 2 === 0 ? 1.08 : 0.92); // light swing
      this.beat++;
    }
  }

  private playStep(t: number, beat: number, battle: boolean) {
    const out = this.musicBus;
    const bar = Math.floor(beat / 8);
    const pos = beat % 8;
    const phraseEnd = bar % 4 === 3 && pos >= 4;

    // Melody: random walk on the pentatonic scale, resting at phrase ends.
    const density = battle ? 0.55 : 0.35;
    if (!phraseEnd && (pos === 0 || Math.random() < density)) {
      this.melodyDegree += Math.round((Math.random() - 0.5) * 3.2);
      this.melodyDegree = Math.max(0, Math.min(11, this.melodyDegree));
      const octave = Math.floor(this.melodyDegree / 5);
      const note = this.root + 12 + octave * 12 + PENTATONIC[this.melodyDegree % 5];
      this.pluck(midi(note), t, pos === 0 ? 0.22 : 0.14, out);
      // Occasional zither tremolo/grace note.
      if (Math.random() < 0.15) this.pluck(midi(note + 12), t + 0.07, 0.06, out, 0.6);
    }
    // Bass pluck on bar starts.
    if (pos === 0) this.pluck(midi(this.root - 12 + (bar % 2 ? 7 : 0)), t, 0.2, out, 2.4);

    if (battle && this.tension) {
      if (pos === 0 || pos === 4) this.drum(t, 0.35, out);
      if (pos === 6 && Math.random() < 0.6) this.drum(t, 0.2, out);
      if (pos % 2 === 1) this.noiseBurst(t, 0.03, 0.05, 'highpass', 6000, out);
    }
  }
}

export const audio = new AudioEngine();
