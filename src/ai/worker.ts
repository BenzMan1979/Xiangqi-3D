/// <reference lib="webworker" />
import { Engine, SearchOptions } from './engine';
import { Move } from '../core/types';

export interface AiRequest {
  id: number;
  /** Position the game started from, and every move played since. */
  fen: string;
  moves: Move[];
  search: SearchOptions;
}

export interface AiResponse {
  id: number;
  move: Move | null;
  score: number;
  depth: number;
}

const engine = new Engine();

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, fen, moves, search } = e.data;
  engine.setPosition(fen, moves);
  const result = engine.search(search);
  const response: AiResponse = { id, move: result.move, score: result.score, depth: result.depth };
  (self as DedicatedWorkerGlobalScope).postMessage(response);
};
