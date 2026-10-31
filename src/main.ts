import * as THREE from 'three';
import { AiPlayer } from './ai/player';
import { AiLevel, LEVEL_BY_ID } from './ai/levels';
import { audio } from './audio/audio';
import { Game, HistoryEntry } from './core/game';
import { findKing } from './core/rules';
import { PieceType, Side, Square, opponent } from './core/types';
import { FACTIONS, FACTION_BY_ID, Faction, characterFor } from './data/factions';
import { Cinematic } from './fx/cinematic';
import { Link, MatchSetup } from './net/link';
import { Room, hostRoom, joinRoom } from './net/peer';
import { Msg, inviteLink } from './net/protocol';
import { Chat } from './ui/chat';
import { Lobby } from './ui/lobby';
import { BoardView, PickResult, squareToWorld } from './render/boardView';
import { Stage } from './render/stage';
import { PIECE_FONT } from './render/textures';
import { clock } from './render/tween';
import { CharacterCard } from './ui/characterCard';
import { Hud, SIDE_NAMES } from './ui/hud';
import { Settings, SettingsPanel, loadSettings } from './ui/settings';
import { FactionChoice, GameMode, SetupChoice, SetupScreen, loadChoice, ownFaction } from './ui/setup';
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
  private readonly cinema: Cinematic;
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
  private readonly chat = new Chat((text) => this.sendChat(text));
  private readonly lobby = new Lobby((code) => inviteLink(code, location.href));
  /** Connected games: the channel to the other player, and what arrived while the board was busy. */
  private link: Link | null = null;
  private readonly remoteQueue: Msg[] = [];
  private opponentLeft = false;
  /** Player names in a connected game; null elsewhere. */
  private names: Record<Side, string> | null = null;
  /** Plies of an undo this player asked for and is waiting on. */
  private undoRequest: 1 | 2 | null = null;

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
    this.ai.onFallback = () => this.hud.flash('大師引擎無法啟動，改用高手', 'info');
    this.cinema = new Cinematic({
      sfx: (name) => audio.play(name),
      flash: (color, strength) => this.view.overlay.flash(color, strength),
      kick: (amount) => this.stage.kick(amount),
    });
    // Closing the result dialog (e.g. 檢視棋局) also clears the victory backdrop.
    document.getElementById('result')!.addEventListener('close', () => this.cinema.dismiss());
    this.setup = new SetupScreen(this.card);
    this.factions = this.resolveFactions(loadChoice().factions);
    this.bindPointer();
    // Closing the tab should tell the opponent at once instead of leaving them to time out.
    window.addEventListener('pagehide', () => this.link?.close());
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
      __net: () => ({ link: !!this.link, closed: this.link?.closed ?? null, left: this.opponentLeft, queue: this.remoteQueue.length }),
      __cinemaTime: () => (this.cinema.active ? this.cinema.elapsed : -1),
      /** Plays a character's ultimate on its own, e.g. __ult('guan-yu', 'finisher'). */
      __ult: (id: string, kind: 'finisher' | 'triumph' = 'finisher', side: Side = 'red') => {
        for (const faction of FACTIONS) {
          for (const [role, slot] of Object.entries(faction.roster)) {
            const character = (Array.isArray(slot) ? slot : [slot]).find((c) => c.id === id);
            if (!character) continue;
            void this.cinema.play({
              kind,
              character,
              faction,
              role: role as PieceType,
              side,
              caption: '將死',
              level: this.settings.fx === 'reduced' ? 'reduced' : 'full',
            });
            return true;
          }
        }
        return false;
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
    const base = `${mirror ? SIDE_NAMES[side] : ''}${f.name}軍`;
    const name = this.names?.[side];
    return name ? `${name}（${base}）` : base;
  }

  async chooseAndStart() {
    if (this.busy) return;
    if (this.link && !this.opponentLeft && !this.game.isOver && !confirm('要離開這場連線對戰嗎？對手會看到你已離線。')) return;
    this.card.hide();
    this.cinema.dismiss();
    this.hud.hideResult();
    audio.playMusic('menu');
    let error: string | undefined;
    for (;;) {
      const choice = await this.setup.open(error);
      if (choice.mode !== 'online') {
        this.startGame(this.resolveFactions(choice.factions), choice);
        audio.playMusic('battle', choice.factions.red);
        return;
      }
      const result = await this.connectOnline(choice);
      if ('link' in result) {
        const { link, setup } = result;
        const factions = this.resolveFactions(setup.factions);
        this.startGame(factions, { mode: 'online', level: choice.level, human: setup.mySide }, link, setup.names);
        audio.playMusic('battle', setup.factions.red);
        return;
      }
      error = result.error;
    }
  }

  /** Opens or joins a room and agrees the match with the other player; shows the waiting room meanwhile. */
  private async connectOnline(choice: SetupChoice): Promise<{ link: Link; setup: MatchSetup } | { error?: string }> {
    let cancel!: () => void;
    const cancelled = new Promise<never>((_, reject) => (cancel = () => reject(new Error(''))));
    cancelled.catch(() => {});
    let room: Promise<Room> | null = null;
    let link: Link | null = null;
    this.lobby.show(choice.role, cancel);
    try {
      let setup: MatchSetup;
      if (choice.role === 'host') {
        const side = choice.human;
        const guest = new Promise<import('./net/link').Transport>((resolve, reject) => {
          room = hostRoom(resolve);
          room.then((r) => this.lobby.setCode(r.code), reject);
        });
        link = new Link(await Promise.race([guest, cancelled]));
        this.lobby.setStatus('朋友已加入，準備開局…');
        setup = await Promise.race([link.hostHandshake({ side, faction: ownFaction(choice), name: choice.name }), cancelled]);
      } else {
        link = new Link(await Promise.race([joinRoom(choice.code), cancelled]));
        this.lobby.setStatus('已連上，準備開局…');
        setup = await Promise.race([link.guestHandshake(ownFaction(choice), choice.name), cancelled]);
      }
      this.lobby.hide();
      return { link, setup };
    } catch (err) {
      this.lobby.hide();
      link?.close();
      void (room as Promise<Room> | null)?.then((r) => r.close(), () => {});
      const message = err instanceof Error ? err.message : '';
      return { error: message || undefined };
    }
  }

  /** True when the person at the screen may move now (always, in two-player mode). */
  private get humanTurn() {
    return this.mode === 'local' || (this.game.turn === this.human && !this.opponentLeft && this.undoRequest === null);
  }

  private closeLink() {
    this.chat.close();
    this.link?.close();
    this.link = null;
    this.remoteQueue.length = 0;
    this.undoRequest = null;
    this.opponentLeft = false;
  }

  private stopAi() {
    this.cinema.dismiss();
    this.ai.cancel();
    this.thinking = false;
    this.aiToken++;
  }

  private startGame(
    factions: Record<Side, Faction>,
    choice?: { mode: GameMode; level: AiLevel; human: Side },
    link?: Link,
    players?: Record<Side, string>,
  ) {
    this.stopAi();
    this.closeLink();
    this.names = players ?? null;
    this.factions = factions;
    if (choice) {
      this.mode = choice.mode;
      this.level = choice.level;
      this.human = choice.human;
    }
    this.game = new Game();
    this.selected = null;
    this.hud.hideResult();
    const who = (side: Side) => (this.names?.[side] ? `${factions[side].fullName}・${this.names[side]}` : factions[side].fullName);
    const names = `${who('red')} 對 ${who('black')}`;
    const title = { local: '單機雙人', ai: `AI 對戰（${LEVEL_BY_ID[this.level].name}）`, online: '連線對戰' }[this.mode];
    this.hud.setMatchup(`${title} · ${names}`);
    if (link) this.attachLink(link);
    this.view.setBoard(this.game.board, factions);
    this.refresh();
    if (this.mode === 'ai' && this.level === 'master') this.ai.warmUp();
    const facing = this.mode === 'local' ? 'red' : this.human;
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

  /**
   * End-of-game sequence. A checkmate first gets the mating piece's ultimate and the loser's
   * king shattering; any decided game then gets the winning commander's triumph, which stays
   * behind the result dialog. Draws, and the "off" effect setting, go straight to the dialog.
   */
  private async finale(entry?: HistoryEntry) {
    const { status } = this.game;
    if (status.state !== 'over') return;
    const level = this.settings.fx;
    const winner = status.winner;
    let played = false;
    if (winner && level !== 'off') {
      const faction = this.factions[winner];
      const cinemaLevel = level === 'full' ? 'full' : 'reduced';
      if (status.reason === 'checkmate' && entry) {
        await this.cinema.play({
          kind: 'finisher',
          character: characterFor(faction, entry.piece),
          faction,
          role: entry.piece.type,
          side: winner,
          caption: '將死',
          level: cinemaLevel,
        });
        await this.view.shatterKing(opponent(winner));
      }
      await this.cinema.play({
        kind: 'triumph',
        character: faction.roster.k,
        faction,
        role: 'k',
        side: winner,
        level: cinemaLevel,
      });
      played = true;
    }
    if (!played) audio.play(winner ? 'victory' : 'gong');
    this.hud.showResult(status, (side) => this.label(side));
  }

  private async play(from: Square, to: Square) {
    const entry = this.game.move(from, to);
    if (!entry) return;
    // Our own move goes to the opponent straight away; the animation can run while they think.
    if (this.link && entry.piece.side === this.human) {
      this.link.send({ t: 'move', from, to, n: this.game.history.length });
    }
    this.busy = true;
    this.selected = null;
    this.card.hide();
    await this.view.animateMove(entry);
    this.refresh();
    if (this.game.isOver) {
      await this.finale(entry);
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
    this.pumpRemote();
  }

  private async undo() {
    if (this.busy) return;
    if (this.mode === 'online') return this.requestUndo();
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
    if (this.busy || this.game.isOver || this.opponentLeft) return;
    const side = this.mode === 'local' ? this.game.turn : this.human;
    if (!confirm(`${this.label(side)}確定要認輸嗎？`)) return;
    this.stopAi();
    this.link?.send({ t: 'resign' });
    this.game.resign(side);
    this.refresh();
    this.busy = true;
    void this.finale().finally(() => {
      this.busy = false;
      this.pumpRemote();
    });
  }

  // ----- Connected games ---------------------------------------------------------------------

  private sendChat(text: string) {
    if (!this.link || this.opponentLeft) return;
    this.link.send({ t: 'chat', text });
    this.chat.add('me', text, '你');
  }

  private attachLink(link: Link) {
    this.link = link;
    link.startHeartbeat(() => document.hidden);
    this.chat.open();
    this.chat.add('system', `已連線：${this.label('red')} 對 ${this.label('black')}，旗開得勝！`);
    link.onMessage((msg) => this.onRemote(msg));
    link.onClose(() => {
      if (this.link !== link) return;
      this.opponentLeft = true;
      this.undoRequest = null;
      this.selected = null;
      this.view.select(null);
      if (!this.game.isOver) this.hud.flash('對手已離線', 'info');
      this.hud.setMatchup(`${this.hud.matchup} · 對手已離線`);
      this.chat.add('system', '對手已離線');
      this.chat.disable();
    });
  }

  private onRemote(msg: Msg) {
    if (msg.t === 'chat') {
      // Talk is not game state, so it never waits for the board.
      const them = opponent(this.human);
      this.chat.add('them', msg.text, this.names?.[them] || this.label(them));
      return;
    }
    this.remoteQueue.push(msg);
    this.pumpRemote();
  }

  /** Handles the opponent's moves and requests one at a time, once the board is idle. */
  private pumpRemote() {
    while (!this.busy && this.link && this.remoteQueue.length) {
      const msg = this.remoteQueue.shift()!;
      const game = this.game;
      switch (msg.t) {
        case 'move': {
          const legal =
            !game.isOver &&
            game.turn === opponent(this.human) &&
            msg.n === game.history.length + 1 &&
            game.legalMovesFrom(msg.from).includes(msg.to);
          if (!legal) {
            // The two boards have diverged; carrying on would only make it worse.
            this.hud.flash('對局不同步，連線已中止', 'info');
            this.chat.add('system', '對局不同步，連線已中止');
            this.chat.disable();
            this.closeLinkKeepGame();
            return;
          }
          void this.play(msg.from, msg.to);
          return;
        }
        case 'resign':
          if (game.isOver) break;
          this.stopAi();
          this.chat.add('system', '對手認輸了');
          game.resign(opponent(this.human));
          this.refresh();
          this.busy = true;
          void this.finale().finally(() => {
            this.busy = false;
            this.pumpRemote();
          });
          return;
        case 'undo-reply': {
          const plies = this.undoRequest;
          this.undoRequest = null;
          if (msg.ok && plies) {
            void this.undoPlies(plies);
            return;
          }
          this.hud.flash('對手沒有同意悔棋', 'info');
          break;
        }
        case 'undo-request': {
          const ok =
            !game.isOver &&
            this.undoRequest === null &&
            game.history.length === msg.n &&
            confirm(`對手想悔棋（收回 ${msg.plies} 步），同意嗎？`);
          this.link.send({ t: 'undo-reply', ok });
          if (ok) {
            void this.undoPlies(msg.plies);
            return;
          }
          break;
        }
      }
    }
  }

  /** Keeps the position on screen but drops the connection (after a desync). */
  private closeLinkKeepGame() {
    this.opponentLeft = true;
    this.link?.close();
    this.remoteQueue.length = 0;
  }

  private requestUndo() {
    if (!this.link || this.opponentLeft || this.game.isOver || this.undoRequest !== null) return;
    // Take back my last move; if it is already my turn that includes the opponent's reply.
    const plies = this.game.turn === this.human ? 2 : 1;
    if (this.game.history.length < plies) {
      this.hud.flash('還不能悔棋', 'info');
      return;
    }
    this.undoRequest = plies;
    this.link.send({ t: 'undo-request', plies, n: this.game.history.length });
    this.hud.flash('已請求悔棋，等待對手回應…', 'info');
  }

  /** Takes back `plies` moves on both boards after both players agreed. */
  private async undoPlies(plies: number) {
    const entries = [];
    for (let i = 0; i < plies; i++) {
      const entry = this.game.undo();
      if (!entry) break;
      entries.push(entry);
    }
    if (entries.length === 0) return;
    this.busy = true;
    this.hud.hideResult();
    this.selected = null;
    this.view.select(null);
    for (const entry of entries) await this.view.animateUndo(entry);
    this.refresh();
    this.busy = false;
    this.pumpRemote();
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

  const glyphs = new Set('帥將仕士相象俥車傌馬炮砲兵卒楚河漢界死乾坤震巽坎離艮兌');
  for (const f of FACTIONS) {
    glyphs.add(f.name);
    for (const slot of Object.values(f.roster)) {
      for (const ch of Array.isArray(slot) ? slot : [slot]) for (const g of ch.name + ch.skill.name) glyphs.add(g);
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
