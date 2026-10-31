import { cleanChat } from './protocol';

/** Preset lines that always come first and cannot be removed. */
export const PRESET_LINES = ['承讓承讓', '這步有點意思', '再想想？', '我的炮可不是擺設', '勝負未定，別急'];

export const CUSTOM_MAX = 20;
export const LINE_MAX = 40;

const STORAGE_KEY = 'xq3d.quicklines';

/** Cleans a saved list: strings only, trimmed, no duplicates or presets, within the limits. */
export function normalizeCustom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const line = cleanChat(item).slice(0, LINE_MAX);
    if (line && !PRESET_LINES.includes(line) && !out.includes(line)) out.push(line);
    if (out.length >= CUSTOM_MAX) break;
  }
  return out;
}

/** Adds a line; returns the same list when it is empty, a duplicate, or the list is full. */
export function addCustom(lines: string[], text: string): string[] {
  const line = cleanChat(text).slice(0, LINE_MAX);
  if (!line || PRESET_LINES.includes(line) || lines.includes(line) || lines.length >= CUSTOM_MAX) return lines;
  return [...lines, line];
}

export const removeCustom = (lines: string[], line: string) => lines.filter((l) => l !== line);

/** Custom lines live in this browser only; storage may be unavailable (private mode). */
export function loadCustom(): string[] {
  try {
    return normalizeCustom(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function saveCustom(lines: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Not critical: the lines just will not survive a reload.
  }
}
