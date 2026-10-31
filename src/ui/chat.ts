import { cleanChat } from '../net/protocol';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** A few lines for people who would rather tap than type. */
const QUICK_LINES = ['承讓承讓', '這步有點意思', '再想想？', '我的炮可不是擺設', '勝負未定，別急'];

const BUBBLE_MS = 4500;
const MIN_GAP_MS = 400;

type Kind = 'me' | 'them' | 'system';

/** The chat panel of a connected game: a log, quick lines, and bubbles for new messages. */
export class Chat {
  private readonly panel = $('#chat');
  private readonly head = $<HTMLButtonElement>('#chat-head');
  private readonly log = $<HTMLOListElement>('#chat-log');
  private readonly input = $<HTMLInputElement>('#chat-input');
  private readonly unreadBadge = $('#chat-unread');
  private unread = 0;
  private lastSent = 0;
  private bubbleTimer = 0;

  constructor(private readonly onSend: (text: string) => void) {
    for (const line of QUICK_LINES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = line;
      btn.addEventListener('click', () => this.send(line));
      $('#chat-quick').append(btn);
    }
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.send(this.input.value);
      this.input.value = '';
    });
    this.head.addEventListener('click', () => this.setExpanded(this.head.getAttribute('aria-expanded') !== 'true'));
  }

  /** Shows an empty panel for a new connected game. Starts collapsed on small screens. */
  open() {
    this.log.innerHTML = '';
    this.unread = 0;
    this.renderUnread();
    this.input.disabled = false;
    this.panel.hidden = false;
    this.setExpanded(!matchMedia('(max-width: 760px)').matches);
  }

  close() {
    this.panel.hidden = true;
    this.log.innerHTML = '';
    document.getElementById('chat-bubble')?.remove();
  }

  /** The other player left: keep the log, stop sending. */
  disable() {
    this.input.disabled = true;
  }

  add(kind: Kind, text: string, name = '') {
    const li = document.createElement('li');
    li.className = `chat-${kind}`;
    if (kind !== 'system') {
      const who = document.createElement('b');
      who.textContent = name;
      li.append(who, ' ');
    }
    // Always text: whatever the other player sends is never interpreted as markup.
    li.append(document.createTextNode(text));
    this.log.append(li);
    while (this.log.children.length > 80) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;

    if (kind === 'them') {
      if (this.head.getAttribute('aria-expanded') !== 'true') {
        this.unread++;
        this.renderUnread();
      }
      this.bubble(name, text);
    }
  }

  private send(raw: string) {
    const text = cleanChat(raw);
    const now = performance.now();
    if (!text || this.input.disabled || now - this.lastSent < MIN_GAP_MS) return;
    this.lastSent = now;
    this.onSend(text);
  }

  private setExpanded(on: boolean) {
    this.head.setAttribute('aria-expanded', String(on));
    this.panel.classList.toggle('collapsed', !on);
    if (on) {
      this.unread = 0;
      this.renderUnread();
      this.log.scrollTop = this.log.scrollHeight;
    }
  }

  private renderUnread() {
    this.unreadBadge.hidden = this.unread === 0;
    this.unreadBadge.textContent = String(this.unread);
  }

  /** A short-lived speech bubble, so a message is noticed even while watching the board. */
  private bubble(name: string, text: string) {
    let el = document.getElementById('chat-bubble');
    if (!el) {
      el = document.createElement('div');
      el.id = 'chat-bubble';
      document.body.append(el);
    }
    el.replaceChildren();
    const who = document.createElement('b');
    who.textContent = name;
    el.append(who, ' ', document.createTextNode(text));
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => el!.classList.remove('show'), BUBBLE_MS);
  }
}
