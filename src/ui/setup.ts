import { PIECE_NAMES } from '../core/notation';
import { PieceType, Side } from '../core/types';
import { AI_LEVELS, AiLevel } from '../ai/levels';
import { MasterStatus, checkMaster } from '../ai/uci';
import { cleanName, normalizeCode } from '../net/protocol';
import { FACTIONS, FACTION_BY_ID, Faction, FactionId } from '../data/factions';
import { getPortrait, portraitUrl } from '../render/portrait';
import { CharacterCard } from './characterCard';

export type FactionChoice = Record<Side, FactionId>;
export type GameMode = 'local' | 'ai' | 'online';
export type OnlineRole = 'host' | 'guest';

/** Everything chosen on the setup screen. */
export interface SetupChoice {
  factions: FactionChoice;
  mode: GameMode;
  level: AiLevel;
  /** The side the person plays in AI mode, or the host's side in a connected game. */
  human: Side;
  /** Connected games: whether this player opens the room or joins one, and the code to join. */
  role: OnlineRole;
  code: string;
  /** Shown to the opponent and in chat; empty means none. */
  name: string;
}

const STORAGE_KEY = 'xq3d.setup';
const ROLE_ORDER: PieceType[] = ['k', 'a', 'b', 'r', 'n', 'c', 'p'];

const DEFAULT_CHOICE: SetupChoice = {
  factions: { red: 'han', black: 'chu' },
  mode: 'local',
  level: 'intermediate',
  human: 'red',
  role: 'host',
  code: '',
  name: '',
};

export function loadChoice(): SetupChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && FACTION_BY_ID[saved.factions?.red as FactionId] && FACTION_BY_ID[saved.factions?.black as FactionId]) {
      return {
        factions: { red: saved.factions.red, black: saved.factions.black },
        mode: saved.mode === 'ai' || saved.mode === 'online' ? saved.mode : 'local',
        level: AI_LEVELS.some((l) => l.id === saved.level) ? saved.level : DEFAULT_CHOICE.level,
        human: saved.human === 'black' ? 'black' : 'red',
        role: saved.role === 'guest' ? 'guest' : 'host',
        code: '',
        name: typeof saved.name === 'string' ? cleanName(saved.name) : '',
      };
    }
  } catch {
    // Storage may be unavailable (private mode); fall back to the default.
  }
  return { ...DEFAULT_CHOICE, factions: { ...DEFAULT_CHOICE.factions } };
}

/** The faction this player picked: in a connected game only their own grid counts. */
export function ownFaction(choice: SetupChoice): FactionId {
  return choice.mode === 'online' && choice.role === 'host' ? choice.factions[choice.human] : choice.factions.black;
}

/** An invite link (?room=CODE) opens straight to the join form. */
function applyInvite(choice: SetupChoice): SetupChoice {
  const code = normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
  return code ? { ...choice, mode: 'online', role: 'guest', code } : choice;
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
  private choice: SetupChoice = applyInvite(loadChoice());
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
      if (l.id === 'master') {
        // Needs cross-origin isolation and the engine files; stays disabled until that is confirmed.
        btn.disabled = true;
        btn.querySelector('small')!.textContent = '檢查中…';
        void checkMaster().then((status) => this.setMaster(btn, l.blurb, status));
      }
      levels.append(btn);
    }

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
    document.querySelectorAll<HTMLButtonElement>('#role-list [data-role]').forEach((b) =>
      b.addEventListener('click', () => {
        this.choice.role = b.dataset.role as OnlineRole;
        this.renderMode();
      }),
    );
    const nameInput = document.getElementById('player-name') as HTMLInputElement;
    nameInput.addEventListener('input', () => (this.choice.name = nameInput.value));
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.canStart()) this.finish();
    });
    const input = document.getElementById('join-code') as HTMLInputElement;
    input.addEventListener('input', () => {
      this.choice.code = input.value;
      this.renderMode();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.canStart()) this.finish();
    });
  }

  /** The side whose faction this player picks; the other is left to the opponent. Null when both are ours. */
  private ownSide(): Side | null {
    if (this.choice.mode !== 'online') return null;
    // A guest does not know their side until the host decides, so any grid will do.
    return this.choice.role === 'host' ? this.choice.human : 'black';
  }

  private canStart() {
    const { mode, role, code } = this.choice;
    return mode !== 'online' || role === 'host' || normalizeCode(code) !== null;
  }

  private masterOk = false;

  private setMaster(btn: HTMLButtonElement, blurb: string, status: MasterStatus) {
    this.masterOk = status.ok;
    btn.disabled = !status.ok;
    btn.querySelector('small')!.textContent = status.ok ? blurb : '無法使用';
    btn.title = status.ok ? '' : (status.reason ?? '');
    this.renderMode();
  }

  private renderMode() {
    // A saved master choice falls back to the strongest level that works here.
    if (this.choice.level === 'master' && !this.masterOk) this.choice.level = 'advanced';
    const { mode, level, human, role } = this.choice;
    this.root.querySelectorAll<HTMLButtonElement>('.mode[data-mode]').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const show = (id: string, on: boolean) => ((document.getElementById(id) as HTMLElement).hidden = !on);
    show('ai-options', mode === 'ai' || (mode === 'online' && role === 'host'));
    show('level-group', mode === 'ai');
    show('side-group', mode === 'ai' || mode === 'online');
    show('online-options', mode === 'online');
    show('join-group', mode === 'online' && role === 'guest');
    document.querySelectorAll<HTMLButtonElement>('#role-list [data-role]').forEach((b) => {
      b.classList.toggle('on', b.dataset.role === role);
      b.setAttribute('aria-pressed', String(b.dataset.role === role));
    });
    const input = document.getElementById('join-code') as HTMLInputElement;
    if (document.activeElement !== input) input.value = this.choice.code;
    const nameInput = document.getElementById('player-name') as HTMLInputElement;
    if (document.activeElement !== nameInput) nameInput.value = this.choice.name;
    const start = document.getElementById('btn-start') as HTMLButtonElement;
    start.textContent = mode === 'online' ? (role === 'host' ? '建立房間' : '加入房間') : '開始對弈';
    start.disabled = !this.canStart();
    document.querySelectorAll<HTMLButtonElement>('#level-list [data-level]').forEach((b) => {
      b.classList.toggle('on', b.dataset.level === level);
      b.setAttribute('aria-pressed', String(b.dataset.level === level));
    });
    document.querySelectorAll<HTMLButtonElement>('#side-list [data-human]').forEach((b) => {
      b.classList.toggle('on', b.dataset.human === human);
      b.setAttribute('aria-pressed', String(b.dataset.human === human));
    });
    const own = this.ownSide();
    for (const side of ['red', 'black'] as Side[]) {
      const section = this.root.querySelector(`[data-side="${side}"]`) as HTMLElement;
      const tag =
        mode === 'ai' ? (side === human ? '（你）' : '（電腦）') : mode === 'online' ? (side === own ? '（你）' : '（對手）') : '';
      section.querySelector('h3 .who')!.textContent = tag;
      // The opponent chooses their own faction in a connected game.
      const waiting = mode === 'online' && side !== own;
      section.classList.toggle('waiting', waiting);
      (section.querySelector('.wait-note') as HTMLElement).hidden = !waiting;
    }
  }

  /** Shows the screen; `error` explains why a previous connected game could not start. */
  open(error?: string): Promise<SetupChoice> {
    const note = document.getElementById('setup-error') as HTMLElement;
    note.hidden = !error;
    note.textContent = error ?? '';
    this.renderMode();
    this.renderSide('red');
    this.renderSide('black');
    this.root.hidden = false;
    this.root.scrollTop = 0;
    document.body.classList.add('setup-open');
    return new Promise((r) => (this.resolve = r));
  }

  private finish() {
    if (!this.canStart()) return;
    this.card.hide();
    this.root.hidden = true;
    document.body.classList.remove('setup-open');
    const name = cleanName(this.choice.name);
    saveChoice({ ...this.choice, code: '', name });
    const code = normalizeCode(this.choice.code) ?? '';
    this.resolve?.({ ...this.choice, code, name, factions: { ...this.choice.factions } });
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
