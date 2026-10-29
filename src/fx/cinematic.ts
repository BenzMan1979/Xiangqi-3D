import { Sfx } from '../audio/audio';
import { PIECE_NAMES } from '../core/notation';
import { PieceType, Side } from '../core/types';
import { Character, Faction } from '../data/factions';
import { ultimateFor } from '../data/ultimates';
import { getPortrait, portraitUrl } from '../render/portrait';
import { PIECE_FONT } from '../render/textures';
import { clock } from '../render/tween';
import { TEMPLATE_DRAW, drawAmbient } from './ultTemplates';

export type CinemaKind = 'finisher' | 'triumph';

export interface CinemaScene {
  kind: CinemaKind;
  character: Character;
  faction: Faction;
  role: PieceType;
  side: Side;
  /** Big word at the climax, e.g. 將死. Only shown for the finisher. */
  caption?: string;
  level: 'full' | 'reduced';
}

export interface CinemaHooks {
  sfx(name: Sfx): void;
  flash(color: string, strength: number): void;
  kick(amount: number): void;
}

interface Timeline {
  portrait: number;
  title: number;
  fxStart: number;
  fxEnd: number;
  climax: number;
  /** Fade-out starts here and the cinematic ends 0.4s later (finisher only). */
  out: number;
  end: number;
}

const TIMELINES: Record<CinemaKind, Timeline> = {
  finisher: { portrait: 0.35, title: 0.95, fxStart: 1.25, fxEnd: 3.85, climax: 3.6, out: 4.7, end: 5.1 },
  triumph: { portrait: 0.3, title: 0.9, fxStart: 1.2, fxEnd: 4.0, climax: Infinity, out: Infinity, end: 4.4 },
};

const REDUCED_SCALE = 0.6;

function lighten(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amount);
  const to = (v: number) => ch(v).toString(16).padStart(2, '0');
  return `#${to((n >> 16) & 255)}${to((n >> 8) & 255)}${to(n & 255)}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) {
  const node = document.createElement(tag);
  node.className = className;
  parent?.append(node);
  return node;
}

/**
 * The full-screen ultimate: dims the board, brings in the character's portrait and brush-written
 * skill name, then runs the skill's template. The finisher ends by fading back to the board;
 * the triumph settles into a "hold" state that stays behind the result dialog until dismissed.
 */
export class Cinematic {
  private readonly root = el('div', '');
  private readonly canvas = el('canvas', 'ult-canvas', this.root);
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly portrait = el('img', 'ult-portrait', this.root);
  private readonly center = el('div', 'ult-center', this.root);
  private readonly who = el('div', 'ult-who', this.center);
  private readonly skill = el('div', 'ult-skill', this.center);
  private readonly line = el('div', 'ult-line', this.center);
  private readonly caption = el('div', 'ult-caption', this.root);
  private readonly hint = el('div', 'ult-hint', this.root);

  private scene: CinemaScene | null = null;
  private timeline: Timeline = TIMELINES.finisher;
  private time = 0;
  private last = 0;
  private raf = 0;
  private fired = new Set<string>();
  private state: 'idle' | 'run' | 'hold' = 'idle';
  private resolve: (() => void) | null = null;
  private size = { w: 0, h: 0 };

  constructor(private readonly hooks: CinemaHooks) {
    this.root.id = 'ult';
    this.root.hidden = true;
    el('div', 'ult-bar top', this.root);
    el('div', 'ult-bar bottom', this.root);
    this.hint.textContent = '點擊任意處跳過';
    document.body.append(this.root);

    this.root.addEventListener('pointerdown', () => this.skip());
    window.addEventListener('keydown', (e) => {
      if (this.state === 'run' && ['Escape', ' ', 'Enter'].includes(e.key)) this.skip();
    });
    window.addEventListener('resize', () => this.state !== 'idle' && this.resizeCanvas());
  }

  get active() {
    return this.state !== 'idle';
  }

  /** Seconds of cinematic time played so far (for debugging). */
  get elapsed() {
    return this.time;
  }

  /** Plays the scene; resolves when it ends (finisher) or settles into the hold state (triumph). */
  play(scene: CinemaScene): Promise<void> {
    this.dismiss();
    const spec = ultimateFor(scene.character, scene.faction);
    const speed = scene.level === 'full' ? 1 : REDUCED_SCALE;
    const base = TIMELINES[scene.kind];
    this.timeline = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * speed])) as unknown as Timeline;
    this.scene = scene;
    this.time = 0;
    this.fired.clear();
    this.state = 'run';

    this.root.className = `ult-${scene.kind}`;
    this.root.style.setProperty('--ult-color', spec.color);
    this.root.style.setProperty('--glow', lighten(scene.faction.color, 0.35));
    this.portrait.src = portraitUrl(getPortrait(scene.character, scene.faction, scene.role, scene.side));
    this.who.textContent = `${scene.faction.fullName} · ${PIECE_NAMES[scene.side][scene.role]} ${scene.character.name}`;
    this.skill.textContent = spec.title;
    this.line.textContent = spec.line;
    this.caption.textContent = scene.caption ?? '';
    this.hint.hidden = false;
    this.root.hidden = false;
    this.resizeCanvas();

    this.last = performance.now();
    this.raf = requestAnimationFrame((now) => this.frame(now));
    // Next frame, so the CSS transition from the hidden state runs.
    requestAnimationFrame(() => this.root.classList.add('on'));
    return new Promise((resolve) => (this.resolve = resolve));
  }

  /** Jumps to the end of the current run. */
  skip() {
    if (this.state !== 'run') return;
    this.time = Math.max(this.time, this.timeline.end);
  }

  /** Removes the overlay immediately, whatever state it is in. */
  dismiss() {
    cancelAnimationFrame(this.raf);
    this.state = 'idle';
    this.root.hidden = true;
    this.root.className = '';
    document.body.classList.remove('ult-hold');
    this.settle();
  }

  private settle() {
    const done = this.resolve;
    this.resolve = null;
    done?.();
  }

  private resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.size = { w, h };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private at(name: string, when: number, fn: () => void) {
    if (this.fired.has(name) || this.time < when) return;
    this.fired.add(name);
    fn();
  }

  private frame(now: number) {
    if (this.state === 'idle') return;
    const dt = Math.min(0.25, (now - this.last) / 1000) / clock.base;
    this.last = now;
    this.time += dt;
    const scene = this.scene!;
    const T = this.timeline;
    const spec = ultimateFor(scene.character, scene.faction);

    if (this.state === 'run') {
      this.at('portrait', T.portrait, () => this.root.classList.add('portrait-in'));
      this.at('title', T.title, () => {
        this.root.classList.add('title-in');
        this.hooks.sfx('ultimate');
      });
      this.at('climax', T.climax, () => {
        this.hooks.flash('#ffffff', 0.8);
        this.hooks.kick(0.45);
        this.hooks.sfx('crash');
        this.root.classList.add('caption-in', 'shake');
      });
      this.at('out', T.out, () => this.root.classList.add('out'));
      if (scene.kind === 'triumph') this.at('victory', 0, () => this.hooks.sfx('victory'));
    }

    const { w, h } = this.size;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    const intensity = scene.level === 'full' ? 1 : 0.5;
    const glow = lighten(scene.faction.color, 0.5);

    if (this.state === 'run') {
      const t = (this.time - T.fxStart) / (T.fxEnd - T.fxStart);
      if (t >= 0 && t <= 1) {
        // Red attacks from the left, black from the right, matching the sides of the screen.
        TEMPLATE_DRAW[spec.template](ctx, {
          w,
          h,
          t,
          time: this.time,
          color: spec.color,
          glow,
          emblem: scene.faction.name,
          intensity,
          dir: scene.side === 'red' ? 1 : -1,
          font: PIECE_FONT,
        });
      }
      if (this.time >= T.end) {
        if (scene.kind === 'finisher') {
          this.dismiss();
          return;
        }
        this.state = 'hold';
        this.root.classList.add('hold', 'title-in', 'portrait-in');
        this.hint.hidden = true;
        document.body.classList.add('ult-hold');
        this.settle();
      }
    } else {
      drawAmbient(ctx, { w, h, time: this.time, color: spec.color, intensity });
    }
    this.raf = requestAnimationFrame((n) => this.frame(n));
  }
}
