import { Side } from '../core/types';
import { FACTION_BY_ID, FactionId } from '../data/factions';

/** Messages exchanged between the two players. Both sides validate everything they receive. */
export type Msg =
  | { t: 'hello'; faction: FactionId }
  | { t: 'start'; hostSide: Side; hostFaction: FactionId; guestFaction: FactionId }
  | { t: 'move'; from: number; to: number; /** Plies played once this move is on the board. */ n: number }
  | { t: 'resign' }
  | {
      t: 'undo-request';
      /** How many plies to take back: 1 (my last move) or 2 (the reply too). */
      plies: 1 | 2;
      /** Plies played when asking; a move made in the meantime voids the request. */
      n: number;
    }
  | { t: 'undo-reply'; ok: boolean }
  | { t: 'chat'; text: string };

/** Longest chat line we send; longer ones that arrive are cut rather than refused. */
export const CHAT_MAX = 120;

/** Trims, drops control characters and caps the length. Empty means there is nothing to send. */
export function cleanChat(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

const isSquare = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 90;
const isFaction = (v: unknown): v is FactionId => typeof v === 'string' && v in FACTION_BY_ID;
const isSide = (v: unknown): v is Side => v === 'red' || v === 'black';

/** Returns the message if `data` is a well-formed one, otherwise null. */
export function parseMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return isFaction(m.faction) ? { t: 'hello', faction: m.faction } : null;
    case 'start':
      return isSide(m.hostSide) && isFaction(m.hostFaction) && isFaction(m.guestFaction)
        ? { t: 'start', hostSide: m.hostSide, hostFaction: m.hostFaction, guestFaction: m.guestFaction }
        : null;
    case 'move':
      return isSquare(m.from) && isSquare(m.to) && Number.isInteger(m.n) && (m.n as number) > 0
        ? { t: 'move', from: m.from, to: m.to, n: m.n as number }
        : null;
    case 'resign':
      return { t: 'resign' };
    case 'undo-request':
      return (m.plies === 1 || m.plies === 2) && Number.isInteger(m.n) && (m.n as number) >= m.plies
        ? { t: 'undo-request', plies: m.plies, n: m.n as number }
        : null;
    case 'undo-reply':
      return typeof m.ok === 'boolean' ? { t: 'undo-reply', ok: m.ok } : null;
    case 'chat': {
      if (typeof m.text !== 'string') return null;
      const text = cleanChat(m.text);
      return text ? { t: 'chat', text } : null;
    }
    default:
      return null;
  }
}

/** Room codes avoid look-alike characters (0/O, 1/I/L) so they can be read out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** Cleans up what a person typed or pasted; returns null if it cannot be a room code. */
export function normalizeCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

/** Peer ids live in a shared namespace on the signalling server, so they carry a prefix. */
export const peerIdFor = (code: string) => `xq3d-${code}`;

/** Link that brings a guest straight to the join form with the code filled in. */
export function inviteLink(code: string, page: string): string {
  const url = new URL(page);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  return url.toString();
}
