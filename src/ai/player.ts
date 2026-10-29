import { Game } from '../core/game';
import { Move } from '../core/types';
import { Engine, SearchOptions } from './engine';
import { AiLevel, LEVEL_BY_ID, OWN_ENGINE_FALLBACK } from './levels';
import { UciEngine } from './uci';
import type { AiRequest, AiResponse } from './worker';

/** Time the computer takes at minimum, so replies don't feel instantaneous. */
const MIN_THINK_MS = 450;

/**
 * Chooses the computer's moves. Our own engine runs in a worker (or on the main thread when
 * workers are unavailable); the master level asks Fairy-Stockfish and quietly falls back to our
 * strongest own level if that engine cannot start or answers with something illegal.
 */
export class AiPlayer {
  /** Called once when the master level has to be replaced by the fallback. */
  onFallback: ((reason: string) => void) | null = null;

  private worker: Worker | null | undefined;
  private fallback: Engine | null = null;
  private nextId = 1;
  /** Resolves undefined when the worker itself failed, so the caller can search in-thread. */
  private pending: { id: number; resolve: (m: Move | null | undefined) => void } | null = null;

  private uci: UciEngine | null = null;
  private masterBroken = false;
  private masterToken = 0;

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

  /** Starts the master engine ahead of its first move, which hides the WebAssembly start-up time. */
  warmUp() {
    if (this.masterBroken) return;
    this.uci ??= new UciEngine();
    this.uci.start().catch(() => {
      // The first real search reports the failure and falls back.
    });
  }

  /** Picks a move for the side to move in `game`. Resolves null if cancelled or there is none. */
  async think(game: Game, level: AiLevel): Promise<Move | null> {
    const started = performance.now();
    this.cancel();

    let move: Move | null | undefined;
    if (level === 'master' && !this.masterBroken) {
      move = await this.thinkMaster(game);
    }
    if (move === undefined) {
      const info = LEVEL_BY_ID[level === 'master' ? OWN_ENGINE_FALLBACK : level];
      move = await this.thinkOwn(game, info.search!);
    }

    const wait = MIN_THINK_MS - (performance.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return move;
  }

  /** Undefined means the master engine is unusable and the caller should use its own engine. */
  private async thinkMaster(game: Game): Promise<Move | null | undefined> {
    const token = ++this.masterToken;
    try {
      this.uci ??= new UciEngine();
      const move = await this.uci.search(
        game.startFen,
        game.history.map((h) => h.move),
        LEVEL_BY_ID.master.movetimeMs!,
      );
      if (token !== this.masterToken) return null; // cancelled meanwhile
      if (move && game.legalMovesFrom(move.from).includes(move.to)) return move;
      throw new Error(move ? 'engine returned an illegal move' : 'engine returned no move');
    } catch (err) {
      if (token !== this.masterToken) return null;
      this.masterBroken = true;
      this.uci?.dispose();
      this.uci = null;
      this.onFallback?.(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  private async thinkOwn(game: Game, search: SearchOptions): Promise<Move | null> {
    const request: Omit<AiRequest, 'id'> = {
      fen: game.startFen,
      moves: game.history.map((h) => h.move),
      search,
    };
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
    return move;
  }

  /** Abandons the outstanding request; its result is dropped. */
  cancel() {
    this.masterToken++;
    this.uci?.cancel();

    const stale = this.pending;
    if (!stale) return;
    this.pending = null;
    // A running search can't be interrupted, so replace the worker instead of queueing behind it.
    this.worker?.terminate();
    this.worker = undefined;
    stale.resolve(null);
  }
}
