/**
 * Self-contained xiangqi search engine: mailbox board, make/unmake, alpha-beta with a
 * transposition table, quiescence search and a material + piece-square evaluation.
 * Independent of the renderer and of `core/rules` (which stays the source of truth for the
 * game itself); the tests cross-check the two move generators.
 */
import { parseFen } from '../core/fen';
import { FILES, Move, PieceType, RANKS } from '../core/types';

const K = 1;
const A = 2;
const B = 3;
const R = 4;
const N = 5;
const C = 6;
const P = 7;
const CODE: Record<PieceType, number> = { k: K, a: A, b: B, r: R, n: N, c: C, p: P };

const SQUARES = FILES * RANKS;
const MAX_PLY = 64;
const MAX_MOVES = 128;
const MAX_STACK = 8192;

export const MATE = 30000;
const INF = 32000;
const MATE_BOUND = MATE - 200;
const TEMPO = 8;

// ---------------------------------------------------------------------------------------------
// Static tables. Squares use the same indexing as core: y * 9 + x, y = 0 is red's back rank.
// ---------------------------------------------------------------------------------------------

const inB = (x: number, y: number) => x >= 0 && x < FILES && y >= 0 && y < RANKS;
const at = (x: number, y: number) => y * FILES + x;
const ownHalf = (si: number, y: number) => (si === 0 ? y <= 4 : y >= 5);
const inPalace = (si: number, x: number, y: number) =>
  x >= 3 && x <= 5 && (si === 0 ? y >= 0 && y <= 2 : y >= 7 && y <= 9);

const ORTHO: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT: [number, number][] = [[1, 2], [-1, 2], [1, -2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]];

/** Per side index (0 red, 1 black), per square. */
const KING_T: number[][][] = [[], []];
const ADVISOR_T: number[][][] = [[], []];
/** Flat [target, eye, target, eye, ...]. */
const BISHOP_T: number[][][] = [[], []];
const PAWN_T: number[][][] = [[], []];
/** PAWN_ATT[si][s]: squares from which an enemy pawn attacks a `si` piece standing on s. */
const PAWN_ATT: number[][][] = [[], []];
/** Flat [target, leg, ...]. */
const KNIGHT_T: number[][] = [];
/** Flat [knightSquare, leg, ...] for knights that attack the given square. */
const KNIGHT_ATT: number[][] = [];
const RAYS: number[][][] = [];

for (let s = 0; s < SQUARES; s++) {
  const x = s % FILES;
  const y = Math.floor(s / FILES);

  for (const si of [0, 1]) {
    KING_T[si][s] = ORTHO.map(([dx, dy]) => [x + dx, y + dy])
      .filter(([nx, ny]) => inPalace(si, nx, ny))
      .map(([nx, ny]) => at(nx, ny));
    ADVISOR_T[si][s] = DIAG.map(([dx, dy]) => [x + dx, y + dy])
      .filter(([nx, ny]) => inPalace(si, nx, ny))
      .map(([nx, ny]) => at(nx, ny));

    const bishop: number[] = [];
    for (const [dx, dy] of DIAG) {
      const nx = x + 2 * dx;
      const ny = y + 2 * dy;
      if (inB(nx, ny) && ownHalf(si, ny)) bishop.push(at(nx, ny), at(x + dx, y + dy));
    }
    BISHOP_T[si][s] = bishop;

    const fwd = si === 0 ? 1 : -1;
    const pawn: number[] = [];
    if (inB(x, y + fwd)) pawn.push(at(x, y + fwd));
    if (!ownHalf(si, y)) for (const dx of [-1, 1]) if (inB(x + dx, y)) pawn.push(at(x + dx, y));
    PAWN_T[si][s] = pawn;

    // Attackers of a `si` piece are pawns of the other side (1 - si).
    const efwd = si === 0 ? -1 : 1;
    const att: number[] = [];
    if (inB(x, y - efwd)) att.push(at(x, y - efwd));
    if (!ownHalf(1 - si, y)) for (const dx of [-1, 1]) if (inB(x + dx, y)) att.push(at(x + dx, y));
    PAWN_ATT[si][s] = att;
  }

  const kt: number[] = [];
  const ka: number[] = [];
  for (const [dx, dy] of KNIGHT) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inB(nx, ny)) continue;
    kt.push(at(nx, ny), at(Math.abs(dx) === 2 ? x + dx / 2 : x, Math.abs(dy) === 2 ? y + dy / 2 : y));
    ka.push(at(nx, ny), at(Math.abs(dx) === 2 ? nx - Math.sign(dx) : nx, Math.abs(dy) === 2 ? ny - Math.sign(dy) : ny));
  }
  KNIGHT_T[s] = kt;
  KNIGHT_ATT[s] = ka;

  RAYS[s] = ORTHO.map(([dx, dy]) => {
    const ray: number[] = [];
    for (let nx = x + dx, ny = y + dy; inB(nx, ny); nx += dx, ny += dy) ray.push(at(nx, ny));
    return ray;
  });
}

// ---------------------------------------------------------------------------------------------
// Evaluation tables (centipawns). V[(piece + 7) * 90 + sq] is the signed value of a piece on a
// square, positive for red, so the running total is maintained incrementally.
// ---------------------------------------------------------------------------------------------

const BASE = [0, 0, 200, 200, 1000, 450, 450, 100];

function pst(type: number, x: number, y: number): number {
  const centre = 4 - Math.abs(x - 4);
  switch (type) {
    case R:
      return Math.min(y, 8) * 4 + centre * 4;
    case N:
      return centre * 10 + Math.min(y, 7) * 6 - (x === 0 || x === 8 ? 15 : 0);
    case C:
      return centre * 5 + (x === 4 ? 15 : 0) + y * 2;
    case P:
      if (y <= 4) return y >= 3 ? 10 : 0;
      return 100 + (y - 5) * 12 + centre * 8 - (y === 9 ? 40 : 0);
    default:
      return 0;
  }
}

const V = new Int32Array(14 * SQUARES);
for (let type = 1; type <= 7; type++) {
  for (let s = 0; s < SQUARES; s++) {
    const x = s % FILES;
    const y = Math.floor(s / FILES);
    V[(type + 7) * SQUARES + s] = BASE[type] + pst(type, x, y);
    V[(-type + 7) * SQUARES + s] = -(BASE[type] + pst(type, x, 9 - y));
  }
}

/** Victim weights for most-valuable-victim ordering. */
const MVV = [0, 0, 20, 20, 90, 45, 45, 10];

// ---------------------------------------------------------------------------------------------
// Zobrist hashing with a deterministic generator so searches are reproducible.
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
}
const nextRandom = mulberry32(0x5eed1234);
const Z1 = new Int32Array(14 * SQUARES).map(() => nextRandom());
const Z2 = new Int32Array(14 * SQUARES).map(() => nextRandom());
const SIDE1 = nextRandom();
const SIDE2 = nextRandom();

const TT_BITS = 18;
const TT_MASK = (1 << TT_BITS) - 1;
const TT_EXACT = 1;
const TT_LOWER = 2;
const TT_UPPER = 3;

// ---------------------------------------------------------------------------------------------

export interface SearchOptions {
  /** Maximum depth in plies, before check extensions. */
  depth: number;
  /** Wall-clock budget for the whole search. */
  timeMs: number;
  /** Random centipawn noise added to every root move, for weaker and more varied play. */
  noise?: number;
  rng?: () => number;
}

export interface SearchResult {
  move: Move | null;
  /** Centipawns from the point of view of the side to move; ±(MATE - n) when a mate is found. */
  score: number;
  /** Deepest fully completed iteration. */
  depth: number;
  nodes: number;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const moveOf = (m: number): Move => ({ from: m & 127, to: m >> 7 });
const encode = (move: Move) => move.from | (move.to << 7);

export class Engine {
  private readonly board = new Int8Array(SQUARES);
  /** +1 red to move, -1 black to move. */
  private stm = 1;
  private readonly kingSq = [0, 0];
  private h1 = 0;
  private h2 = 0;
  /** Material + positional balance, positive when red is ahead. */
  private score = 0;

  // Per-ply state; index 0 is the position the engine was set up with.
  private sp = 0;
  private readonly hashStack = new Int32Array(MAX_STACK);
  private readonly h2Stack = new Int32Array(MAX_STACK);
  private readonly scoreStack = new Int32Array(MAX_STACK);
  private readonly capStack = new Int8Array(MAX_STACK);
  private readonly quietStack = new Int32Array(MAX_STACK);

  private readonly moveBuf = Array.from({ length: MAX_PLY + 2 }, () => new Int32Array(MAX_MOVES));
  private readonly scoreBuf = Array.from({ length: MAX_PLY + 2 }, () => new Int32Array(MAX_MOVES));
  private readonly killers = new Int32Array((MAX_PLY + 2) * 2);
  private readonly history = new Int32Array(SQUARES * SQUARES);

  private readonly ttKey = new Int32Array(1 << TT_BITS);
  private readonly ttMove = new Int32Array(1 << TT_BITS);
  private readonly ttScore = new Int32Array(1 << TT_BITS);
  private readonly ttDepth = new Int8Array(1 << TT_BITS);
  private readonly ttFlag = new Uint8Array(1 << TT_BITS);

  private nodes = 0;
  private deadline = 0;
  private aborted = false;

  constructor(fen?: string, moves: Move[] = []) {
    if (fen) this.setPosition(fen, moves);
  }

  /** Sets up `fen` and replays `moves` on it, so repetitions in the game history are known. */
  setPosition(fen: string, moves: Move[] = []) {
    const { board, turn } = parseFen(fen);
    this.board.fill(0);
    this.h1 = 0;
    this.h2 = 0;
    this.score = 0;
    for (let s = 0; s < SQUARES; s++) {
      const p = board[s];
      if (!p) continue;
      const code = CODE[p.type] * (p.side === 'red' ? 1 : -1);
      this.board[s] = code;
      this.h1 ^= Z1[(code + 7) * SQUARES + s];
      this.h2 ^= Z2[(code + 7) * SQUARES + s];
      this.score += V[(code + 7) * SQUARES + s];
      if (p.type === 'k') this.kingSq[p.side === 'red' ? 0 : 1] = s;
    }
    this.stm = turn === 'red' ? 1 : -1;
    if (this.stm === -1) {
      this.h1 ^= SIDE1;
      this.h2 ^= SIDE2;
    }
    this.sp = 0;
    this.hashStack[0] = this.h1;
    this.h2Stack[0] = this.h2;
    this.scoreStack[0] = this.score;
    this.capStack[0] = 0;
    this.quietStack[0] = 0;
    for (const m of moves) this.make(encode(m));
  }

  // ----- Move making -------------------------------------------------------------------------

  private make(m: number) {
    const from = m & 127;
    const to = m >> 7;
    const b = this.board;
    const piece = b[from];
    const cap = b[to];
    b[to] = piece;
    b[from] = 0;

    const pi = (piece + 7) * SQUARES;
    this.h1 ^= Z1[pi + from] ^ Z1[pi + to] ^ SIDE1;
    this.h2 ^= Z2[pi + from] ^ Z2[pi + to] ^ SIDE2;
    this.score += V[pi + to] - V[pi + from];
    if (cap) {
      const ci = (cap + 7) * SQUARES + to;
      this.h1 ^= Z1[ci];
      this.h2 ^= Z2[ci];
      this.score -= V[ci];
    }
    if (piece === K) this.kingSq[0] = to;
    else if (piece === -K) this.kingSq[1] = to;
    this.stm = -this.stm;

    const sp = ++this.sp;
    this.hashStack[sp] = this.h1;
    this.h2Stack[sp] = this.h2;
    this.scoreStack[sp] = this.score;
    this.capStack[sp] = cap;
    this.quietStack[sp] = cap ? 0 : this.quietStack[sp - 1] + 1;
  }

  private unmake(m: number) {
    const from = m & 127;
    const to = m >> 7;
    const b = this.board;
    const sp = this.sp;
    const piece = b[to];
    b[from] = piece;
    b[to] = this.capStack[sp];
    if (piece === K) this.kingSq[0] = from;
    else if (piece === -K) this.kingSq[1] = from;
    this.stm = -this.stm;
    this.sp = sp - 1;
    this.h1 = this.hashStack[sp - 1];
    this.h2 = this.h2Stack[sp - 1];
    this.score = this.scoreStack[sp - 1];
  }

  // ----- Move generation ---------------------------------------------------------------------

  /** Pseudo-legal moves for the side to move (may leave its own king in check). */
  private generate(out: Int32Array, capturesOnly: boolean): number {
    const b = this.board;
    const stm = this.stm;
    const si = stm === 1 ? 0 : 1;
    let n = 0;

    for (let s = 0; s < SQUARES; s++) {
      const own = b[s] * stm;
      if (own <= 0) continue;

      switch (own) {
        case K:
        case A:
        case P: {
          const targets = own === K ? KING_T[si][s] : own === A ? ADVISOR_T[si][s] : PAWN_T[si][s];
          for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            const o = b[t] * stm;
            if (o > 0 || (capturesOnly && o === 0)) continue;
            out[n++] = s | (t << 7);
          }
          break;
        }
        case B: {
          const targets = BISHOP_T[si][s];
          for (let i = 0; i < targets.length; i += 2) {
            if (b[targets[i + 1]] !== 0) continue;
            const t = targets[i];
            const o = b[t] * stm;
            if (o > 0 || (capturesOnly && o === 0)) continue;
            out[n++] = s | (t << 7);
          }
          break;
        }
        case N: {
          const targets = KNIGHT_T[s];
          for (let i = 0; i < targets.length; i += 2) {
            if (b[targets[i + 1]] !== 0) continue;
            const t = targets[i];
            const o = b[t] * stm;
            if (o > 0 || (capturesOnly && o === 0)) continue;
            out[n++] = s | (t << 7);
          }
          break;
        }
        case R:
          for (const ray of RAYS[s]) {
            for (let i = 0; i < ray.length; i++) {
              const t = ray[i];
              const o = b[t] * stm;
              if (o === 0) {
                if (!capturesOnly) out[n++] = s | (t << 7);
                continue;
              }
              if (o < 0) out[n++] = s | (t << 7);
              break;
            }
          }
          break;
        case C:
          for (const ray of RAYS[s]) {
            let screened = false;
            for (let i = 0; i < ray.length; i++) {
              const t = ray[i];
              const o = b[t] * stm;
              if (!screened) {
                if (o === 0) {
                  if (!capturesOnly) out[n++] = s | (t << 7);
                } else {
                  screened = true;
                }
              } else if (o !== 0) {
                if (o < 0) out[n++] = s | (t << 7);
                break;
              }
            }
          }
          break;
      }
    }
    return n;
  }

  /** True when the king of `side` (+1 red, -1 black) standing on `ks` is attacked. */
  private isAttacked(ks: number, side: number): boolean {
    const b = this.board;
    const enemy = -side;

    for (const ray of RAYS[ks]) {
      let screened = false;
      for (let i = 0; i < ray.length; i++) {
        const v = b[ray[i]];
        if (v === 0) continue;
        if (!screened) {
          // A bare enemy king on the same file is the flying general.
          if (v === enemy * R || v === enemy * K) return true;
          screened = true;
        } else {
          if (v === enemy * C) return true;
          break;
        }
      }
    }

    const knights = KNIGHT_ATT[ks];
    for (let i = 0; i < knights.length; i += 2) {
      if (b[knights[i]] === enemy * N && b[knights[i + 1]] === 0) return true;
    }

    const pawns = PAWN_ATT[side === 1 ? 0 : 1][ks];
    for (let i = 0; i < pawns.length; i++) if (b[pawns[i]] === enemy * P) return true;

    return false;
  }

  /** Whether the side to move is in check. */
  private inCheck(): boolean {
    return this.isAttacked(this.kingSq[this.stm === 1 ? 0 : 1], this.stm);
  }

  /** Plays pseudo-legal move `m` and reports whether it left the mover's own king safe. */
  private makeLegal(m: number): boolean {
    const mover = this.stm;
    this.make(m);
    if (this.isAttacked(this.kingSq[mover === 1 ? 0 : 1], mover)) {
      this.unmake(m);
      return false;
    }
    return true;
  }

  private legalList(ply = 0): number[] {
    const buf = this.moveBuf[ply];
    const count = this.generate(buf, false);
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      if (this.makeLegal(buf[i])) {
        this.unmake(buf[i]);
        out.push(buf[i]);
      }
    }
    return out;
  }

  legalMoves(): Move[] {
    return this.legalList().map(moveOf);
  }

  /** Leaf count of the legal move tree, for validating the move generator. */
  perft(depth: number, ply = 0): number {
    if (depth === 0) return 1;
    const buf = this.moveBuf[ply];
    const count = this.generate(buf, false);
    let total = 0;
    for (let i = 0; i < count; i++) {
      const m = buf[i];
      if (!this.makeLegal(m)) continue;
      total += depth === 1 ? 1 : this.perft(depth - 1, ply + 1);
      this.unmake(m);
    }
    return total;
  }

  // ----- Search ------------------------------------------------------------------------------

  private evaluate(): number {
    return (this.stm === 1 ? this.score : -this.score) + TEMPO;
  }

  private isRepetition(): boolean {
    const sp = this.sp;
    const h = this.hashStack[sp];
    const limit = Math.max(0, sp - this.quietStack[sp]);
    for (let i = sp - 2; i >= limit; i -= 2) if (this.hashStack[i] === h) return true;
    return false;
  }

  private scoreMoves(ply: number, count: number, ttMove: number) {
    const moves = this.moveBuf[ply];
    const scores = this.scoreBuf[ply];
    const b = this.board;
    const k0 = this.killers[ply * 2];
    const k1 = this.killers[ply * 2 + 1];
    for (let i = 0; i < count; i++) {
      const m = moves[i];
      const from = m & 127;
      const to = m >> 7;
      const victim = Math.abs(b[to]);
      if (m === ttMove) scores[i] = 1_000_000;
      else if (victim) scores[i] = 100_000 + MVV[victim] * 16 - Math.abs(b[from]);
      else if (m === k0) scores[i] = 90_000;
      else if (m === k1) scores[i] = 80_000;
      else scores[i] = this.history[from * SQUARES + to];
    }
  }

  /** Selection-sort step: moves the best remaining move to index i. */
  private pick(ply: number, i: number, count: number): number {
    const moves = this.moveBuf[ply];
    const scores = this.scoreBuf[ply];
    let best = i;
    for (let j = i + 1; j < count; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) {
      const m = moves[i];
      moves[i] = moves[best];
      moves[best] = m;
      const s = scores[i];
      scores[i] = scores[best];
      scores[best] = s;
    }
    return moves[i];
  }

  private tick() {
    if ((++this.nodes & 2047) === 0 && now() > this.deadline) this.aborted = true;
  }

  private quiesce(alpha: number, beta: number, ply: number): number {
    this.tick();
    if (this.aborted) return 0;
    const stand = this.evaluate();
    if (stand >= beta || ply >= MAX_PLY) return stand;
    if (stand > alpha) alpha = stand;

    const count = this.generate(this.moveBuf[ply], true);
    this.scoreMoves(ply, count, 0);
    for (let i = 0; i < count; i++) {
      const m = this.pick(ply, i, count);
      if (!this.makeLegal(m)) continue;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      this.unmake(m);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.tick();
    if (this.aborted) return 0;
    if (this.isRepetition()) return 0;
    if (ply >= MAX_PLY) return this.evaluate();

    const inChk = this.inCheck();
    if (inChk && ply < 48) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);

    const alphaOrig = alpha;
    const idx = this.h1 & TT_MASK;
    let ttMove = 0;
    if (this.ttFlag[idx] && this.ttKey[idx] === this.h2) {
      ttMove = this.ttMove[idx];
      if (this.ttDepth[idx] >= depth) {
        let s = this.ttScore[idx];
        if (s > MATE_BOUND) s -= ply;
        else if (s < -MATE_BOUND) s += ply;
        const flag = this.ttFlag[idx];
        if (flag === TT_EXACT) return s;
        if (flag === TT_LOWER && s > alpha) alpha = s;
        else if (flag === TT_UPPER && s < beta) beta = s;
        if (alpha >= beta) return s;
      }
    }

    const moves = this.moveBuf[ply];
    const count = this.generate(moves, false);
    this.scoreMoves(ply, count, ttMove);

    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    for (let i = 0; i < count; i++) {
      const m = this.pick(ply, i, count);
      const isCapture = this.board[m >> 7] !== 0;
      if (!this.makeLegal(m)) continue;
      legal++;

      let score: number;
      if (legal === 1) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      } else {
        const reduce = depth >= 3 && legal > 4 && !isCapture && !inChk && !this.inCheck() ? 1 : 0;
        score = -this.negamax(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && (reduce > 0 || score < beta)) {
          score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
        }
      }
      this.unmake(m);
      if (this.aborted) return 0;

      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (!isCapture) {
              this.history[(m & 127) * SQUARES + (m >> 7)] += depth * depth;
              if (this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = m;
              }
            }
            break;
          }
        }
      }
    }

    // No legal move loses in xiangqi, whether or not the king is attacked.
    if (legal === 0) return -MATE + ply;

    if (this.ttFlag[idx] === 0 || this.ttKey[idx] !== this.h2 || depth >= this.ttDepth[idx]) {
      let stored = best;
      if (stored > MATE_BOUND) stored += ply;
      else if (stored < -MATE_BOUND) stored -= ply;
      this.ttKey[idx] = this.h2;
      this.ttMove[idx] = bestMove;
      this.ttScore[idx] = stored;
      this.ttDepth[idx] = depth;
      this.ttFlag[idx] = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    }
    return best;
  }

  /** One root iteration; reorders `moves` so the best comes first. Null when time ran out. */
  private searchRoot(moves: number[], depth: number): { move: number; score: number } | null {
    let alpha = -INF;
    let bestIndex = 0;
    for (let i = 0; i < moves.length; i++) {
      this.makeLegal(moves[i]);
      let score: number;
      if (i === 0) {
        score = -this.negamax(depth - 1, -INF, -alpha, 1);
      } else {
        score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1);
        if (score > alpha) score = -this.negamax(depth - 1, -INF, -alpha, 1);
      }
      this.unmake(moves[i]);
      if (this.aborted) return null;
      if (i === 0 || score > alpha) {
        alpha = score;
        bestIndex = i;
      }
    }
    const [best] = moves.splice(bestIndex, 1);
    moves.unshift(best);
    return { move: best, score: alpha };
  }

  /** Scores every root move on its own and perturbs the scores; used by the weaker levels. */
  private searchNoisy(moves: number[], depth: number, noise: number, rng: () => number) {
    let bestMove = moves[0];
    let bestScore = -INF;
    let bestRaw = 0;
    for (const m of moves) {
      this.makeLegal(m);
      const raw = -this.negamax(depth - 1, -INF, INF, 1);
      this.unmake(m);
      if (this.aborted) break;
      // Never blur a forced win or loss.
      const score = Math.abs(raw) > MATE_BOUND ? raw : raw + (rng() * 2 - 1) * noise;
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        bestRaw = raw;
      }
    }
    return { move: bestMove, score: bestRaw };
  }

  search(options: SearchOptions): SearchResult {
    this.deadline = now() + options.timeMs;
    this.aborted = false;
    this.nodes = 0;
    this.history.fill(0);
    this.killers.fill(0);

    const moves = this.legalList();
    if (moves.length === 0) return { move: null, score: -MATE, depth: 0, nodes: 0 };
    if (moves.length === 1) return { move: moveOf(moves[0]), score: 0, depth: 0, nodes: 0 };

    // Seed the ordering with captures first.
    this.moveBuf[0].set(moves);
    this.scoreMoves(0, moves.length, 0);
    const order = moves.map((m, i) => [m, this.scoreBuf[0][i]]).sort((p, q) => q[1] - p[1]);
    moves.splice(0, moves.length, ...order.map((p) => p[0]));

    const noise = options.noise ?? 0;
    if (noise > 0) {
      const r = this.searchNoisy(moves, Math.max(1, options.depth), noise, options.rng ?? Math.random);
      return { move: moveOf(r.move), score: r.score, depth: options.depth, nodes: this.nodes };
    }

    let best = moves[0];
    let bestScore = 0;
    let done = 0;
    const started = now();
    for (let depth = 1; depth <= options.depth; depth++) {
      const r = this.searchRoot(moves, depth);
      if (!r) break;
      best = r.move;
      bestScore = r.score;
      done = depth;
      if (Math.abs(bestScore) > MATE_BOUND) break;
      // The next iteration usually costs several times the last; skip it when it cannot finish.
      if (now() - started > options.timeMs * 0.45) break;
    }
    return { move: moveOf(best), score: bestScore, depth: done, nodes: this.nodes };
  }
}
