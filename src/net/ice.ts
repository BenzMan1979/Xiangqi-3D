/**
 * Servers that help two browsers reach each other. STUN only discovers a player's public address,
 * which is not enough behind many mobile or office networks; TURN relays the traffic instead (the
 * data channel is still end-to-end encrypted, so the relay cannot read moves or chat).
 *
 * The defaults are free public services and may be slow or go away. For reliable play, set the
 * `VITE_ICE_SERVERS` build variable to a JSON array of your own servers (see README).
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
  // PeerJS's own relay.
  {
    urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
    username: 'peerjs',
    credential: 'peerjsp',
  },
  // Open Relay: UDP, plus TCP and TLS on 80/443, which firewalls that block 3478 usually let through.
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const isServer = (v: unknown): v is RTCIceServer => {
  if (typeof v !== 'object' || v === null) return false;
  const urls = (v as { urls?: unknown }).urls;
  const ok = (u: unknown) => typeof u === 'string' && /^(stun|stuns|turn|turns):/.test(u);
  return Array.isArray(urls) ? urls.length > 0 && urls.every(ok) : ok(urls);
};

/** Parses a JSON array of ICE servers; null when it is absent or malformed. */
export function parseIceServers(raw: string | undefined): RTCIceServer[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isServer) ? parsed : null;
  } catch {
    return null;
  }
}

/** Custom servers from the build, if valid, otherwise the defaults. */
export const iceServers = (custom?: string): RTCIceServer[] => parseIceServers(custom) ?? DEFAULT_ICE_SERVERS;
