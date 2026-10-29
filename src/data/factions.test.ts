import { describe, expect, it } from 'vitest';
import { parseFen, START_FEN } from '../core/fen';
import { FACTIONS, FACTION_BY_ID, characterFor } from './factions';

describe('factions', () => {
  it('has eight factions with complete rosters', () => {
    expect(FACTIONS.map((f) => f.name).join('')).toBe('楚漢蜀魏吳秦唐宋');
    for (const f of FACTIONS) {
      const { k, a, b, r, n, c, p } = f.roster;
      const people = [k, ...a, ...b, ...r, ...n, ...c, p];
      expect(people).toHaveLength(12);
      for (const ch of people) {
        expect(ch.name && ch.epithet && ch.bio && ch.skill.name && ch.skill.desc).toBeTruthy();
      }
      expect(new Set(people.map((ch) => ch.id)).size).toBe(12);
    }
  });

  it('gives each of the 16 pieces a character, with the two rooks as different people', () => {
    const shu = FACTION_BY_ID.shu;
    const pieces = parseFen(START_FEN).board.filter((p) => p?.side === 'red');
    const names = pieces.map((p) => characterFor(shu, p!).name);
    expect(names).toHaveLength(16);
    expect(names.filter((n) => n === '白毦兵')).toHaveLength(5);
    expect(new Set(names.filter((n) => n !== '白毦兵')).size).toBe(11);
    expect(names).toContain('關羽');
    expect(names).toContain('張飛');
  });
});
