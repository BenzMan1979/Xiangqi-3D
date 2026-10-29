import { SearchOptions } from './engine';

export type AiLevel = 'beginner' | 'intermediate' | 'advanced';

export interface LevelInfo {
  id: AiLevel;
  name: string;
  blurb: string;
  search: SearchOptions;
}

export const AI_LEVELS: LevelInfo[] = [
  { id: 'beginner', name: '入門', blurb: '只看一步，常常失誤', search: { depth: 1, timeMs: 500, noise: 260 } },
  { id: 'intermediate', name: '中級', blurb: '看三步，偶爾失誤', search: { depth: 3, timeMs: 1200, noise: 40 } },
  { id: 'advanced', name: '高手', blurb: '深算十步以上，少有破綻', search: { depth: 12, timeMs: 2500 } },
];

export const LEVEL_BY_ID = Object.fromEntries(AI_LEVELS.map((l) => [l.id, l])) as Record<AiLevel, LevelInfo>;
