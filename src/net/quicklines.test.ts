import { describe, expect, it } from 'vitest';
import { CUSTOM_MAX, LINE_MAX, PRESET_LINES, addCustom, normalizeCustom, removeCustom } from './quicklines';

describe('quick lines', () => {
  it('adds trimmed, unique lines and refuses presets and empties', () => {
    let lines: string[] = [];
    lines = addCustom(lines, '  你的車呢？ ');
    expect(lines).toEqual(['你的車呢？']);
    expect(addCustom(lines, '你的車呢？')).toBe(lines);
    expect(addCustom(lines, '   ')).toBe(lines);
    expect(addCustom(lines, PRESET_LINES[0])).toBe(lines);
  });

  it('caps the length of a line and the number of lines', () => {
    expect(addCustom([], '字'.repeat(100))[0]).toHaveLength(LINE_MAX);
    let lines: string[] = [];
    for (let i = 0; i < CUSTOM_MAX + 5; i++) lines = addCustom(lines, `第${i}句`);
    expect(lines).toHaveLength(CUSTOM_MAX);
  });

  it('removes a line', () => {
    expect(removeCustom(['甲', '乙', '丙'], '乙')).toEqual(['甲', '丙']);
  });

  it('survives garbage in storage', () => {
    expect(normalizeCustom(null)).toEqual([]);
    expect(normalizeCustom('x')).toEqual([]);
    expect(normalizeCustom([1, null, '甲', '甲', '  ', PRESET_LINES[1], '乙'])).toEqual(['甲', '乙']);
  });
});
