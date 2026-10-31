import type { DataConnection, Peer, PeerOptions } from 'peerjs';
import { Transport } from './link';
import { makeRoomCode, peerIdFor } from './protocol';

/** Free public signalling server by default; `?peerserver=host:port` points at another (testing). */
function peerOptions(): PeerOptions {
  const custom = new URLSearchParams(location.search).get('peerserver');
  if (!custom) return {};
  const [host, port] = custom.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false };
}

async function createPeer(id?: string): Promise<Peer> {
  // Loaded on demand: only connected games need the library.
  const { Peer } = await import('peerjs');
  return id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
}

function wrap(conn: DataConnection, cleanup: () => void): Transport {
  const t: Transport = {
    send: (data) => conn.send(data),
    close: () => {
      conn.close();
      cleanup();
    },
    onData: null,
    onClose: null,
  };
  conn.on('data', (d) => t.onData?.(d));
  conn.on('close', () => {
    t.onClose?.();
    cleanup();
  });
  conn.on('error', () => t.onClose?.());
  return t;
}

const SERVICE_ERRORS = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible', 'ssl-unavailable']);
const serviceMessage = '無法連上連線服務，請檢查網路後再試';

export interface Room {
  code: string;
  /** Stops waiting for a guest and frees the room code. */
  close(): void;
}

/** Opens a room under a fresh code; `onGuest` receives the first player who joins. */
export async function hostRoom(onGuest: (t: Transport) => void): Promise<Room> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeRoomCode();
    const peer = await createPeer(peerIdFor(code));
    const opened = await new Promise<'open' | 'taken'>((resolve, reject) => {
      peer.on('open', () => resolve('open'));
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') resolve('taken');
        else reject(new Error(SERVICE_ERRORS.has(err.type) ? serviceMessage : err.message));
      });
    }).catch((e) => {
      peer.destroy();
      throw e;
    });
    if (opened === 'taken') {
      peer.destroy();
      continue;
    }

    let taken = false;
    peer.on('connection', (conn) => {
      if (taken) {
        // A second visitor: the room is for two.
        conn.on('open', () => conn.close());
        return;
      }
      taken = true;
      conn.on('open', () => onGuest(wrap(conn, () => peer.destroy())));
    });
    return { code, close: () => peer.destroy() };
  }
  throw new Error('無法建立房間，請再試一次');
}

const JOIN_TIMEOUT_MS = 20000;

/** Connects to the room with `code`. */
export async function joinRoom(code: string): Promise<Transport> {
  const peer = await createPeer();
  try {
    return await new Promise<Transport>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('連線逾時，請確認房號並再試一次')), JOIN_TIMEOUT_MS);
      const fail = (message: string) => {
        clearTimeout(timer);
        reject(new Error(message));
      };
      peer.on('error', (err) => fail(err.type === 'peer-unavailable' ? '找不到這個房間' : SERVICE_ERRORS.has(err.type) ? serviceMessage : err.message));
      peer.on('open', () => {
        const conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          clearTimeout(timer);
          resolve(wrap(conn, () => peer.destroy()));
        });
        conn.on('error', (err) => fail(err.message));
      });
    });
  } catch (err) {
    peer.destroy();
    throw err;
  }
}
