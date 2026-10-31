const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** The waiting room shown while a connected game is being set up. */
export class Lobby {
  private readonly dialog = $<HTMLDialogElement>('#lobby');
  private cancelHandler: (() => void) | null = null;

  constructor(private readonly inviteLink: (code: string) => string) {
    $('#btn-lobby-cancel').addEventListener('click', () => this.cancelHandler?.());
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.cancelHandler?.();
    });
    $('#btn-copy-code').addEventListener('click', (e) => this.copy($('#room-code').textContent ?? '', e.currentTarget as HTMLElement));
    $('#btn-copy-link').addEventListener('click', (e) =>
      this.copy(this.inviteLink($('#room-code').textContent ?? ''), e.currentTarget as HTMLElement),
    );
  }

  /** Opens the dialog. `host` shows the room code once `setCode` is called. */
  show(kind: 'host' | 'guest', onCancel: () => void) {
    this.cancelHandler = onCancel;
    $('#lobby-title').textContent = kind === 'host' ? '建立房間' : '加入房間';
    $('#lobby-host').hidden = kind !== 'host';
    $('#room-code').textContent = '…';
    this.setStatus(kind === 'host' ? '正在建立房間…' : '連線中…');
    if (!this.dialog.open) this.dialog.showModal();
  }

  setCode(code: string) {
    $('#room-code').textContent = code;
    this.setStatus('等待朋友加入…');
  }

  setStatus(text: string) {
    $('#lobby-status').textContent = text;
  }

  hide() {
    this.cancelHandler = null;
    if (this.dialog.open) this.dialog.close();
  }

  private async copy(text: string, button: HTMLElement) {
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = '已複製';
    } catch {
      button.textContent = '請手動複製';
    }
    setTimeout(() => (button.textContent = label), 1500);
  }
}
