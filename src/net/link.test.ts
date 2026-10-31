import { describe, expect, it } from 'vitest';
import { Link, Transport } from './link';
import { CHAT_MAX, Msg, cleanChat, inviteLink, makeRoomCode, normalizeCode, parseMsg, peerIdFor } from './protocol';

/** Two in-memory transports wired back to back; delivery is asynchronous like a real channel. */
function pair(): [Transport, Transport] {
  const make = (): Transport => ({ send: () => {}, close: () => {}, onData: null, onClose: null });
  const a = make();
  const b = make();
  const wire = (from: Transport, to: Transport) => {
    from.send = (data) => void Promise.resolve().then(() => to.onData?.(structuredClone(data)));
    from.close = () => void Promise.resolve().then(() => to.onClose?.());
  };
  wire(a, b);
  wire(b, a);
  return [a, b];
}

describe('protocol', () => {
  it('accepts well-formed messages and rejects malformed ones', () => {
    const ok: Msg[] = [
      { t: 'hello', faction: 'shu' },
      { t: 'start', hostSide: 'red', hostFaction: 'han', guestFaction: 'chu' },
      { t: 'move', from: 0, to: 89, n: 3 },
      { t: 'resign' },
      { t: 'undo-request', plies: 2, n: 5 },
      { t: 'undo-reply', ok: false },
      { t: 'chat', text: '承讓承讓' },
    ];
    for (const m of ok) expect(parseMsg(m)).toEqual(m);

    for (const bad of [
      null,
      'move',
      { t: 'move', from: -1, to: 5, n: 1 },
      { t: 'move', from: 0, to: 90, n: 1 },
      { t: 'move', from: 0.5, to: 5, n: 1 },
      { t: 'move', from: 0, to: 5, n: 0 },
      { t: 'hello', faction: 'nope' },
      { t: 'start', hostSide: 'green', hostFaction: 'han', guestFaction: 'chu' },
      { t: 'undo-request', plies: 3, n: 5 },
      { t: 'undo-request', plies: 2, n: 1 },
      { t: 'undo-request', plies: 1 },
      { t: 'undo-reply' },
      { t: 'unknown' },
      { t: 'chat' },
      { t: 'chat', text: 42 },
      { t: 'chat', text: '  \n\t ' },
    ]) {
      expect(parseMsg(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('cleans chat text: control characters, whitespace and length', () => {
    expect(cleanChat('  你\n好\u0007   嗎 ')).toBe('你 好 嗎');
    expect(cleanChat('x'.repeat(500))).toHaveLength(CHAT_MAX);
    expect(parseMsg({ t: 'chat', text: '<img src=x onerror=alert(1)>' })).toEqual({ t: 'chat', text: '<img src=x onerror=alert(1)>' });
  });

  it('makes and normalizes room codes', () => {
    const code = makeRoomCode(() => 0.5);
    expect(code).toHaveLength(5);
    expect(normalizeCode(code)).toBe(code);
    expect(normalizeCode(' ab-cd 2 ')).toBe('ABCD2');
    expect(normalizeCode('ABCD')).toBeNull();
    expect(normalizeCode('ABCD0')).toBeNull(); // 0 is not in the alphabet
    expect(peerIdFor('ABCD2')).toBe('xq3d-ABCD2');
  });

  it('builds invite links that keep the path but drop other parameters', () => {
    expect(inviteLink('K7Q2M', 'https://example.github.io/Xiangqi-3D/?debug&x=1#top')).toBe(
      'https://example.github.io/Xiangqi-3D/?room=K7Q2M',
    );
  });
});

describe('handshake', () => {
  it('tells both players who plays which side with which faction', async () => {
    const [h, g] = pair();
    const host = new Link(h);
    const guest = new Link(g);
    const [hostSetup, guestSetup] = await Promise.all([
      host.hostHandshake({ side: 'black', faction: 'wei' }),
      guest.guestHandshake('wu'),
    ]);
    expect(hostSetup).toEqual({ mySide: 'black', factions: { black: 'wei', red: 'wu' } });
    expect(guestSetup).toEqual({ mySide: 'red', factions: { red: 'wu', black: 'wei' } });
  });

  it('keeps messages that arrive before the game attaches its handler', async () => {
    const [h, g] = pair();
    const host = new Link(h);
    const guest = new Link(g);
    await Promise.all([host.hostHandshake({ side: 'red', faction: 'han' }), guest.guestHandshake('chu')]);
    guest.send({ t: 'move', from: 10, to: 19, n: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const seen: Msg[] = [];
    host.onMessage((m) => seen.push(m));
    expect(seen).toEqual([{ t: 'move', from: 10, to: 19, n: 1 }]);
  });

  it('fails the handshake when the other side disconnects', async () => {
    const [h, g] = pair();
    const host = new Link(h);
    const pending = host.hostHandshake({ side: 'red', faction: 'han' });
    g.close();
    await expect(pending).rejects.toThrow('離線');
  });

  it('ignores garbage on the channel', async () => {
    const [h, g] = pair();
    const host = new Link(h);
    const pending = host.hostHandshake({ side: 'red', faction: 'han' });
    g.send({ t: 'move', from: 'x' });
    g.send('hello');
    g.send({ t: 'hello', faction: 'tang' });
    await expect(pending).resolves.toEqual({ mySide: 'red', factions: { red: 'han', black: 'tang' } });
  });
});
