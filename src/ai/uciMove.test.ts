import { describe, expect, it } from 'vitest';
import { START_FEN } from '../core/fen';
import { moveToUci, positionCommand, squareToUci, uciToMove } from './uciMove';

describe('UCI coordinates', () => {
  it('numbers ranks from red\'s back rank starting at 1', () => {
    expect(squareToUci(0)).toBe('a1');
    expect(squareToUci(8)).toBe('i1');
    expect(squareToUci(4 + 9 * 9)).toBe('e10');
  });

  it('round-trips every square pair, including rank 10', () => {
    for (const from of [0, 4, 17, 40, 85, 89]) {
      for (const to of [1, 22, 49, 80, 89]) {
        expect(uciToMove(moveToUci({ from, to }))).toEqual({ from, to });
      }
    }
  });

  it('parses engine output with trailing fields and rejects junk', () => {
    expect(uciToMove('c1e3')).toEqual({ from: 2, to: 22 });
    expect(uciToMove('c10e8')).toEqual({ from: 83, to: 67 });
    expect(uciToMove('(none)')).toBeNull();
    expect(uciToMove('z1a2')).toBeNull();
    expect(uciToMove('a0a1')).toBeNull();
    expect(uciToMove('a11a1')).toBeNull();
  });

  it('builds position commands from the first two FEN fields', () => {
    expect(positionCommand(START_FEN, [])).toBe(
      'position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
    );
    expect(positionCommand('3k5/9/9/9/9/9/9/9/9/4K4 b 0 12', [{ from: 0, to: 9 }, { from: 85, to: 76 }])).toBe(
      'position fen 3k5/9/9/9/9/9/9/9/9/4K4 b - - 0 1 moves a1a2 e10e9',
    );
  });
});
