import * as THREE from 'three';
import { Sfx } from '../audio/audio';
import { PieceType } from '../core/types';
import { Stage } from '../render/stage';
import { easeInCubic, easeInOutCubic, easeOutCubic, hitStop, lerp, linear, tween, wait } from '../render/tween';
import { Effects } from './effects';
import { FxOverlay } from './overlay';

/** What the board hands to a capture choreography. */
export interface CaptureScene {
  attacker: PieceType;
  mover: THREE.Group;
  victim: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Wood, face and side colours of the victim, for its fragments. */
  victimColors: THREE.ColorRepresentation[];
  hideVictim(): void;
  /** Replaces the victim with two halves cut along a world-space direction; returns them. */
  splitVictim(cutDir: THREE.Vector3): [THREE.Group, THREE.Group];
  setVictimOpacity(o: number): void;
}

export interface FxKit {
  fx: Effects;
  stage: Stage;
  overlay: FxOverlay;
  sfx(name: Sfx): void;
}

const DUST = [0xc9a777, 0xa98a5c, 0xe0c9a0];
const FIRE = [0xffd27a, 0xff9a3c, 0xff5a1f];

/** Impact beat shared by every choreography: sound, shake, slow motion and the brush word. */
function impact(kit: FxKit, s: CaptureScene, sfx: Sfx, word: string, shake: number, color?: string) {
  const full = kit.fx.level === 'full';
  kit.sfx(sfx);
  kit.stage.kick(full ? shake : shake * 0.4);
  kit.overlay.word(word, s.to, color);
  if (full) void hitStop(0.2, 0.1);
}

function flatDir(s: CaptureScene) {
  const d = s.to.clone().sub(s.from).setY(0);
  return d.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, -1) : d.normalize();
}

/** 車：蓄力後直線衝撞，目標碎裂飛散。 */
async function rook(kit: FxKit, s: CaptureScene) {
  const dir = flatDir(s);
  const back = s.from.clone().addScaledVector(dir, -0.18);
  await tween(0.14, (t) => s.mover.position.lerpVectors(s.from, back, t), easeOutCubic);
  let hit = false;
  let lastDust = 0;
  await tween(
    0.32 + s.from.distanceTo(s.to) * 0.025,
    (t) => {
      s.mover.position.lerpVectors(back, s.to, t);
      s.mover.position.y = Math.sin(Math.PI * t) * 0.12;
      if (t - lastDust > 0.06) {
        lastDust = t;
        kit.fx.emit({ at: s.mover.position.clone().setY(0.05), count: 6, speed: [0.3, 0.9], dir: new THREE.Vector3(0, 1, 0).addScaledVector(dir, -1), spread: 0.8, life: [0.4, 0.8], size: [0.25, 0.45], grow: 2, colors: DUST, drag: 2, alpha: 0.6 }, false);
      }
      if (!hit && t > 0.86) {
        hit = true;
        s.hideVictim();
        kit.fx.shatter(s.to, s.victimColors, dir, 4.2, 30);
        kit.fx.emit({ at: s.to.clone().setY(0.2), count: 40, speed: [2, 5], dir, spread: 0.7, life: [0.2, 0.45], size: [0.06, 0.12], colors: [0xfff1c0, 0xffc060], gravity: 4 });
        void kit.fx.shockwave(s.to, 0xffd9a0, 1.8, 0.45);
        void kit.fx.glow(s.to.clone().setY(0.3), 0xfff0d0, 2.2, 0.25);
        impact(kit, s, 'crash', '破', 0.32);
      }
    },
    easeInCubic,
  );
}

/** 馬：高高躍起，重踏落地，衝擊波掀起塵土。 */
async function knight(kit: FxKit, s: CaptureScene) {
  const dir = flatDir(s);
  const height = 2.1;
  // Rise slowly, hang, then slam down.
  await tween(
    0.55,
    (t) => {
      const h = easeOutCubic(t);
      s.mover.position.lerpVectors(s.from, s.to, t * 0.55);
      s.mover.position.y = h * height;
      s.mover.rotation.x = dir.z * 0.35 * h;
      s.mover.rotation.z = -dir.x * 0.35 * h;
    },
    linear,
  );
  const mid = s.mover.position.clone();
  await tween(
    0.2,
    (t) => {
      s.mover.position.lerpVectors(mid, s.to, t);
      s.mover.rotation.x = dir.z * 0.35 * (1 - t);
      s.mover.rotation.z = -dir.x * 0.35 * (1 - t);
    },
    easeInCubic,
  );
  s.mover.rotation.set(0, 0, 0);
  s.hideVictim();
  kit.fx.shatter(s.to, s.victimColors, undefined, 3.5, 30);
  kit.fx.emit({ at: s.to.clone().setY(0.08), count: 70, speed: [1.5, 3.5], dir: new THREE.Vector3(0, 0.25, 0), spread: 1.45, jitter: 0.3, life: [0.6, 1.1], size: [0.35, 0.7], grow: 2.5, colors: DUST, drag: 2.5, alpha: 0.7 }, false);
  void kit.fx.shockwave(s.to, 0xffe0a0, 3.2, 0.6);
  void kit.fx.shockwave(s.to, 0xffffff, 1.6, 0.35);
  impact(kit, s, 'stomp', '踏', 0.45);
  // Bounce of the landing.
  await tween(0.18, (t) => (s.mover.position.y = Math.sin(Math.PI * t) * 0.12));
}

/** 炮：後座開炮，火球越過炮架，命中爆炸。 */
async function cannon(kit: FxKit, s: CaptureScene) {
  const dir = flatDir(s);
  const muzzle = s.from.clone().setY(0.45).addScaledVector(dir, 0.3);
  kit.sfx('cannon-fire');
  void kit.fx.glow(muzzle, 0xffc070, 1.6, 0.25);
  kit.fx.emit({ at: muzzle, count: 24, speed: [2, 4.5], dir: dir.clone().setY(0.4), spread: 0.35, life: [0.15, 0.35], size: [0.08, 0.16], colors: FIRE, gravity: 3 });
  kit.fx.emit({ at: muzzle, count: 14, speed: [0.3, 0.8], dir: new THREE.Vector3(0, 1, 0), spread: 0.9, life: [0.8, 1.4], size: [0.4, 0.7], grow: 2.5, colors: [0x9a8f86, 0x6e6660], drag: 1.5, alpha: 0.5 }, false);
  kit.stage.kick(0.12);
  void tween(0.24, (t) => {
    s.mover.position.copy(s.from).addScaledVector(dir, -Math.sin(Math.PI * t) * 0.22);
  });

  // Fireball arc over the screen piece.
  const ball = kit.fx.orb(0xff9a3c, 0.9);
  const start = muzzle.clone();
  const end = s.to.clone().setY(0.35);
  const height = 2.2 + s.from.distanceTo(s.to) * 0.1;
  await tween(
    0.5,
    (t) => {
      ball.position.lerpVectors(start, end, t);
      ball.position.y += Math.sin(Math.PI * t) * height;
      kit.fx.emit({ at: ball.position, count: 5, speed: [0.1, 0.5], life: [0.25, 0.5], size: [0.25, 0.5], colors: FIRE, endColor: 0x401008, grow: 0.3 });
    },
    linear,
  );
  ball.dispose();

  // Explosion.
  s.hideVictim();
  kit.fx.shatter(s.to, s.victimColors, undefined, 5.5, 36);
  kit.fx.emit({ at: end, count: 90, speed: [1.2, 4], life: [0.35, 0.8], size: [0.4, 1.1], grow: 1.8, colors: FIRE, endColor: 0x3a0c04, drag: 3 });
  kit.fx.emit({ at: end, count: 60, speed: [4, 9], dir: new THREE.Vector3(0, 1, 0), spread: 1.3, life: [0.4, 0.9], size: [0.06, 0.14], colors: [0xfff3b0, 0xffc040], gravity: 7 });
  kit.fx.emit({ at: end, count: 30, speed: [0.4, 1.4], dir: new THREE.Vector3(0, 1, 0), spread: 1.1, jitter: 0.3, life: [1.2, 2], size: [0.7, 1.2], grow: 3, colors: [0x5a524c, 0x7a716a, 0x3d3733], gravity: -0.6, drag: 1.5, alpha: 0.55 }, false);
  void kit.fx.shockwave(s.to, 0xff8a30, 3.4, 0.55);
  void kit.fx.glow(end, 0xffb060, 4.5, 0.45);
  void kit.fx.flashLight(end, 0xff9040, 60, 0.6);
  if (kit.fx.level === 'full') kit.overlay.flash('#ffe6c0', 0.45);
  impact(kit, s, 'explosion', '轟', 0.6, '#ffc27a');

  await wait(0.25);
  // The cannon rolls forward into the crater.
  const from = s.mover.position.clone();
  await tween(0.35, (t) => {
    s.mover.position.lerpVectors(from, s.to, t);
    s.mover.position.y = Math.sin(Math.PI * t) * 0.25;
  });
}

/** 兵：突進一刀，目標被斜斬成兩半滑落。 */
async function pawn(kit: FxKit, s: CaptureScene) {
  const dir = flatDir(s);
  const strike = s.from.clone().lerp(s.to, 0.5);
  await tween(0.2, (t) => {
    s.mover.position.lerpVectors(s.from, strike, t);
    s.mover.position.y = Math.sin(Math.PI * t) * 0.3;
  }, easeOutCubic);

  // The cut runs across the attack direction, slightly diagonal.
  const cut = new THREE.Vector3(-dir.z, 0, dir.x).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.35);
  void kit.fx.slash(s.to, Math.atan2(-cut.z, cut.x));
  void kit.fx.glow(s.to.clone().setY(0.35), 0xfff6e0, 1.6, 0.2);
  kit.fx.emit({ at: s.to.clone().setY(0.3), count: 30, speed: [2, 4], dir: cut, spread: 0.25, life: [0.15, 0.35], size: [0.05, 0.1], colors: [0xffffff, 0xfff0c0], gravity: 3 });
  kit.fx.emit({ at: s.to.clone().setY(0.3), count: 30, speed: [2, 4], dir: cut.clone().negate(), spread: 0.25, life: [0.15, 0.35], size: [0.05, 0.1], colors: [0xffffff, 0xfff0c0], gravity: 3 });
  impact(kit, s, 'slash', '斬', 0.18, '#ffffff');
  await wait(0.08);

  // The two halves slide apart along the cut's normal and topple.
  const halves = s.splitVictim(cut);
  const normal = new THREE.Vector3(-cut.z, 0, cut.x);
  const starts = halves.map((h) => h.position.clone());
  const fade = (h: THREE.Group, o: number) =>
    h.traverse((m) => {
      const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => (x.opacity = o));
    });
  const slide = tween(0.75, (t) => {
    halves.forEach((h, i) => {
      const sign = i === 0 ? 1 : -1;
      h.position.copy(starts[i]).addScaledVector(normal, sign * (0.1 + t * 0.55)).addScaledVector(cut, sign * t * 0.2);
      h.position.y = Math.sin(Math.PI * Math.min(1, t * 1.6)) * 0.25 - t * t * 0.12;
      h.rotation.z = sign * t * 0.7;
      fade(h, t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5);
    });
  }, easeOutCubic);

  await wait(0.22);
  const resume = s.mover.position.clone();
  await tween(0.3, (t) => {
    s.mover.position.lerpVectors(resume, s.to, t);
    s.mover.position.y = Math.sin(Math.PI * t) * 0.2;
  });
  await slide;
  halves.forEach((h) => {
    h.removeFromParent();
    h.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  });
}

/** 士、象：金色封印與光柱，目標化為光點升天。 */
async function seal(kit: FxKit, s: CaptureScene, word: string) {
  const gold = [0xffe7a0, 0xffd060, 0xfff6d8];
  const from = s.from.clone();
  void tween(0.3, (t) => (s.mover.position.y = from.y + easeOutCubic(t) * 0.4));
  void kit.fx.shockwave(s.to, 0xffd36b, 1.4, 0.9);
  void kit.fx.pillar(s.to, 0xffe2a0, 1.0);
  impact(kit, s, 'seal', word, 0.12, '#ffe39a');
  const base = s.victim.position.clone();
  await tween(0.7, (t) => {
    s.victim.position.y = base.y + easeInCubic(t) * 1.4;
    s.setVictimOpacity(1 - t);
    if (Math.random() < 0.7) {
      kit.fx.emit({ at: s.victim.position.clone().setY(s.victim.position.y + 0.15), count: 8, speed: [0.3, 1.2], dir: new THREE.Vector3(0, 1, 0), spread: 1, jitter: 0.3, life: [0.6, 1.2], size: [0.06, 0.14], colors: gold, gravity: -1.2 });
    }
  }, linear);
  s.hideVictim();
  const lifted = s.mover.position.clone();
  await tween(0.4, (t) => {
    s.mover.position.lerpVectors(lifted, s.to, t);
    s.mover.position.y = lerp(lifted.y, 0, t);
  }, easeInOutCubic);
  kit.sfx('place');
}

/** 將帥：踏前一步，威壓震盪，花瓣與赤色衝擊波。 */
async function king(kit: FxKit, s: CaptureScene) {
  await tween(0.35, (t) => {
    s.mover.position.lerpVectors(s.from, s.to, t);
    s.mover.position.y = Math.sin(Math.PI * t) * 0.5;
  });
  s.hideVictim();
  kit.fx.shatter(s.to, s.victimColors, undefined, 3, 24);
  void kit.fx.shockwave(s.to, 0xff4030, 2.8, 0.6);
  void wait(0.12).then(() => kit.fx.shockwave(s.to, 0xffd36b, 2.0, 0.5));
  kit.fx.emit({ at: s.to.clone().setY(0.6), count: 60, speed: [0.8, 2.4], dir: new THREE.Vector3(0, 1, 0), spread: 1.4, life: [1.2, 2], size: [0.1, 0.18], colors: [0xff7d8f, 0xffb3c0, 0xe0304a], gravity: 0.6, drag: 1.2 }, false);
  impact(kit, s, 'gong', '威', 0.35, '#ff8f80');
}

export async function playCapture(kit: FxKit, s: CaptureScene) {
  switch (s.attacker) {
    case 'r':
      return rook(kit, s);
    case 'n':
      return knight(kit, s);
    case 'c':
      return cannon(kit, s);
    case 'p':
      return pawn(kit, s);
    case 'a':
      return seal(kit, s, '謀');
    case 'b':
      return seal(kit, s, '鎮');
    case 'k':
      return king(kit, s);
  }
}
