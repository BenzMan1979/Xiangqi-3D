import { PIECE_NAMES } from '../core/notation';
import { PieceType, Side } from '../core/types';
import { Character, Faction } from '../data/factions';
import { PIECE_FONT, SIDE_COLORS } from './textures';

/**
 * Placeholder portraits drawn on a canvas: a banner-coloured backdrop, a bust silhouette whose
 * headgear and weapon hint at the role, and a name plate. Real artwork can replace these later
 * without touching the callers.
 */

export const PORTRAIT_W = 256;
export const PORTRAIT_H = 360;

const cache = new Map<string, HTMLCanvasElement>();

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * (amount > 0 ? 255 - v : v))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Weapon or emblem behind the figure. Drawn before the body so the body overlaps it. */
function drawProp(ctx: CanvasRenderingContext2D, role: PieceType, W: number, H: number) {
  ctx.save();
  ctx.lineCap = 'round';
  switch (role) {
    case 'k': // upright sword
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(W * 0.78, H * 0.18);
      ctx.lineTo(W * 0.78, H * 0.62);
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(W * 0.7, H * 0.55);
      ctx.lineTo(W * 0.86, H * 0.55);
      ctx.stroke();
      break;
    case 'r': // long polearm with a crescent blade
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(W * 0.14, H * 0.74);
      ctx.lineTo(W * 0.8, H * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W * 0.8, H * 0.12, W * 0.1, Math.PI * 0.2, Math.PI * 1.1);
      ctx.lineWidth = 8;
      ctx.stroke();
      break;
    case 'n': // spear with tassel
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(W * 0.86, H * 0.76);
      ctx.lineTo(W * 0.2, H * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W * 0.2, H * 0.1);
      ctx.lineTo(W * 0.27, H * 0.13);
      ctx.lineTo(W * 0.23, H * 0.17);
      ctx.closePath();
      ctx.fill();
      break;
    case 'c': // drawn bow
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(W * 0.6, H * 0.4, H * 0.24, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W * 0.6 + Math.cos(-Math.PI * 0.42) * H * 0.24, H * 0.4 + Math.sin(-Math.PI * 0.42) * H * 0.24);
      ctx.lineTo(W * 0.6 + Math.cos(Math.PI * 0.42) * H * 0.24, H * 0.4 + Math.sin(Math.PI * 0.42) * H * 0.24);
      ctx.stroke();
      break;
    case 'a': // feather fan
      ctx.beginPath();
      ctx.moveTo(W * 0.74, H * 0.62);
      ctx.lineTo(W * 0.62, H * 0.3);
      ctx.quadraticCurveTo(W * 0.78, H * 0.2, W * 0.92, H * 0.32);
      ctx.closePath();
      ctx.fill();
      break;
    case 'b': // scroll
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(W * 0.18, H * 0.6);
      ctx.lineTo(W * 0.3, H * 0.34);
      ctx.stroke();
      break;
    case 'p': // banner on a pole
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(W * 0.82, H * 0.76);
      ctx.lineTo(W * 0.82, H * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W * 0.82, H * 0.13);
      ctx.lineTo(W * 0.62, H * 0.18);
      ctx.lineTo(W * 0.82, H * 0.27);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

function drawHeadgear(ctx: CanvasRenderingContext2D, role: PieceType, cx: number, cy: number, r: number) {
  ctx.beginPath();
  switch (role) {
    case 'k': // 冕: flat board with hanging strings
      ctx.rect(cx - r * 1.5, cy - r * 1.32, r * 3, r * 0.28);
      ctx.rect(cx - r * 0.6, cy - r * 1.1, r * 1.2, r * 0.4);
      ctx.fill();
      ctx.lineWidth = 2;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * r * 0.42, cy - r * 1.05);
        ctx.lineTo(cx + i * r * 0.42, cy - r * 0.55);
        ctx.stroke();
      }
      return;
    case 'a': // tall scholar's cap
      ctx.moveTo(cx - r * 0.75, cy - r * 0.55);
      ctx.lineTo(cx - r * 0.5, cy - r * 1.55);
      ctx.lineTo(cx + r * 0.5, cy - r * 1.55);
      ctx.lineTo(cx + r * 0.75, cy - r * 0.55);
      break;
    case 'b': // 幞頭 with side wings
      ctx.ellipse(cx, cy - r * 0.75, r * 0.9, r * 0.55, 0, Math.PI, 0);
      ctx.rect(cx - r * 2, cy - r * 0.95, r * 4, r * 0.16);
      break;
    case 'p': // conical helmet
      ctx.moveTo(cx - r * 1.05, cy - r * 0.35);
      ctx.lineTo(cx, cy - r * 1.6);
      ctx.lineTo(cx + r * 1.05, cy - r * 0.35);
      break;
    default: // r, n, c: domed helmet with a plume
      ctx.ellipse(cx, cy - r * 0.3, r * 1.12, r * 1.05, 0, Math.PI, 0);
      ctx.moveTo(cx - r * 0.12, cy - r * 1.3);
      ctx.lineTo(cx, cy - r * 2.1);
      ctx.lineTo(cx + r * 0.12, cy - r * 1.3);
      break;
  }
  ctx.closePath();
  ctx.fill();
}

/** Draws a portrait card. `side` adds a red/black frame and piece badge; null gives a neutral gold frame. */
export function getPortrait(ch: Character, faction: Faction, role: PieceType, side: Side | null): HTMLCanvasElement {
  const key = `${faction.id}:${ch.id}:${role}:${side ?? 'none'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const W = PORTRAIT_W;
  const H = PORTRAIT_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const frame = side ? SIDE_COLORS[side] : '#8a6a2a';
  const gold = '#e9c46a';

  // Frame and backdrop.
  roundRect(ctx, 0, 0, W, H, 18);
  ctx.fillStyle = frame;
  ctx.fill();
  const inset = 9;
  ctx.save();
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, 12);
  ctx.clip();
  const bg = ctx.createRadialGradient(W / 2, H * 0.3, 10, W / 2, H * 0.45, H * 0.7);
  bg.addColorStop(0, shade(faction.color, 0.45));
  bg.addColorStop(0.55, faction.color);
  bg.addColorStop(1, shade(faction.color, -0.6));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Faction watermark.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.font = `900 ${W * 0.95}px ${PIECE_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(faction.name, W / 2, H * 0.4);

  // Light rays from behind the head.
  ctx.save();
  ctx.translate(W / 2, H * 0.36);
  ctx.fillStyle = 'rgba(255, 236, 190, 0.08)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-W * 0.06, -H);
    ctx.lineTo(W * 0.06, -H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Figure.
  const ink = 'rgba(14, 8, 6, 0.92)';
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  drawProp(ctx, role, W, H);
  const cx = W / 2;
  const headY = H * 0.36;
  const r = W * 0.12;
  ctx.beginPath();
  ctx.moveTo(W * 0.08, H * 0.8);
  ctx.bezierCurveTo(W * 0.1, H * 0.6, W * 0.3, H * 0.53, cx - r * 0.6, headY + r * 0.95);
  ctx.lineTo(cx + r * 0.6, headY + r * 0.95);
  ctx.bezierCurveTo(W * 0.7, H * 0.53, W * 0.9, H * 0.6, W * 0.92, H * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, headY, r * 0.86, r, 0, 0, Math.PI * 2);
  ctx.fill();
  drawHeadgear(ctx, role, cx, headY, r);

  // Name plate.
  const plateY = H * 0.76;
  ctx.fillStyle = 'rgba(12, 7, 4, 0.88)';
  ctx.fillRect(0, plateY, W, H - plateY);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, plateY + 1.5);
  ctx.lineTo(W, plateY + 1.5);
  ctx.stroke();

  const name = ch.name;
  const nameSize = Math.min(W * 0.2, (W * 0.84) / name.length);
  ctx.fillStyle = gold;
  ctx.font = `900 ${nameSize}px ${PIECE_FONT}`;
  ctx.fillText(name, W / 2, plateY + (H - plateY) * 0.5 + 2);
  ctx.restore();

  // Piece badge, top-left.
  const bx = W * 0.17;
  const by = W * 0.17;
  const br = W * 0.12;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = '#f6e9cc';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = side ? SIDE_COLORS[side] : gold;
  ctx.stroke();
  ctx.fillStyle = side ? SIDE_COLORS[side] : '#6b4a12';
  ctx.font = `900 ${br * 1.25}px ${PIECE_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(PIECE_NAMES[side ?? 'red'][role], bx, by + 2);

  cache.set(key, canvas);
  return canvas;
}

const urlCache = new Map<HTMLCanvasElement, string>();

export function portraitUrl(canvas: HTMLCanvasElement) {
  let url = urlCache.get(canvas);
  if (!url) {
    url = canvas.toDataURL('image/png');
    urlCache.set(canvas, url);
  }
  return url;
}
