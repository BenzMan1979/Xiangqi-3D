import { describe, expect, it } from 'vitest';
import { DEFAULT_ICE_SERVERS, iceServers, parseIceServers } from './ice';

describe('ICE servers', () => {
  it('uses the defaults when nothing valid is configured', () => {
    expect(iceServers(undefined)).toBe(DEFAULT_ICE_SERVERS);
    expect(iceServers('')).toBe(DEFAULT_ICE_SERVERS);
    expect(iceServers('not json')).toBe(DEFAULT_ICE_SERVERS);
    expect(iceServers('{"urls":"turn:x"}')).toBe(DEFAULT_ICE_SERVERS); // must be an array
    expect(iceServers('[{"urls":"http://example.com"}]')).toBe(DEFAULT_ICE_SERVERS);
    expect(iceServers('[]')).toBe(DEFAULT_ICE_SERVERS);
  });

  it('accepts a custom list', () => {
    const raw = JSON.stringify([
      { urls: 'stun:stun.example.com:3478' },
      { urls: ['turn:t.example.com:443?transport=tcp', 'turns:t.example.com:443'], username: 'u', credential: 'c' },
    ]);
    expect(parseIceServers(raw)).toHaveLength(2);
    expect(iceServers(raw)).toEqual(JSON.parse(raw));
  });

  it('includes a relay that works over TCP/TLS 443 in the defaults', () => {
    const urls = DEFAULT_ICE_SERVERS.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
    expect(urls.some((u) => u.startsWith('turns:') && u.includes(':443'))).toBe(true);
  });
});
