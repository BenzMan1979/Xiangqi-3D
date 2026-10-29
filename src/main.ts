import * as THREE from 'three';
import { AiPlayer } from './ai/player';
import { AiLevel, LEVEL_BY_ID } from './ai/levels';
import { audio } from './audio/audio';
import { Game } from './core/game';
import { findKing } from './core/rules';
import { Side, Square, opponent } from './core/types';
import { FACTIONS, FACTION_BY_ID, Faction, characterFor } from './data/factions';
import { BoardView, PickResult, squareToWorld } from './render/boardView';
import { Stage } from './render/stage';
import { PIECE_FONT } from './render/textures';
import { clock } from './render/tween';
import { CharacterCard } from './ui/characterCard';
import { Hud, SIDE_NAMES } from './ui/hud';
import { Settings, SettingsPanel, loadSettings } from './ui/settings';
import { FactionChoice, GameMode, SetupChoice, SetupScreen, loadChoice } from './ui/setup';
import './style.css';

const HOVER_DELAY_MS = 300;
const LONG_PRESS_MS = 450;

/** Game controller: setup → input → rules → animation → HUD, with an optional computer opponent. */
class App {
  private game = new Game();
  private factions: Record<Side, Faction>;
  private readonly stage: Stage;
  private readonly view: BoardView;
  private readonly hud: Hud;
  private readonly card = new CharacterCard();
  private readonly setup: SetupScreen;
  private readonly settingsPanel: SettingsPanel;
  private settings: Settings = loadSettings();
  private selected: Square | null = null;
  private busy = false;
  private mode: GameMode = 'local';
  private level: AiLevel = 'intermediate';
  private human: Side = 'red';
  private readonly ai = new AiPlayer();
  private thinking = false;
  /** Identifies the live search, so a result that arrives after undo/new game/resign is ignored. */
  private aiToken = 0;

  constructor() {
    this.stage = new Stage(document.getElementById('stage')!);
    this.view = new BoardView(this.stage);
    this.hud = new Hud({
      newGame: () => void this.chooseAndStart(),
      undo: () => this.undo(),
      flipView: () => this.flipView(),
      toggleViewMode: () => this.toggleViewMode(),
      openSettings: () => this.settingsPanel.open(),
      resign: () => this.resign(),
    });
    this.settingsPanel = new SettingsPanel(this.settings, (s) => this.applySettings(s));
    this.applySettings(this.settings);
    this.view.onSfx = (name) => audio.play(name);
    this.setup = new SetupScreen(this.card);
    this.factions = this.resolveFactions(loadChoice().factions);
    this.bindPointer();
    this.startGame(this.factions);
    if (new URLSearchParams(location.search).has('debug')) this.exposeDebugHooks();
  }

  /** Lets browser automation find the screen position of a board point. */
  private exposeDebugHooks() {
    Object.assign(window, {
      __project: (x: number, y: number) => {
        const p = squareToWorld(y * 9 + x).project(this.stage.camera);
        const canvas = this.stage.renderer.domElement;
        return { x: ((p.x + 1) / 2) * canvas.clientWidth, y: ((1 - p.y) / 2) * canvas.clientHeight };
      },
      __game: () => this.game,
      __view: () => this.view,
      __pick: (x: number, y: number) => {
        const canvas = this.stage.renderer.domElement;
        const hit = this.view.pick(new THREE.Vector2((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1));
        return { ...hit, resolved: this.resolve(hit), selected: this.selected, busy: this.busy };
      },
      /** Starts a position from FEN, e.g. to stage a specific capture. */
      __load: (fen: string) => {
        this.game = new Game(fen);
        this.selected = null;
        this.view.setBoard(this.game.board, this.factions);
        this.refresh();
      },
    });
  }

  private applySettings(s: Settings) {
    this.settings = s;
    audio.setVolumes(s.music, s.sfx);
    this.view.effects.level = s.fx;
    this.view.setShowCards(s.cards);
  }

  private resolveFactions(choice: FactionChoice): Record<Side, Faction> {
    return { red: FACTION_BY_ID[choice.red], black: FACTION_BY_ID[choice.black] };
  }

  /** "蜀軍", or "紅方蜀軍" in a mirror match. */
  private label(side: Side) {
    const f = this.factions[side];
    const mirror = this.factions.red.id === this.factions.black.id;
    return `${mirror ? SIDE_NAMES[side] : ''}${f.name}軍`;
  }

  async chooseAndStart() {
    if (this.busy) return;
    this.card.hide();
    this.hud.hideResult();
    audio.playMusic('menu');
    const choice = await this.setup.open();
    this.startGame(this.resolveFactions(choice.factions), choice);
    audio.playMusic('battle', choice.factions.red);
  }

  /** True when the person at the screen may move now (always, in two-player mode). */
  private get humanTurn() {
    return this.mode === 'local' || this.game.turn === this.human;
  }

  private stopAi() {
    this.ai.cancel();
    this.thinking = false;
    this.aiToken++;
  }

  private startGame(factions: Record<Side, Faction>, choice?: SetupChoice) {
    this.stopAi();
    this.factions = factions;
    if (choice) {
      this.mode = choice.mode;
      this.level = choice.level;
      this.human = choice.human;
    }
    this.game = new Game();
    this.selected = null;
    this.hud.hideResult();
    const names = `${factions.red.fullName} 對 ${factions.black.fullName}`;
    this.hud.setMatchup(this.mode === 'ai' ? `AI 對戰（${LEVEL_BY_ID[this.level].name}）· ${names}` : `單機雙人 · ${names}`);
    this.view.setBoard(this.game.board, factions);
    this.refresh();
    const facing = this.mode === 'ai' ? this.human : 'red';
    if (this.stage.side !== facing) void this.turnViewTo(facing);
    this.maybeAiTurn();
  }

  /** If it is the computer's turn, searches and plays its move. */
  private maybeAiTurn() {
    if (this.mode !== 'ai' || this.game.isOver || this.humanTurn || this.thinking || this.busy) return;
    void this.aiTurn();
  }

  private async aiTurn() {
    const game = this.game;
    const token = ++this.aiToken;
    this.thinking = true;
    this.selected = null;
    this.view.select(null);
    this.refresh();
    const move = await this.ai.think(game, this.level);
    // Dropped if the game was restarted, undone or resigned while the computer was thinking.
    if (token !== this.aiToken || game !== this.game || game.isOver) return;
    this.thinking = false;
    if (!move) {
      this.refresh();
      return;
    }
    await this.play(move.from, move.to);
  }

  private refresh() {
    const inCheck = !this.game.isOver && this.game.inCheck();
    this.hud.setTurn(this.game.turn, inCheck, this.label(this.game.turn), this.thinking);
    this.hud.setHistory(this.game.history);
    this.view.setLastMove(this.game.lastMove);
    this.view.setCheck(inCheck ? findKing(this.game.board, this.game.turn) : null);
    this.view.overlay.setDanger(inCheck);
    audio.setTension(inCheck);
  }

  private showResult() {
    const { status } = this.game;
    audio.play(status.state === 'over' && status.winner ? 'victory' : 'gong');
    this.hud.showResult(status, (side) => this.label(side));
  }

  private async play(from: Square, to: Square) {
    const entry = this.game.move(from, to);
    if (!entry) return;
    this.busy = true;
    this.selected = null;
    this.card.hide();
    await this.view.animateMove(entry);
    this.refresh();
    if (this.game.isOver) {
      this.showResult();
    } else {
      if (entry.givesCheck) {
        this.hud.flash('將軍！', 'check');
        audio.play('check');
        this.stage.kick(0.1);
      }
      if (this.settings.autoFlip && this.mode === 'local') await this.turnViewTo(this.game.turn);
    }
    this.busy = false;
    this.maybeAiTurn();
  }

  private async undo() {
    if (this.busy) return;
    const game = this.game;
    // Against the computer, take back to the person's own turn (their move and the reply).
    const wasThinking = this.thinking;
    this.stopAi();
    const entries = [];
    do {
      const entry = game.undo();
      if (!entry) break;
      entries.push(entry);
    } while (this.mode === 'ai' && !this.humanTurn);
    if (entries.length === 0) {
      if (wasThinking) this.maybeAiTurn();
      return;
    }
    this.busy = true;
    this.hud.hideResult();
    this.selected = null;
    this.view.select(null);
    for (const entry of entries) await this.view.animateUndo(entry);
    this.refresh();
    if (this.settings.autoFlip && this.mode === 'local') await this.turnViewTo(game.turn);
    this.busy = false;
    this.maybeAiTurn();
  }

  private resign() {
    if (this.busy || this.game.isOver) return;
    const side = this.mode === 'ai' ? this.human : this.game.turn;
    if (!confirm(`${this.label(side)}確定要認輸嗎？`)) return;
    this.stopAi();
    this.game.resign(side);
    this.refresh();
    this.showResult();
  }

  private flipView() {
    void this.turnViewTo(opponent(this.stage.side));
  }

  private async turnViewTo(side: Side) {
    if (side === this.stage.side) return;
    await Promise.all([this.stage.setView(side), this.view.setFacing(side)]);
  }

  private toggleViewMode() {
    const mode = this.stage.mode === '3d' ? 'top' : '3d';
    this.hud.setViewMode(mode);
    void this.stage.setView(this.stage.side, mode);
  }

  private onSquareClicked(s: Square | null) {
    if (this.busy || this.game.isOver || !this.humanTurn) return;
    const piece = s === null ? null : this.game.board[s];

    if (s !== null && piece?.side === this.game.turn) {
      if (this.selected === s) {
        this.selected = null;
        this.view.select(null);
      } else {
        this.selected = s;
        this.view.select(s, this.game.board, this.game.legalMovesFrom(s));
        audio.play('pick');
      }
      return;
    }
    if (this.selected !== null && s !== null && this.game.legalMovesFrom(this.selected).includes(s)) {
      void this.play(this.selected, s);
      return;
    }
    this.selected = null;
    this.view.select(null);
  }

  /**
   * Turns a pick into the square the player meant. The lifted selected piece and the portrait
   * cards stand in front of squares further back, so a legal destination under the pointer wins
   * unless the pointer is on another of the mover's own pieces; then a piece body; then a card.
   */
  private resolve(hit: PickResult): Square | null {
    const ownOther =
      hit.body !== null && hit.body !== this.selected && this.game.board[hit.body]?.side === this.game.turn;
    if (
      !ownOther &&
      this.selected !== null &&
      hit.board !== null &&
      this.game.legalMovesFrom(this.selected).includes(hit.board)
    ) {
      return hit.board;
    }
    if (hit.body !== null) return hit.body;
    return hit.card ?? hit.board;
  }

  private subjectAt(s: Square | null) {
    const piece = s === null ? null : this.game.board[s];
    if (!piece) return null;
    const faction = this.factions[piece.side];
    return { piece, subject: { character: characterFor(faction, piece), faction, role: piece.type, side: piece.side } };
  }

  private bindPointer() {
    const canvas = this.stage.renderer.domElement;
    const ndc = (e: PointerEvent) =>
      new THREE.Vector2((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1);

    // Distinguish a click from an orbit drag, and a long press (touch profile card) from both.
    let down: { x: number; y: number; t: number } | null = null;
    let pressTimer = 0;
    let longPressed = false;
    let hoverTimer = 0;
    let hoverId: string | null = null;

    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      longPressed = false;
      window.clearTimeout(hoverTimer);
      this.card.hide();
      if (e.pointerType !== 'mouse') {
        const hit = this.subjectAt(this.resolve(this.view.pick(ndc(e))));
        if (hit) {
          pressTimer = window.setTimeout(() => {
            longPressed = true;
            this.card.show(hit.subject);
          }, LONG_PRESS_MS);
        }
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      window.clearTimeout(pressTimer);
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (moved < 8 && quick && !longPressed) this.onSquareClicked(this.resolve(this.view.pick(ndc(e))));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) window.clearTimeout(pressTimer);
      if (e.pointerType !== 'mouse') return;

      const s = this.resolve(this.view.pick(ndc(e)));
      const hit = this.subjectAt(s);
      const actionable = !this.busy && !this.game.isOver && this.humanTurn && hit?.piece.side === this.game.turn;
      this.view.setHover(actionable ? hit!.piece.id : null);
      const target = this.selected !== null && s !== null && this.game.legalMovesFrom(this.selected).includes(s);
      canvas.style.cursor = actionable || target ? 'pointer' : '';

      // Profile card after hovering a piece briefly; it follows the cursor while on the same piece.
      const id = down ? null : (hit?.piece.id ?? null);
      const at = { x: e.clientX, y: e.clientY };
      if (id !== hoverId) {
        hoverId = id;
        window.clearTimeout(hoverTimer);
        this.card.hide();
        if (hit && id) hoverTimer = window.setTimeout(() => this.card.show(hit.subject, at), HOVER_DELAY_MS);
      } else if (this.card.visible) {
        this.card.moveTo(at);
      }
    });
    canvas.addEventListener('pointerleave', () => {
      hoverId = null;
      window.clearTimeout(hoverTimer);
      this.card.hide();
    });
  }
}

// Piece faces and portraits are drawn onto canvases, so wait for the web font's glyphs first.
async function boot() {
  const slow = Number(new URLSearchParams(location.search).get('slow'));
  if (slow > 0) clock.base = slow;

  // Browsers only allow audio after a user gesture.
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) audio.play('ui');
  });

  const glyphs = new Set('帥將仕士相象俥車傌馬炮砲兵卒楚河漢界');
  for (const f of FACTIONS) {
    glyphs.add(f.name);
    for (const slot of Object.values(f.roster)) {
      for (const ch of Array.isArray(slot) ? slot : [slot]) for (const g of ch.name) glyphs.add(g);
    }
  }
  try {
    await Promise.race([
      document.fonts.load(`900 64px ${PIECE_FONT}`, [...glyphs].join('')),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    // Fall back to whatever serif font the system has.
  }
  const app = new App();
  document.body.classList.add('ready');
  void app.chooseAndStart();
}

void boot();
