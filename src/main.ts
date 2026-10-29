import * as THREE from 'three';
import { Game } from './core/game';
import { findKing } from './core/rules';
import { Side, Square, opponent } from './core/types';
import { FACTIONS, FACTION_BY_ID, Faction, characterFor } from './data/factions';
import { BoardView, squareToWorld } from './render/boardView';
import { Stage } from './render/stage';
import { PIECE_FONT } from './render/textures';
import { CharacterCard } from './ui/characterCard';
import { Hud, SIDE_NAMES } from './ui/hud';
import { FactionChoice, SetupScreen, loadChoice } from './ui/setup';
import './style.css';

const HOVER_DELAY_MS = 300;
const LONG_PRESS_MS = 450;

/** Local two-player controller: setup → input → rules → animation → HUD. */
class App {
  private game = new Game();
  private factions: Record<Side, Faction>;
  private readonly stage: Stage;
  private readonly view: BoardView;
  private readonly hud: Hud;
  private readonly card = new CharacterCard();
  private readonly setup: SetupScreen;
  private selected: Square | null = null;
  private busy = false;
  private autoFlip = false;
  private showCards = true;

  constructor() {
    this.stage = new Stage(document.getElementById('stage')!);
    this.view = new BoardView(this.stage);
    this.hud = new Hud({
      newGame: () => void this.chooseAndStart(),
      undo: () => this.undo(),
      flipView: () => this.flipView(),
      toggleViewMode: () => this.toggleViewMode(),
      toggleAutoFlip: () => (this.autoFlip = !this.autoFlip),
      toggleCards: () => {
        this.showCards = !this.showCards;
        this.view.setShowCards(this.showCards);
        return this.showCards;
      },
      resign: () => this.resign(),
    });
    this.setup = new SetupScreen(this.card);
    this.factions = this.resolveFactions(loadChoice());
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
    });
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
    const choice = await this.setup.open();
    this.startGame(this.resolveFactions(choice));
  }

  private startGame(factions: Record<Side, Faction>) {
    this.factions = factions;
    this.game = new Game();
    this.selected = null;
    this.hud.hideResult();
    this.hud.setMatchup(`單機雙人 · ${factions.red.fullName} 對 ${factions.black.fullName}`);
    this.view.setBoard(this.game.board, factions);
    this.refresh();
    if (this.stage.side !== 'red') this.flipView();
  }

  private refresh() {
    const inCheck = !this.game.isOver && this.game.inCheck();
    this.hud.setTurn(this.game.turn, inCheck, this.label(this.game.turn));
    this.hud.setHistory(this.game.history);
    this.view.setLastMove(this.game.lastMove);
    this.view.setCheck(inCheck ? findKing(this.game.board, this.game.turn) : null);
  }

  private showResult() {
    this.hud.showResult(this.game.status, (side) => this.label(side));
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
      if (entry.givesCheck) this.hud.flash('將軍！', 'check');
      if (this.autoFlip) await this.turnViewTo(this.game.turn);
    }
    this.busy = false;
  }

  private async undo() {
    if (this.busy) return;
    const entry = this.game.undo();
    if (!entry) return;
    this.busy = true;
    this.hud.hideResult();
    this.selected = null;
    await this.view.animateUndo(entry);
    this.refresh();
    if (this.autoFlip) await this.turnViewTo(this.game.turn);
    this.busy = false;
  }

  private resign() {
    if (this.busy || this.game.isOver) return;
    if (!confirm(`${this.label(this.game.turn)}確定要認輸嗎？`)) return;
    this.game.resign(this.game.turn);
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
    if (this.busy || this.game.isOver) return;
    const piece = s === null ? null : this.game.board[s];

    if (s !== null && piece?.side === this.game.turn) {
      if (this.selected === s) {
        this.selected = null;
        this.view.select(null);
      } else {
        this.selected = s;
        this.view.select(s, this.game.board, this.game.legalMovesFrom(s));
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
        const hit = this.subjectAt(this.view.pick(ndc(e)));
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
      if (moved < 8 && quick && !longPressed) this.onSquareClicked(this.view.pick(ndc(e)));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) window.clearTimeout(pressTimer);
      if (e.pointerType !== 'mouse') return;

      const s = this.view.pick(ndc(e));
      const hit = this.subjectAt(s);
      const actionable = !this.busy && !this.game.isOver && hit?.piece.side === this.game.turn;
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
