import { Game } from '../core/game';
import { Move } from '../core/types';
import { Engine } from './engine';
import { LEVEL_BY_ID, AiLevel } from './levels';
import type { AiRequest, AiResponse } from './worker';

/** Time the computer takes at minimum, so replies don't feel instantaneous. */
const MIN_THINK_MS = 450;

/**
 * Runs the search off the main thread. Falls back to the main thread when workers are not
 * available, so the game still works (with a brief stall while the computer thinks).
 */
export class AiPlayer {
  private worker: Worker | null | undefined;
  private fallback: Engine | null = null;
  private nextId = 1;
  /** Resolves undefined when the worker itself failed, so the caller can search in-thread. */
  private pending: { id: number; resolve: (m: Move | null | undefined) => void } | null = null;

  private ensureWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<AiResponse>) => {
        if (this.pending?.id !== e.data.id) return; // superseded by cancel()
        const { resolve } = this.pending;
        this.pending = null;
        resolve(e.data.move);
      };
      worker.onerror = () => {
        this.worker = null;
        worker.terminate();
        const stuck = this.pending;
        this.pending = null;
        stuck?.resolve(undefined);
      };
      this.worker = worker;
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  /** Picks a move for the side to move in `game`. Resolves null if cancelled or there is none. */
  async think(game: Game, level: AiLevel): Promise<Move | null> {
    const started = performance.now();
    const request: Omit<AiRequest, 'id'> = {
      fen: game.startFen,
      moves: game.history.map((h) => h.move),
      search: LEVEL_BY_ID[level].search,
    };
    this.cancel();
    const id = this.nextId++;

    const worker = this.ensureWorker();
    let move: Move | null | undefined;
    if (worker) {
      move = await new Promise<Move | null | undefined>((resolve) => {
        this.pending = { id, resolve };
        worker.postMessage({ id, ...request } satisfies AiRequest);
      });
    }
    if (move === undefined) {
      // Let the UI paint the "thinking" state before the synchronous search blocks it.
      await new Promise((r) => setTimeout(r, 30));
      this.fallback ??= new Engine();
      this.fallback.setPosition(request.fen, request.moves);
      move = this.fallback.search(request.search).move;
    }

    const wait = MIN_THINK_MS - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return move;
  }

  /** Abandons the outstanding request; its result is dropped. */
  cancel() {
    const stale = this.pending;
    if (!stale) return;
    this.pending = null;
    // A running search can't be interrupted, so replace the worker instead of queueing behind it.
    this.worker?.terminate();
    this.worker = undefined;
    stale.resolve(null);
  }
}
