import { FxLevel } from '../fx/effects';

export interface Settings {
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
  fx: FxLevel;
  cards: boolean;
  autoFlip: boolean;
}

const STORAGE_KEY = 'xq3d.settings';
const DEFAULTS: Settings = { music: 0.5, sfx: 0.8, fx: 'full', cards: true, autoFlip: false };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

/** The 設定 dialog: volumes, effect strength and display options. Changes apply immediately. */
export class SettingsPanel {
  private readonly dialog = document.getElementById('settings') as HTMLDialogElement;
  private readonly music = document.getElementById('set-music') as HTMLInputElement;
  private readonly sfx = document.getElementById('set-sfx') as HTMLInputElement;
  private readonly cards = document.getElementById('set-cards') as HTMLInputElement;
  private readonly autoFlip = document.getElementById('set-autoflip') as HTMLInputElement;

  constructor(
    private settings: Settings,
    private readonly onChange: (s: Settings) => void,
  ) {
    this.music.value = String(Math.round(settings.music * 100));
    this.sfx.value = String(Math.round(settings.sfx * 100));
    this.cards.checked = settings.cards;
    this.autoFlip.checked = settings.autoFlip;
    this.fxInputs().forEach((r) => (r.checked = r.value === settings.fx));

    const update = () => {
      this.settings = {
        music: Number(this.music.value) / 100,
        sfx: Number(this.sfx.value) / 100,
        fx: (this.fxInputs().find((r) => r.checked)?.value ?? 'full') as FxLevel,
        cards: this.cards.checked,
        autoFlip: this.autoFlip.checked,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      } catch {
        // Not critical.
      }
      this.onChange(this.settings);
    };
    this.dialog.addEventListener('input', update);
    this.dialog.addEventListener('change', update);
    document.getElementById('btn-settings-close')!.addEventListener('click', () => this.dialog.close());
    // Click on the backdrop closes the dialog.
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
  }

  private fxInputs() {
    return [...this.dialog.querySelectorAll<HTMLInputElement>('input[name="fx"]')];
  }

  open() {
    this.dialog.showModal();
  }
}
