import { PIECE_NAMES } from '../core/notation';
import { PieceType, Side } from '../core/types';
import { FACTIONS, FACTION_BY_ID, Faction, FactionId } from '../data/factions';
import { getPortrait, portraitUrl } from '../render/portrait';
import { CharacterCard } from './characterCard';

export type FactionChoice = Record<Side, FactionId>;

const STORAGE_KEY = 'xq3d.factions';
const ROLE_ORDER: PieceType[] = ['k', 'a', 'b', 'r', 'n', 'c', 'p'];

export function loadChoice(): FactionChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && FACTION_BY_ID[saved.red as FactionId] && FACTION_BY_ID[saved.black as FactionId]) return saved;
  } catch {
    // Storage may be unavailable (private mode); fall back to the default.
  }
  return { red: 'han', black: 'chu' };
}

function saveChoice(choice: FactionChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Not critical.
  }
}

/** Pre-game screen where each side picks a faction. */
export class SetupScreen {
  private readonly root = document.getElementById('setup')!;
  private choice: FactionChoice = loadChoice();
  private resolve: ((c: FactionChoice) => void) | null = null;

  constructor(private readonly card: CharacterCard) {
    for (const side of ['red', 'black'] as Side[]) {
      const grid = this.root.querySelector(`[data-side="${side}"] .faction-grid`)!;
      for (const f of FACTIONS) {
        const btn = document.createElement('button');
        btn.className = 'faction-tile';
        btn.dataset.faction = f.id;
        btn.style.setProperty('--faction', f.color);
        btn.innerHTML = `<span class="badge">${f.name}</span><span class="leader">${f.roster.k.name}</span>`;
        btn.addEventListener('click', () => {
          this.choice[side] = f.id;
          this.renderSide(side);
        });
        grid.append(btn);
      }
    }
    document.getElementById('btn-start')!.addEventListener('click', () => this.finish());
    this.root.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('.roster-name')) this.card.hide();
    });
  }

  open(): Promise<FactionChoice> {
    this.renderSide('red');
    this.renderSide('black');
    this.root.hidden = false;
    this.root.scrollTop = 0;
    document.body.classList.add('setup-open');
    return new Promise((r) => (this.resolve = r));
  }

  private finish() {
    this.card.hide();
    this.root.hidden = true;
    document.body.classList.remove('setup-open');
    saveChoice(this.choice);
    this.resolve?.({ ...this.choice });
    this.resolve = null;
  }

  private renderSide(side: Side) {
    const section = this.root.querySelector(`[data-side="${side}"]`)!;
    const faction = FACTION_BY_ID[this.choice[side]];
    section.querySelectorAll<HTMLButtonElement>('.faction-tile').forEach((b) => {
      const on = b.dataset.faction === faction.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const preview = section.querySelector('.faction-preview')!;
    preview.innerHTML = '';
    (preview as HTMLElement).style.setProperty('--faction', faction.color);

    const leader = document.createElement('img');
    leader.className = 'leader-portrait';
    leader.alt = faction.roster.k.name;
    leader.src = portraitUrl(getPortrait(faction.roster.k, faction, 'k', side));

    const info = document.createElement('div');
    info.className = 'preview-info';
    info.innerHTML = `<div class="preview-title">${faction.fullName}<span>主帥 ${faction.roster.k.name}</span></div>
      <div class="preview-motto">「${faction.motto}」</div>`;

    const roster = document.createElement('div');
    roster.className = 'roster';
    for (const role of ROLE_ORDER) {
      const row = document.createElement('div');
      row.className = 'roster-row';
      const label = document.createElement('span');
      label.className = `roster-role ${side}`;
      label.textContent = PIECE_NAMES[side][role];
      row.append(label);
      const slot = faction.roster[role];
      for (const ch of Array.isArray(slot) ? slot : [slot]) {
        const name = document.createElement('button');
        name.className = 'roster-name';
        name.textContent = ch.name;
        this.bindCard(name, faction, role, side, ch);
        row.append(name);
      }
      roster.append(row);
    }
    info.append(roster);
    preview.append(leader, info);
  }

  private bindCard(target: HTMLElement, faction: Faction, role: PieceType, side: Side, character: Faction['roster']['k']) {
    const subject = { character, faction, role, side };
    target.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') this.card.show(subject, { x: e.clientX, y: e.clientY });
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.card.moveTo({ x: e.clientX, y: e.clientY });
    });
    target.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.card.hide();
    });
    // Touch and keyboard: open as a bottom sheet.
    target.addEventListener('click', () => {
      if (!this.card.visible || matchMedia('(hover: none)').matches) this.card.show(subject);
    });
  }
}
