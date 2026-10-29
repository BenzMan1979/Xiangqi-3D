import { SearchOptions } from './engine';

export type AiLevel = 'beginner' | 'intermediate' | 'advanced' | 'master';

export interface LevelInfo {
  id: AiLevel;
  name: string;
  blurb: string;
  /** Own engine settings; the master level uses the external engine and has none. */
  search: SearchOptions | null;
  /** Milliseconds per move for the external engine. */
  movetimeMs?: number;
}

export const AI_LEVELS: LevelInfo[] = [
  { id: 'beginner', name: '入門', blurb: '只看一步，常常失誤', search: { depth: 1, timeMs: 500, noise: 260 } },
  { id: 'intermediate', name: '中級', blurb: '看三步，偶爾失誤', search: { depth: 3, timeMs: 1200, noise: 40 } },
  { id: 'advanced', name: '高手', blurb: '深算十步以上，少有破綻', search: { depth: 12, timeMs: 2500 } },
  { id: 'master', name: '大師', blurb: '專業引擎 Fairy-Stockfish，極難取勝', search: null, movetimeMs: 2000 },
];

/** The best of our own engine's levels, used when the master engine cannot run. */
export const OWN_ENGINE_FALLBACK: AiLevel = 'advanced';

export const LEVEL_BY_ID = Object.fromEntries(AI_LEVELS.map((l) => [l.id, l])) as Record<AiLevel, LevelInfo>;
