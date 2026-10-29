import { UltTemplate } from '../data/ultimates';

/**
 * Full-screen ultimate choreographies, drawn on a 2D canvas. Each is a pure function of the
 * frame parameters (no state between frames), so a skipped or replayed effect always looks the
 * same and "randomness" comes from a hash of the particle index.
 */
export interface FrameParams {
  /** Logical size in CSS pixels. */
  w: number;
  h: number;
  /** Progress through the effect phase, 0..1. */
  t: number;
  /** Seconds since the cinematic started; drives looping motion. */
  time: number;
  color: string;
  /** Lightened faction colour for secondary glow. */
  glow: string;
  /** Faction character, e.g. 漢, printed on banners. */
  emblem: string;
  /** 0.5 for the reduced setting, 1 for full. */
  intensity: number;
  /** +1 sweeps left to right, -1 right to left. */
  dir: 1 | -1;
  font: string;
}

type Draw = (ctx: CanvasRenderingContext2D, p: FrameParams) => void;

const rnd = (i: number, k = 0) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Fades in at the start and out at the end of the phase. */
const envelope = (t: number) => smooth(0, 0.12, t) * (1 - smooth(0.82, 1, t));

export function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp01(a).toFixed(3)})`;
}

const radial = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]) => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
};

const slash: Draw = (ctx, p) => {
  const { w, h, t, color, intensity, dir } = p;
  const n = Math.round(4 + 3 * intensity);
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const start = i * 0.1;
    const u = clamp01((t - start) / 0.26);
    const fade = 1 - clamp01((t - start - 0.26) / 0.34);
    if (u <= 0 || fade <= 0) continue;
    const ang = (-0.3 - rnd(i, 1) * 0.95) * dir;
    const cx = w * (0.22 + rnd(i, 2) * 0.56);
    const cy = h * (0.28 + rnd(i, 3) * 0.44);
    const len = Math.max(w, h) * (0.55 + rnd(i, 4) * 0.35);
    const dx = (Math.cos(ang) * len) / 2;
    const dy = (Math.sin(ang) * len) / 2;
    const head = easeOut(u);
    const tail = (clamp01((u - 0.3) / 0.7) * 0.92) ** 1.4;
    const x0 = cx - dx + 2 * dx * tail;
    const y0 = cy - dy + 2 * dy * tail;
    const x1 = cx - dx + 2 * dx * head;
    const y1 = cy - dy + 2 * dy * head;

    ctx.strokeStyle = rgba(color, 0.32 * fade);
    ctx.lineWidth = 30 * (0.6 + intensity * 0.4);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = rgba('#ffffff', 0.95 * fade);
    ctx.lineWidth = 6;
    ctx.stroke();

    // Sparks flying off the blade tip.
    if (u < 1) {
      for (let k = 0; k < 6; k++) {
        const a = rnd(i * 7 + k, 5) * Math.PI * 2;
        const d = 14 + rnd(i * 7 + k, 6) * 60 * u;
        ctx.fillStyle = rgba(color, 0.9 * fade);
        ctx.beginPath();
        ctx.arc(x1 + Math.cos(a) * d, y1 + Math.sin(a) * d, 2 + rnd(k, i) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
};

const charge: Draw = (ctx, p) => {
  const { w, h, t, time, color, intensity, dir } = p;
  const env = envelope(t);
  const sign = dir;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  // Speed lines streaking across the whole screen.
  const lines = Math.round(40 + 50 * intensity);
  for (let i = 0; i < lines; i++) {
    const speed = 1.4 + rnd(i, 2) * 1.6;
    const len = w * (0.12 + rnd(i, 3) * 0.3);
    const prog = (t * speed + rnd(i, 4)) % 1.6;
    const x = sign > 0 ? (prog - 0.3) * w : w - (prog - 0.3) * w;
    const y = h * rnd(i, 1);
    ctx.strokeStyle = rgba(color, (0.1 + 0.4 * rnd(i, 5)) * env);
    ctx.lineWidth = 1 + rnd(i, 6) * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - sign * len, y);
    ctx.stroke();
  }

  // A phalanx of spear tips driving across.
  const front = (t * 1.35 - 0.15) * w;
  const spears = Math.round(10 + 8 * intensity);
  for (let i = 0; i < spears; i++) {
    const y = h * (0.22 + 0.62 * rnd(i, 7));
    const lag = rnd(i, 8) * w * 0.28;
    const x = sign > 0 ? front - lag : w - front + lag;
    const len = w * (0.16 + 0.1 * rnd(i, 9));
    ctx.strokeStyle = rgba('#ffffff', 0.7 * env);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - sign * len, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.95 * env);
    ctx.beginPath();
    ctx.moveTo(x + sign * 26, y);
    ctx.lineTo(x - sign * 2, y - 8);
    ctx.lineTo(x - sign * 2, y + 8);
    ctx.fill();
  }

  // Dust kicked up along the ground.
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 18; i++) {
    const x = ((i / 18 + time * 0.25 * sign + rnd(i, 1)) % 1 + 1) % 1;
    const r = h * (0.08 + 0.1 * rnd(i, 2));
    ctx.fillStyle = radial(ctx, x * w, h * 0.92, r, [
      [0, rgba('#c9a777', 0.35 * env)],
      [1, rgba('#c9a777', 0)],
    ]);
    ctx.fillRect(x * w - r, h * 0.92 - r, r * 2, r * 2);
  }
};

const arrows: Draw = (ctx, p) => {
  const { w, h, t, color, intensity, dir } = p;
  const n = Math.round(40 + 70 * intensity);
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const start = rnd(i, 1) * 0.55;
    const dur = 0.26 + rnd(i, 2) * 0.12;
    const u = (t - start) / dur;
    if (u < 0) continue;
    const landX = w * (0.06 + rnd(i, 3) * 0.88);
    const landY = h * (0.42 + rnd(i, 4) * 0.52);
    const fromX = landX - 0.4 * h * dir - rnd(i, 8) * 80;
    const fromY = -h * 0.12;
    const vx = landX - fromX;
    const vy = landY - fromY;
    const vl = Math.hypot(vx, vy);
    const ux = vx / vl;
    const uy = vy / vl;
    if (u < 1) {
      const x = fromX + vx * u;
      const y = fromY + vy * u;
      const tailLen = 70 + rnd(i, 5) * 40;
      const g = ctx.createLinearGradient(x - ux * tailLen, y - uy * tailLen, x, y);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(1, rgba('#ffffff', 0.95));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - ux * tailLen, y - uy * tailLen);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      const fade = 1 - clamp01((u - 1) * dur / 0.4);
      if (fade <= 0) continue;
      ctx.strokeStyle = rgba(color, 0.85 * fade);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(landX - ux * 34, landY - uy * 34);
      ctx.lineTo(landX, landY);
      ctx.stroke();
      const ring = (u - 1) * dur / 0.3;
      if (ring < 1) {
        ctx.strokeStyle = rgba('#ffffff', 0.6 * (1 - ring));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(landX, landY, 6 + ring * 26, (6 + ring * 26) * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
};

const fire: Draw = (ctx, p) => {
  const { w, h, t, time, intensity } = p;
  const env = envelope(t);
  const rise = smooth(0, 0.45, t);

  const wash = ctx.createLinearGradient(0, h, 0, h * 0.3);
  wash.addColorStop(0, rgba('#ff4a14', 0.5 * env));
  wash.addColorStop(1, rgba('#ff4a14', 0));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'lighter';
  const flames = 15;
  for (let i = 0; i < flames; i++) {
    const flick = 0.75 + 0.25 * Math.sin(time * 9 + i * 1.7);
    const r = h * (0.14 + 0.2 * rnd(i, 1)) * rise * flick;
    const x = (w * (i + 0.5)) / flames + Math.sin(time * 2 + i) * 14;
    const y = h - r * 0.35;
    ctx.fillStyle = radial(ctx, x, y, r, [
      [0, rgba('#fff2b0', 0.95 * env)],
      [0.35, rgba('#ff9a3c', 0.7 * env)],
      [1, rgba('#ff3a10', 0)],
    ]);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const embers = Math.round(60 + 100 * intensity);
  for (let i = 0; i < embers; i++) {
    const age = (t * 1.4 + rnd(i, 1)) % 1;
    const x = w * rnd(i, 2) + Math.sin(age * 7 + rnd(i, 3) * 6) * 36;
    const y = h * (1.04 - age * (0.55 + 0.55 * rnd(i, 4)));
    ctx.fillStyle = rgba(rnd(i, 5) > 0.5 ? '#ffd27a' : '#ff8a30', (1 - age) * 0.95 * env);
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + rnd(i, 6) * 3.5 * (1 - age * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
};

const water: Draw = (ctx, p) => {
  const { w, h, t, time, dir } = p;
  const env = envelope(t);
  const front = dir > 0 ? t * 1.35 - 0.2 : 1.2 - t * 1.35;
  const layers = 4;
  for (let l = layers - 1; l >= 0; l--) {
    const top = new Float32Array(Math.ceil(w / 8) + 1);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let k = 0; k < top.length; k++) {
      const x = Math.min(w, k * 8);
      const fx = x / w;
      const behind = clamp01(((dir > 0 ? front - fx : fx - front) + 0.02) / 0.3);
      const level = h * (1.04 - 0.66 * smooth(0, 1, behind) * (0.62 + 0.1 * (layers - l)));
      const ripple = Math.sin(fx * 13 + time * (2.4 + l) + l * 1.9) * h * 0.018 * (0.3 + behind);
      const crest = -h * 0.22 * Math.exp(-(((fx - front) / 0.06) ** 2)) * (1 - l * 0.12);
      top[k] = level + ripple + crest;
      ctx.lineTo(x, top[k]);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, h * 0.3, 0, h);
    g.addColorStop(0, `rgba(${150 - l * 25}, ${220 - l * 20}, 255, ${(0.55 - l * 0.08) * env})`);
    g.addColorStop(1, `rgba(10, ${70 - l * 8}, 150, ${(0.7 - l * 0.08) * env})`);
    ctx.fillStyle = g;
    ctx.fill();

    if (l === 0) {
      // Foam along the leading surface.
      ctx.fillStyle = `rgba(255, 255, 255, ${0.8 * env})`;
      for (let k = 0; k < top.length; k += 2) {
        const bubble = 1.5 + rnd(k, 3) * 3.5;
        ctx.beginPath();
        ctx.arc(k * 8 + Math.sin(time * 3 + k) * 3, top[k] + Math.sin(time * 5 + k * 2) * 3, bubble, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
};

const shock: Draw = (ctx, p) => {
  const { w, h, t, color, intensity } = p;
  const cx = w / 2;
  const cy = h * 0.55;
  const reach = Math.hypot(w, h) * 0.55;
  ctx.globalCompositeOperation = 'lighter';

  // Opening flash and radial rays.
  const burst = smooth(0, 0.08, t) * (1 - smooth(0.08, 0.5, t));
  const rays = Math.round(18 + 18 * intensity);
  ctx.lineCap = 'round';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + rnd(i, 1) * 0.2;
    const r0 = reach * 0.08;
    const r1 = reach * (0.5 + 0.5 * rnd(i, 2)) * easeOut(clamp01(t * 3));
    ctx.strokeStyle = rgba(color, 0.55 * burst);
    ctx.lineWidth = 2 + rnd(i, 3) * 6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.6);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.6);
    ctx.stroke();
  }
  ctx.fillStyle = radial(ctx, cx, cy, reach * 0.5 * (0.4 + easeOut(clamp01(t * 2))), [
    [0, rgba('#ffffff', 0.9 * burst)],
    [0.4, rgba(color, 0.45 * burst)],
    [1, rgba(color, 0)],
  ]);
  ctx.fillRect(0, 0, w, h);

  // Expanding rings, flattened for perspective.
  for (let i = 0; i < 6; i++) {
    const u = clamp01((t - i * 0.09) / 0.55);
    if (u <= 0 || u >= 1) continue;
    const r = easeOut(u) * reach;
    ctx.strokeStyle = rgba(i % 2 ? '#ffffff' : color, (1 - u) * 0.9);
    ctx.lineWidth = 3 + 22 * (1 - u);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
};

const summon: Draw = (ctx, p) => {
  const { w, h, t, time, color, glow, emblem, intensity, font } = p;
  const env = envelope(t);
  const k = h / 800;

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const x = w * (0.12 + 0.19 * i);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(glow, 0));
    g.addColorStop(0.7, rgba(glow, 0.28 * env * smooth(0, 0.4, t)));
    g.addColorStop(1, rgba(color, 0.4 * env));
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 0.025, 0, w * 0.05, h);
  }

  ctx.globalCompositeOperation = 'source-over';
  const rows = intensity > 0.7 ? 3 : 2;
  const cols = 9;
  for (let r = 0; r < rows; r++) {
    const scale = (0.62 + 0.2 * r) * k * 1.5;
    const baseY = h * (0.6 + 0.12 * r);
    for (let c = 0; c < cols; c++) {
      const appear = smooth(r * 0.1 + c * 0.012, r * 0.1 + c * 0.012 + 0.22, t);
      if (appear <= 0) continue;
      const x = (w * (c + 0.5 + (r % 2 ? 0.5 : 0))) / (cols + 0.5);
      const y = baseY + (1 - appear) * 40 * scale + Math.sin(time * 2 + c + r) * 2 * scale;
      const alpha = 0.55 * appear * env;
      ctx.fillStyle = rgba(color, alpha);
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.8);
      ctx.lineWidth = 1.5;
      // Spear.
      ctx.beginPath();
      ctx.moveTo(x + 22 * scale, y + 10 * scale);
      ctx.lineTo(x + 22 * scale, y - 110 * scale);
      ctx.stroke();
      // Body and head.
      ctx.beginPath();
      ctx.moveTo(x - 16 * scale, y + 60 * scale);
      ctx.lineTo(x - 11 * scale, y + 2 * scale);
      ctx.lineTo(x + 11 * scale, y + 2 * scale);
      ctx.lineTo(x + 16 * scale, y + 60 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y - 12 * scale, 11 * scale, 0, Math.PI * 2);
      ctx.fill();
      // Banner with the faction emblem on every third soldier.
      if (c % 3 === 1) {
        ctx.beginPath();
        ctx.moveTo(x - 24 * scale, y + 30 * scale);
        ctx.lineTo(x - 24 * scale, y - 150 * scale);
        ctx.stroke();
        ctx.fillStyle = rgba(color, alpha * 1.3);
        ctx.fillRect(x - 24 * scale, y - 150 * scale, 46 * scale, 62 * scale);
        ctx.fillStyle = rgba('#ffffff', alpha * 1.6);
        ctx.font = `900 ${32 * scale}px ${font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emblem, x - 1 * scale, y - 119 * scale);
      }
    }
  }
};

const GLYPHS = '乾坤震巽坎離艮兌';

const glyph: Draw = (ctx, p) => {
  const { w, h, t, time, color, glow, intensity, font } = p;
  const env = envelope(t);
  const appear = smooth(0, 0.28, t);
  const cx = w / 2;
  const cy = h * 0.68;
  const rx = Math.min(w * 0.4, h * 0.75) * (0.7 + 0.3 * easeOut(appear));
  const ry = rx * 0.3;
  ctx.globalCompositeOperation = 'lighter';

  // Beams rising from the circle.
  const beams = Math.round(10 + 8 * intensity);
  for (let i = 0; i < beams; i++) {
    const a = (i / beams) * Math.PI * 2 + time * 0.4;
    const x = cx + Math.cos(a) * rx * 0.92;
    const y = cy + Math.sin(a) * ry * 0.92;
    const top = y - h * (0.35 + 0.25 * rnd(i, 1)) * easeOut(appear) * (0.85 + 0.15 * Math.sin(time * 5 + i));
    const g = ctx.createLinearGradient(0, y, 0, top);
    g.addColorStop(0, rgba(color, 0.55 * env));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - 6, top, 12, y - top);
  }

  ctx.lineWidth = 3;
  for (const [s, a] of [[1, 0.95], [0.82, 0.7], [0.5, 0.55]] as const) {
    ctx.strokeStyle = rgba(s === 1 ? '#ffffff' : color, a * env * appear);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * s, ry * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // A rotating square inscribed in the circle.
  ctx.strokeStyle = rgba(glow, 0.6 * env * appear);
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const a = time * 0.5 + (i * Math.PI) / 2 + Math.PI / 4;
    const x = cx + Math.cos(a) * rx * 0.7;
    const y = cy + Math.sin(a) * ry * 0.7;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Trigram names circling the rim.
  ctx.font = `900 ${Math.round(rx * 0.1)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < GLYPHS.length; i++) {
    const a = time * 0.6 + (i / GLYPHS.length) * Math.PI * 2;
    ctx.fillStyle = rgba('#ffffff', 0.9 * env * appear);
    ctx.fillText(GLYPHS[i], cx + Math.cos(a) * rx * 0.91, cy + Math.sin(a) * ry * 0.91);
  }

  // Motes drifting upward.
  for (let i = 0; i < 40; i++) {
    const age = (t * 1.2 + rnd(i, 1)) % 1;
    const a = rnd(i, 2) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx * rnd(i, 3);
    const y = cy + Math.sin(a) * ry * rnd(i, 3) - age * h * 0.5;
    ctx.fillStyle = rgba(rnd(i, 4) > 0.5 ? glow : '#ffffff', (1 - age) * 0.8 * env);
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + rnd(i, 5) * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
};

export const TEMPLATE_DRAW: Record<UltTemplate, Draw> = { slash, charge, arrows, fire, water, shock, summon, glyph };

/** Gold motes and petals drifting down, shown behind the result dialog after the triumph. */
export function drawAmbient(ctx: CanvasRenderingContext2D, p: Pick<FrameParams, 'w' | 'h' | 'time' | 'color' | 'intensity'>) {
  const { w, h, time, color, intensity } = p;
  ctx.globalCompositeOperation = 'lighter';
  const n = Math.round(30 + 50 * intensity);
  for (let i = 0; i < n; i++) {
    const age = (time * (0.06 + 0.08 * rnd(i, 1)) + rnd(i, 2)) % 1;
    const x = w * rnd(i, 3) + Math.sin(time * 0.8 + i) * 30;
    const y = h * (-0.05 + age * 1.1);
    const fade = Math.sin(Math.PI * age);
    ctx.fillStyle = rgba(rnd(i, 4) > 0.4 ? color : '#ffffff', 0.55 * fade);
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rnd(i, 5) * 3.5, 1.5 + rnd(i, 6) * 2.5, time + i, 0, Math.PI * 2);
    ctx.fill();
  }
}
