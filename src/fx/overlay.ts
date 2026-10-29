import * as THREE from 'three';

/** DOM layer above the canvas for impact words, screen flashes and the check vignette. */
export class FxOverlay {
  private readonly layer: HTMLElement;
  private readonly flashEl: HTMLElement;

  constructor(private readonly camera: THREE.Camera) {
    this.layer = document.createElement('div');
    this.layer.id = 'fx-layer';
    this.flashEl = document.createElement('div');
    this.flashEl.id = 'fx-flash';
    document.body.append(this.layer, this.flashEl);
  }

  /** A large brush-stroke word that pops at a board position, e.g. 「斬」. */
  word(text: string, at: THREE.Vector3, color = '#ffe9b0') {
    const p = at.clone().setY(at.y + 0.9).project(this.camera);
    const el = document.createElement('div');
    el.className = 'fx-word';
    el.textContent = text;
    el.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
    el.style.setProperty('--c', color);
    this.layer.append(el);
    el.addEventListener('animationend', () => el.remove());
  }

  flash(color = '#fff', strength = 0.55) {
    this.flashEl.style.background = color;
    this.flashEl.animate([{ opacity: strength }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });
  }

  /** Pulsing red screen edges while in check. */
  setDanger(on: boolean) {
    document.body.classList.toggle('danger', on);
  }
}
