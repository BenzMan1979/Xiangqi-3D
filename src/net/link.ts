import { Side, opponent } from '../core/types';
import { FactionId } from '../data/factions';
import { Msg, parseMsg } from './protocol';

/** A reliable, ordered, bidirectional channel to the other player (a WebRTC data channel in practice). */
export interface Transport {
  send(data: unknown): void;
  close(): void;
  onData: ((data: unknown) => void) | null;
  onClose: (() => void) | null;
}

const HANDSHAKE_TIMEOUT_MS = 15000;
const PING_EVERY_MS = 4000;
/** A visible opponent that has said nothing for this long is gone. */
export const STALE_MS = 16000;

/** Whether silence from the other side means they left. Background tabs are throttled, so no verdict there. */
export function isStale(lastSeen: number, now: number, remoteHidden: boolean): boolean {
  return !remoteHidden && now - lastSeen > STALE_MS;
}

/**
 * Typed wrapper over a transport. Messages that arrive before a handler is attached (the other
 * player can move the instant the game starts) are kept and delivered once one is set.
 */
export class Link {
  closed = false;
  private handler: ((m: Msg) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private readonly buffer: Msg[] = [];
  private readonly waiters: ((m: Msg) => boolean)[] = [];
  private lastSeen = Date.now();
  private remoteHidden = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly transport: Transport) {
    transport.onData = (data) => {
      const msg = parseMsg(data);
      if (!msg) return; // ignore anything malformed
      this.lastSeen = Date.now();
      if (msg.t === 'ping') {
        this.remoteHidden = msg.hidden;
        return;
      }
      const i = this.waiters.findIndex((w) => w(msg));
      if (i >= 0) {
        this.waiters.splice(i, 1);
        return;
      }
      if (this.handler) this.handler(msg);
      else this.buffer.push(msg);
    };
    transport.onClose = () => this.markClosed();
  }

  private markClosed() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.closeHandler?.();
  }

  /**
   * Pings the other side regularly and gives up on them once a visible opponent goes silent. This
   * catches a tab or connection that died without the channel ever reporting it.
   */
  startHeartbeat(isHidden: () => boolean) {
    const ping = () => this.send({ t: 'ping', hidden: isHidden() });
    this.lastSeen = Date.now();
    ping();
    this.heartbeat = setInterval(() => {
      if (isStale(this.lastSeen, Date.now(), this.remoteHidden)) {
        this.transport.close();
        this.markClosed();
        return;
      }
      ping();
    }, PING_EVERY_MS);
    // Tell the other side straight away when this tab goes to or returns from the background.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', ping);
  }

  send(msg: Msg) {
    if (!this.closed) this.transport.send(msg);
  }

  /** Attaches the game's message handler and delivers anything that arrived earlier. */
  onMessage(handler: (m: Msg) => void) {
    this.handler = handler;
    for (const m of this.buffer.splice(0)) handler(m);
  }

  onClose(handler: () => void) {
    this.closeHandler = handler;
    if (this.closed) handler();
  }

  close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.handler = null;
    this.closeHandler = null;
    this.transport.close();
  }

  /** Resolves with the next message of type `type`, consuming it. */
  private expect<T extends Msg['t']>(type: T): Promise<Extract<Msg, { t: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('對手沒有回應')), HANDSHAKE_TIMEOUT_MS);
      const waiter = (m: Msg) => {
        if (m.t !== type) return false;
        clearTimeout(timer);
        resolve(m as Extract<Msg, { t: T }>);
        return true;
      };
      const early = this.buffer.findIndex(waiter);
      if (early >= 0) {
        this.buffer.splice(early, 1);
        return;
      }
      this.waiters.push(waiter);
      const prev = this.closeHandler;
      this.closeHandler = () => {
        clearTimeout(timer);
        reject(new Error('對手已離線'));
        prev?.();
      };
    });
  }

  /** Host side: waits for the guest's hello, then decides who plays what. */
  async hostHandshake(mine: { side: Side; faction: FactionId; name: string }): Promise<MatchSetup> {
    const hello = await this.expect('hello');
    this.send({
      t: 'start',
      hostSide: mine.side,
      hostFaction: mine.faction,
      guestFaction: hello.faction,
      hostName: mine.name,
    });
    return setupFor(mine.side, mine.faction, hello.faction, mine.name, hello.name);
  }

  /** Guest side: introduces itself and waits for the host's decision. */
  async guestHandshake(faction: FactionId, name: string): Promise<MatchSetup> {
    this.send({ t: 'hello', faction, name });
    const start = await this.expect('start');
    return setupFor(opponent(start.hostSide), faction, start.hostFaction, name, start.hostName);
  }
}

/** What each player needs to start the game. */
export interface MatchSetup {
  mySide: Side;
  factions: Record<Side, FactionId>;
  /** Player names by side; empty when someone gave none. */
  names: Record<Side, string>;
}

function setupFor(mySide: Side, myFaction: FactionId, theirFaction: FactionId, myName: string, theirName: string): MatchSetup {
  const by = <T>(mine: T, theirs: T) => ({ [mySide]: mine, [opponent(mySide)]: theirs }) as Record<Side, T>;
  return { mySide, factions: by(myFaction, theirFaction), names: by(myName, theirName) };
}
