import { PIECE_NAMES } from '../core/notation';
import { PieceType, Side } from '../core/types';
import { AI_LEVELS, AiLevel } from '../ai/levels';
import { FACTIONS, FACTION_BY_ID, Faction, FactionId } from '../data/factions';
import { getPortrait, portraitUrl } from '../render/portrait';
import { CharacterCard } from './characterCard';

export type FactionChoice = Record<Side, FactionId>;
export type GameMode = 'local' | 'ai';

/** Everything chosen on the setup screen. */
export interface SetupChoice {
  factions: FactionChoice;
  mode: GameMode;
  level: AiLevel;
  /** The side the person plays in AI mode. */
  human: Side;
}

const STORAGE_KEY = 'xq3d.setup';
const ROLE_ORDER: PieceType[] = ['k', 'a', 'b', 'r', 'n', 'c', 'p'];

const DEFAULT_CHOICE: SetupChoice = {
  factions: { red: 'han', black: 'chu' },
  mode: 'local',
  level: 'intermediate',
  human: 'red',
};

export function loadChoice(): SetupChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && FACTION_BY_ID[saved.factions?.red as FactionId] && FACTION_BY_ID[saved.factions?.black as FactionId]) {
      return {
        factions: { red: saved.factions.red, black: saved.factions.black },
        mode: saved.mode === 'ai' ? 'ai' : 'local',
        level: AI_LEVELS.some((l) => l.id === saved.level) ? saved.level : DEFAULT_CHOICE.level,
        human: saved.human === 'black' ? 'black' : 'red',
      };
    }
  } catch {
    // Storage may be unavailable (private mode); fall back to the default.
  }
  return { ...DEFAULT_CHOICE, factions: { ...DEFAULT_CHOICE.factions } };
}

function saveChoice(choice: SetupChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Not critical.
  }
}

/** Pre-game screen where each side picks a faction. */
export class SetupScreen {
  private readonly root = document.getElementById('setup')!;
  private choice: SetupChoice = loadChoice();
  private resolve: ((c: SetupChoice) => void) | null = null;

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
          this.choice.factions[side] = f.id;
          this.renderSide(side);
        });
        grid.append(btn);
      }
    }
    this.buildModeControls();
    document.getElementById('btn-start')!.addEventListener('click', () => this.finish());
    this.root.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('.roster-name')) this.card.hide();
    });
  }

  private buildModeControls() {
    const levels = document.getElementById('level-list')!;
    for (const l of AI_LEVELS) {
      const btn = document.createElement('button');
      btn.className = 'level';
      btn.dataset.level = l.id;
      btn.innerHTML = `<b>${l.name}</b><small>${l.blurb}</small>`;
      levels.append(btn);
    }
    const master = document.createElement('button');
    master.className = 'level';
    master.disabled = true;
    master.innerHTML = '<b>大師</b><small>即將推出</small>';
    levels.append(master);

    this.root.querySelectorAll<HTMLButtonElement>('.mode[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        this.choice.mode = b.dataset.mode as GameMode;
        this.renderMode();
      }),
    );
    levels.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) =>
      b.addEventListener('click', () => {
        this.choice.level = b.dataset.level as AiLevel;
        this.renderMode();
      }),
    );
    document.querySelectorAll<HTMLButtonElement>('#side-list [data-human]').forEach((b) =>
      b.addEventListener('click', () => {
        this.choice.human = b.dataset.human as Side;
        this.renderMode();
      }),
    );
  }

  private renderMode() {
    const { mode, level, human } = this.choice;
    this.root.querySelectorAll<HTMLButtonElement>('.mode[data-mode]').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    (document.getElementById('ai-options') as HTMLElement).hidden = mode !== 'ai';
    document.querySelectorAll<HTMLButtonElement>('#level-list [data-level]').forEach((b) => {
      b.classList.toggle('on', b.dataset.level === level);
      b.setAttribute('aria-pressed', String(b.dataset.level === level));
    });
    document.querySelectorAll<HTMLButtonElement>('#side-list [data-human]').forEach((b) => {
      b.classList.toggle('on', b.dataset.human === human);
      b.setAttribute('aria-pressed', String(b.dataset.human === human));
    });
    for (const side of ['red', 'black'] as Side[]) {
      const tag = mode === 'ai' ? (side === human ? '（你）' : '（電腦）') : '';
      this.root.querySelector(`[data-side="${side}"] h3 .who`)!.textContent = tag;
    }
  }

  open(): Promise<SetupChoice> {
    this.renderMode();
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
    this.resolve?.({ ...this.choice, factions: { ...this.choice.factions } });
    this.resolve = null;
  }

  private renderSide(side: Side) {
    const section = this.root.querySelector(`[data-side="${side}"]`)!;
    const faction = FACTION_BY_ID[this.choice.factions[side]];
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
