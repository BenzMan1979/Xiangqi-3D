import { describe, expect, it } from 'vitest';
import { FACTIONS } from './factions';
import { ULT_TEMPLATES, assignedIds, hasUltimateAssignment, ultimateFor } from './ultimates';

const everyCharacter = FACTIONS.flatMap((f) =>
  Object.values(f.roster).flatMap((slot) => (Array.isArray(slot) ? slot : [slot]).map((ch) => ({ f, ch }))),
);

describe('ultimates', () => {
  it('assigns every character a template', () => {
    for (const { ch } of everyCharacter) expect(hasUltimateAssignment(ch.id), ch.id).toBe(true);
  });

  it('refers only to existing characters', () => {
    const ids = new Set(everyCharacter.map(({ ch }) => ch.id));
    for (const id of assignedIds()) expect(ids.has(id), id).toBe(true);
  });

  it('uses every template and gives each faction some variety', () => {
    const used = new Set(everyCharacter.map(({ f, ch }) => ultimateFor(ch, f).template));
    expect([...used].sort()).toEqual([...ULT_TEMPLATES].sort());
    for (const f of FACTIONS) {
      const own = new Set(
        Object.values(f.roster).flatMap((slot) => (Array.isArray(slot) ? slot : [slot]).map((ch) => ultimateFor(ch, f).template)),
      );
      expect(own.size, f.id).toBeGreaterThanOrEqual(4);
    }
  });

  it('produces valid hex colours', () => {
    for (const { f, ch } of everyCharacter) expect(ultimateFor(ch, f).color, ch.id).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
