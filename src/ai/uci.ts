import { Move } from '../core/types';
import { positionCommand, uciToMove } from './uciMove';

export interface MasterStatus {
  ok: boolean;
  /** Why the master level is unavailable, shown to the player. */
  reason?: string;
}

const base = () => `${import.meta.env.BASE_URL}engine/`;

/** The strong engine needs SharedArrayBuffer (cross-origin isolation) and its files on the server. */
export async function checkMaster(): Promise<MasterStatus> {
  if (typeof Worker === 'undefined') return { ok: false, reason: '此瀏覽器不支援' };
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
    return { ok: false, reason: '需要跨來源隔離（請重新整理頁面一次，或改用 Chrome／Edge／Firefox）' };
  }
  try {
    const res = await fetch(`${base()}vendor/stockfish.wasm`, { method: 'HEAD' });
    if (!res.ok) return { ok: false, reason: '找不到引擎檔案' };
  } catch {
    return { ok: false, reason: '無法載入引擎檔案' };
  }
  return { ok: true };
}

const INIT_TIMEOUT_MS = 20000;

interface Search {
  /** Null once cancelled; the engine's late bestmove for it is then discarded. */
  resolve: ((m: Move | null) => void) | null;
}

/** Fairy-Stockfish (xiangqi) driven over UCI in a worker. One instance serves a whole session. */
export class UciEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private readonly searches: Search[] = [];
  private listeners: ((line: string) => void)[] = [];

  /** Starts the engine on first use; rejects if it cannot come up. */
  start(): Promise<void> {
    this.ready ??= this.boot().catch((err) => {
      this.dispose();
      throw err;
    });
    return this.ready;
  }

  private async boot() {
    const worker = new Worker(`${base()}fsf-worker.js`);
    this.worker = worker;
    const started = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'error') reject(new Error(msg.message));
        else if (msg.type === 'line') this.onLine(msg.line as string);
      };
      worker.onerror = (e) => reject(new Error(e.message || 'engine worker failed'));
    });
    worker.postMessage({ type: 'init' });
    await withTimeout(started, INIT_TIMEOUT_MS, 'engine start timed out');

    this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.send('setoption name UCI_Variant value xiangqi');
    this.send(`setoption name Threads value ${Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))}`);
    this.send('setoption name Hash value 64');
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
  }

  private send(cmd: string) {
    this.worker?.postMessage({ type: 'uci', cmd });
  }

  private onLine(line: string) {
    for (const l of [...this.listeners]) l(line);
    if (line.startsWith('bestmove')) {
      // Replies arrive in the order searches were started, including ones that were cancelled.
      const search = this.searches.shift();
      search?.resolve?.(uciToMove(line.split(/\s+/)[1] ?? ''));
    }
  }

  private waitFor(pred: (line: string) => boolean): Promise<void> {
    return withTimeout(
      new Promise<void>((resolve) => {
        const listener = (line: string) => {
          if (!pred(line)) return;
          this.listeners = this.listeners.filter((l) => l !== listener);
          resolve();
        };
        this.listeners.push(listener);
      }),
      INIT_TIMEOUT_MS,
      'engine did not respond',
    );
  }

  /** Best move for the position reached from `startFen` by `moves`, thinking for `movetimeMs`. */
  async search(startFen: string, moves: Move[], movetimeMs: number): Promise<Move | null> {
    await this.start();
    this.cancel();
    return new Promise<Move | null>((resolve) => {
      this.searches.push({ resolve });
      this.send(positionCommand(startFen, moves));
      this.send(`go movetime ${Math.round(movetimeMs)}`);
    });
  }

  /** Stops the running search; its result is dropped. */
  cancel() {
    const live = this.searches[this.searches.length - 1];
    if (!live?.resolve) return;
    const { resolve } = live;
    live.resolve = null;
    resolve(null);
    this.send('stop');
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.listeners = [];
    for (const s of this.searches.splice(0)) s.resolve?.(null);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
