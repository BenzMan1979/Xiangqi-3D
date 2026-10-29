import { Move } from '../core/types';

/**
 * Fairy-Stockfish writes xiangqi squares as file a..i and rank 1..10 from red's side, so rank 10
 * has two digits. Our squares are y * 9 + x with y = 0 on red's back rank.
 */
const FILES = 'abcdefghi';

export const squareToUci = (s: number) => `${FILES[s % 9]}${Math.floor(s / 9) + 1}`;

export const moveToUci = (m: Move) => squareToUci(m.from) + squareToUci(m.to);

export function uciToMove(text: string): Move | null {
  const match = /^([a-i])(\d{1,2})([a-i])(\d{1,2})/.exec(text);
  if (!match) return null;
  const [, f1, r1, f2, r2] = match;
  const y1 = Number(r1) - 1;
  const y2 = Number(r2) - 1;
  if (y1 < 0 || y1 > 9 || y2 < 0 || y2 > 9) return null;
  return { from: y1 * 9 + FILES.indexOf(f1), to: y2 * 9 + FILES.indexOf(f2) };
}

/** `position` command for a game that began at `startFen` and continued with `moves`. */
export function positionCommand(startFen: string, moves: Move[]) {
  const [placement, turn = 'w'] = startFen.trim().split(/\s+/);
  const tail = moves.length ? ` moves ${moves.map(moveToUci).join(' ')}` : '';
  return `position fen ${placement} ${turn} - - 0 1${tail}`;
}
