import { cleanChat } from '../net/protocol';
import { PRESET_LINES, addCustom, loadCustom, removeCustom, saveCustom } from '../net/quicklines';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

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
  private readonly menu = $('#chat-menu');
  private readonly menuBtn = $<HTMLButtonElement>('#chat-menu-btn');
  private custom = loadCustom();

  constructor(private readonly onSend: (text: string) => void) {
    this.renderMenu();
    this.menuBtn.addEventListener('click', () => this.setMenu(this.menu.hidden));
    $('#chat-menu-add').addEventListener('submit', (e) => {
      e.preventDefault();
      const field = $<HTMLInputElement>('#chat-menu-input');
      this.custom = addCustom(this.custom, field.value);
      field.value = '';
      saveCustom(this.custom);
      this.renderMenu();
      // Show the new line, which is added at the end of a possibly long list.
      const list = $('#chat-menu-list');
      list.scrollTop = list.scrollHeight;
    });
    // Tapping elsewhere or pressing Esc closes the menu.
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !(e.target as HTMLElement).closest('#chat-menu, #chat-menu-btn')) this.setMenu(false);
    });
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.menu.hidden) {
        e.stopPropagation();
        this.setMenu(false);
        this.menuBtn.focus();
      }
    });
    $('#chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.send(this.input.value);
      this.input.value = '';
    });
    this.head.addEventListener('click', () => this.setExpanded(this.head.getAttribute('aria-expanded') !== 'true'));
  }

  private setMenu(open: boolean) {
    this.menu.hidden = !open;
    this.menuBtn.setAttribute('aria-expanded', String(open));
    this.menuBtn.textContent = open ? '常用語 ▾' : '常用語 ▴';
  }

  /** Presets first, then the player's own lines, which can be removed. */
  private renderMenu() {
    const list = $('#chat-menu-list');
    list.replaceChildren();
    const item = (text: string, removable: boolean) => {
      const li = document.createElement('li');
      const say = document.createElement('button');
      say.type = 'button';
      say.className = 'say';
      say.textContent = text;
      say.addEventListener('click', () => {
        this.send(text);
        this.setMenu(false);
      });
      li.append(say);
      if (removable) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'del';
        del.textContent = '×';
        del.title = '刪除這句';
        del.setAttribute('aria-label', `刪除「${text}」`);
        del.addEventListener('click', () => {
          this.custom = removeCustom(this.custom, text);
          saveCustom(this.custom);
          this.renderMenu();
        });
        li.append(del);
      }
      list.append(li);
    };
    for (const line of PRESET_LINES) item(line, false);
    for (const line of this.custom) item(line, true);
  }

  /** Shows an empty panel for a new connected game. Starts collapsed on small screens. */
  open() {
    this.setMenu(false);
    this.log.innerHTML = '';
    this.unread = 0;
    this.renderUnread();
    this.input.disabled = false;
    this.menuBtn.disabled = false;
    this.panel.hidden = false;
    this.setExpanded(!matchMedia('(max-width: 760px)').matches);
  }

  close() {
    this.setMenu(false);
    this.panel.hidden = true;
    this.log.innerHTML = '';
    document.getElementById('chat-bubble')?.remove();
  }

  /** The other player left: keep the log, stop sending. */
  disable() {
    this.input.disabled = true;
    this.menuBtn.disabled = true;
    this.setMenu(false);
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
