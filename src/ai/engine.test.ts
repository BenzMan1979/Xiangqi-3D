import { describe, expect, it } from 'vitest';
import { START_FEN } from '../core/fen';
import { Game } from '../core/game';
import { Move } from '../core/types';
import { Engine, MATE } from './engine';

const key = (m: Move) => m.from * 100 + m.to;
const sorted = (moves: Move[]) => moves.map(key).sort((a, b) => a - b);

/** Small deterministic generator for reproducible random playouts. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('move generator', () => {
  it('matches the known perft counts from the starting position', () => {
    const engine = new Engine(START_FEN);
    expect(engine.perft(1)).toBe(44);
    expect(engine.perft(2)).toBe(1920);
    expect(engine.perft(3)).toBe(79666);
  });

  it('agrees with the rules engine along random playouts', () => {
    for (const seed of [1, 2, 3]) {
      const rng = lcg(seed);
      const game = new Game();
      const engine = new Engine(START_FEN);
      for (let ply = 0; ply < 80 && !game.isOver; ply++) {
        const legal = game.legalMoves();
        engine.setPosition(game.startFen, game.history.map((h) => h.move));
        expect(sorted(engine.legalMoves()), `seed ${seed} ply ${ply} ${game.fen()}`).toEqual(sorted(legal));
        const pick = legal[Math.floor(rng() * legal.length)];
        game.move(pick.from, pick.to);
      }
    }
  });
});

describe('search', () => {
  it('finds a mate in one', () => {
    // Red rook a8 already covers rank 8; the rook on i0 mates by going to i9.
    const engine = new Engine('3k5/R8/9/9/9/9/9/9/9/4K3R w');
    const result = engine.search({ depth: 3, timeMs: 2000 });
    expect(result.move).toEqual({ from: 8, to: 89 });
    expect(result.score).toBeGreaterThan(MATE - 10);
  });

  it('takes a hanging rook', () => {
    // Black rook on a4 faces red's a0 rook, which captures it for free.
    const engine = new Engine('5k3/9/9/9/9/r8/9/9/9/R3K4 w');
    const result = engine.search({ depth: 3, timeMs: 2000 });
    expect(result.move).toEqual({ from: 0, to: 36 });
  });

  it('reports no move when the side to move is already mated', () => {
    // Black king d9 mated by rooks on rank 8 and rank 9, black to move.
    const engine = new Engine('3k4R/R8/9/9/9/9/9/9/9/4K4 b');
    const result = engine.search({ depth: 2, timeMs: 1000 });
    expect(result.move).toBeNull();
  });

  it('plays only legal moves at every level over a short game', () => {
    const game = new Game();
    const engine = new Engine();
    const levels = [
      { depth: 1, timeMs: 300, noise: 200 },
      { depth: 3, timeMs: 500, noise: 30 },
    ];
    for (let ply = 0; ply < 24 && !game.isOver; ply++) {
      engine.setPosition(game.startFen, game.history.map((h) => h.move));
      const { move } = engine.search(levels[ply % 2]);
      expect(move).not.toBeNull();
      expect(game.move(move!.from, move!.to), `ply ${ply}`).not.toBeNull();
    }
  });

  it('is deterministic without noise', () => {
    const a = new Engine(START_FEN).search({ depth: 4, timeMs: 5000 });
    const b = new Engine(START_FEN).search({ depth: 4, timeMs: 5000 });
    expect(a.move).toEqual(b.move);
  });
});
