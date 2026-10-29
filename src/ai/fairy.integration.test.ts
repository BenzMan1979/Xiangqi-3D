/**
 * Runs the vendored Fairy-Stockfish build under Node as an independent referee for our rules:
 * it lists the legal moves of positions reached by random play, and picks moves that must be legal
 * for our rules. Skipped when the engine files have not been copied (npm install does that).
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Game } from '../core/game';
import { Move } from '../core/types';
import { moveToUci, positionCommand, uciToMove } from './uciMove';

// Loaded from node_modules, whose package.json is CommonJS (the repo root's is ESM).
const require_ = createRequire(import.meta.url);
let enginePath = '';
try {
  enginePath = require_.resolve('fairy-stockfish-nnue.wasm/stockfish.js');
} catch {
  // Not installed.
}
const available = enginePath !== '' && existsSync(enginePath);

interface Fairy {
  postMessage(cmd: string): void;
  addMessageListener(cb: (line: string) => void): void;
  terminate?(): void;
}

describe.skipIf(!available)('Fairy-Stockfish as a rules referee', () => {
  let engine: Fairy;
  const lines: string[] = [];

  const waitFor = async (pred: (l: string) => boolean, ms = 30000) => {
    const started = Date.now();
    for (;;) {
      const i = lines.findIndex(pred);
      if (i >= 0) return lines.splice(0, i + 1);
      if (Date.now() - started > ms) throw new Error('engine timeout');
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  beforeAll(async () => {
    // The Emscripten loader prefers fetch() when it exists, which cannot read local file paths.
    (globalThis as { fetch?: unknown }).fetch = undefined;
    const Stockfish = require_(enginePath);
    engine = await Stockfish();
    engine.addMessageListener((l) => lines.push(l));
    engine.postMessage('setoption name UCI_Variant value xiangqi');
    engine.postMessage('isready');
    await waitFor((l) => l === 'readyok');
  }, 60000);

  afterAll(() => engine?.terminate?.());

  const engineMoves = async (game: Game) => {
    engine.postMessage(positionCommand(game.startFen, game.history.map((h) => h.move)));
    engine.postMessage('go perft 1');
    const out = await waitFor((l) => l.startsWith('Nodes searched'));
    return out.map((l) => /^([a-i]\d+[a-i]\d+):/.exec(l)?.[1]).filter((m): m is string => !!m).sort();
  };

  it('lists exactly the legal moves our rules allow along random games', async () => {
    let seed = 7;
    const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let g = 0; g < 4; g++) {
      const game = new Game();
      for (let ply = 0; ply < 70 && !game.isOver; ply++) {
        const ours = game.legalMoves();
        const theirs = await engineMoves(game);
        expect(theirs, `game ${g} ply ${ply} ${game.fen()}`).toEqual(ours.map(moveToUci).sort());
        const pick = ours[Math.floor(rng() * ours.length)];
        game.move(pick.from, pick.to);
      }
    }
  }, 120000);

  it('answers a search with a move that is legal for our rules', async () => {
    const game = new Game();
    for (let ply = 0; ply < 6; ply++) {
      engine.postMessage(positionCommand(game.startFen, game.history.map((h) => h.move)));
      engine.postMessage('go movetime 100');
      const out = await waitFor((l) => l.startsWith('bestmove'));
      const move = uciToMove(out[out.length - 1].split(' ')[1]) as Move;
      expect(move).not.toBeNull();
      expect(game.move(move.from, move.to), `ply ${ply}`).not.toBeNull();
    }
  }, 60000);
});
