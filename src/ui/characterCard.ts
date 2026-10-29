import { PIECE_NAMES } from '../core/notation';
import { PieceType, Side } from '../core/types';
import { Character, Faction, ROLE_NAMES, isTroop } from '../data/factions';
import { getPortrait, portraitUrl } from '../render/portrait';

export interface CardSubject {
  character: Character;
  faction: Faction;
  role: PieceType;
  side: Side | null;
}

const SIDE_TEXT: Record<Side, string> = { red: '紅方', black: '黑方' };

/** Floating profile card: portrait, short biography and signature move. */
export class CharacterCard {
  private readonly el: HTMLElement;
  private current: string | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'char-card';
    this.el.setAttribute('role', 'tooltip');
    document.body.append(this.el);
  }

  get visible() {
    return this.current !== null;
  }

  /** Shows the card next to a screen point, or as a bottom sheet when `at` is omitted. */
  show(subject: CardSubject, at?: { x: number; y: number }) {
    const key = `${subject.faction.id}:${subject.character.id}:${subject.side}`;
    if (key !== this.current) {
      this.render(subject);
      this.current = key;
    }
    this.el.classList.toggle('sheet', !at);
    this.el.classList.add('show');
    if (at) this.moveTo(at);
    else this.el.style.left = this.el.style.top = '';
  }

  moveTo(at: { x: number; y: number }) {
    if (this.el.classList.contains('sheet')) return;
    const pad = 16;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = at.x + 20;
    let y = at.y + 20;
    if (x + w > window.innerWidth - pad) x = at.x - w - 20;
    if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
    this.el.style.left = `${Math.max(pad, x)}px`;
    this.el.style.top = `${Math.max(pad, y)}px`;
  }

  hide() {
    this.el.classList.remove('show');
    this.current = null;
  }

  private render({ character: ch, faction, role, side }: CardSubject) {
    const troop = isTroop(faction, ch);
    const roleText = side ? PIECE_NAMES[side][role] : ROLE_NAMES[role];
    const note =
      role === 'k'
        ? '將死敵方將帥時發動；勝利結算時由主帥再次施展'
        : '將死敵方將帥時發動';

    this.el.innerHTML = '';
    this.el.style.setProperty('--faction', faction.color);

    const img = document.createElement('img');
    img.className = 'cc-portrait';
    img.alt = '';
    img.src = portraitUrl(getPortrait(ch, faction, role, side));

    const body = document.createElement('div');
    body.className = 'cc-body';
    body.append(
      el('div', 'cc-head', [el('span', 'cc-name', ch.name), ch.courtesy ? el('span', 'cc-courtesy', `字${ch.courtesy}`) : '']),
      el('div', 'cc-meta', [
        el('span', 'cc-faction', faction.name),
        `${faction.fullName} · ${roleText}${side ? ` · ${SIDE_TEXT[side]}` : ''}${troop ? ' · 五兵共用' : ''}`,
      ]),
      el('div', 'cc-epithet', `「${ch.epithet}」`),
      el('p', 'cc-bio', ch.bio),
      el('div', 'cc-skill', [
        el('div', 'cc-skill-label', '絕招'),
        el('div', 'cc-skill-name', ch.skill.name),
        el('p', 'cc-skill-desc', ch.skill.desc),
        el('p', 'cc-note', note),
      ]),
    );
    if (ch.legendary) body.append(el('p', 'cc-legend', '※ 民間傳說人物'));
    this.el.append(img, body);
  }
}

function el(tag: string, className: string, content: string | (Node | string)[]) {
  const node = document.createElement(tag);
  node.className = className;
  if (typeof content === 'string') node.textContent = content;
  else node.append(...content);
  return node;
}
