import type {PageHost} from '../page-host';
import type {PageState} from '../page-model';
import {appendDictation, dictationCatalog, type DictationCatalog, validDictationText} from '../dictation-types';
import {showFormulaToast} from './dsh-math-export';

/** Probing the installed recognizers must answer quickly; the microphone is not opened. */
const PROBE_TIMEOUT_MS = 12_000;
/** The host stops a capture after two minutes; this guard only covers a lost reply. */
const CAPTURE_TIMEOUT_MS = 135_000;

/** Native recognizer names are identifiers such as MS-2052-80-DESK; show a readable culture. */
function languageLabel(culture: string, name: string) {
  if (culture === 'zh-CN') return 'zh-CN · 中文（简体）';
  if (culture === 'zh-TW') return 'zh-TW · 中文（繁體）';
  if (culture === 'en-US') return 'en-US · English (US)';
  if (culture === 'en-GB') return 'en-GB · English (UK)';
  return `${culture} · ${name}`;
}

type Pending = {id: number; timer: ReturnType<typeof setTimeout>};
type Capture = {
  id: number;
  sequence: number;
  startedAt: number;
  stopping: boolean;
  timeout: ReturnType<typeof setTimeout>;
};

/**
 * One compact dictation bar above the composer.
 *
 * The bar replaces the former five-button panel: a state dot, one status line,
 * the confirmed text, the recognizer picker and at most two actions
 * (start/stop and dismiss). The protocol with the extension host is unchanged.
 */
export class DictationControl {
  private state: PageState | undefined;
  private owner = '';
  private sequence = 0;
  private dead = false;
  private open = false;
  private catalog: DictationCatalog | undefined;
  private buffer = '';
  private notice = '';
  private selectedLanguage = '';
  private cleanupUnknown = false;
  private lastProbeSuccess = 0;
  private pending: Pending | undefined;
  private capture: Capture | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;

  private readonly trigger = document.createElement('button');
  private readonly bar = document.createElement('div');
  private readonly dot = document.createElement('span');
  private readonly status = document.createElement('span');
  private readonly live = document.createElement('span');
  private readonly language = document.createElement('select');
  private readonly languageWrap = document.createElement('div');
  private readonly languageTrigger = document.createElement('button');
  private readonly languageLabel = document.createElement('span');
  private readonly languageMenu = document.createElement('div');
  private languageOpen = false;
  private readonly primary = document.createElement('button');
  private readonly dismiss = document.createElement('button');

  constructor(
    private host: PageHost,
    composer: HTMLElement,
    private editable: () => boolean,
    private insert: (text: string) => boolean,
    private changed: () => void,
  ) {
    this.mountTrigger(composer);
    this.mountBar(composer);
    this.trigger.onclick = () => this.toggle();
    this.primary.onclick = () => this.primaryAction();
    this.dismiss.onclick = () => this.close();
    this.language.onchange = () => {
      this.selectedLanguage = this.language.value;
      this.closeLanguageMenu();
      this.refresh();
    };
    this.languageTrigger.onclick = () => this.toggleLanguageMenu();
    this.languageTrigger.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      this.openLanguageMenu(true);
    });
    this.languageMenu.addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-language-id]');
      if (!target) return;
      this.language.value = target.dataset.languageId ?? '';
      this.language.dispatchEvent(new Event('change'));
    });
    this.languageMenu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeLanguageMenu();
        this.languageTrigger.focus();
      }
    });
    document.addEventListener('pointerdown', this.outsideLanguage);
    this.bar.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      this.close();
    });
    host.messages.addEventListener('message', this.receive);
    window.addEventListener('pagehide', this.dispose, {once: true});
  }

  /** Whether a capture owns the microphone; callers disable sending while true. */
  get busy() {
    return this.capture !== undefined;
  }

  update(state: PageState) {
    const owner = JSON.stringify([state.threadId, state.connectionId]);
    if (this.owner && owner !== this.owner) {
      this.cancelPreparation(false);
      this.catalog = undefined;
      this.selectedLanguage = '';
      this.cleanupUnknown = false;
      this.lastProbeSuccess = 0;
      this.open = false;
    }
    this.owner = owner;
    this.state = state;
    this.refresh();
  }

  /** Cancel an in-flight probe or capture without touching the draft. */
  cancelPreparation(notify = true) {
    const value = this.capture;
    clearTimeout(this.pending?.timer);
    this.pending = undefined;
    this.stopTicker();
    if (value) {
      clearTimeout(value.timeout);
      this.capture = undefined;
      try {
        this.send('cancel', {captureId: value.id});
      } catch {
        // A disposed page cannot report the cancel; the host closes the lease.
      }
    }
    this.buffer = '';
    this.notice = notify ? '已取消' : '';
    this.refresh();
    if (value) this.changed();
  }

  dispose = () => {
    this.cancelPreparation(false);
    this.dead = true;
    this.stopTicker();
    this.host.messages.removeEventListener('message', this.receive);
    document.removeEventListener('pointerdown', this.outsideLanguage);
    this.trigger.remove();
    this.bar.remove();
  };

  refresh() {
    if (this.dead) return;
    const available = this.state?.dictationAvailable === true;
    const active = this.capture !== undefined;
    const canEdit = this.editable();
    const catalogReady = this.catalog?.available === true;

    this.trigger.hidden = !available;
    this.trigger.disabled = !available || (!active && !this.open && !this.buffer && !canEdit) || this.capture?.stopping === true;
    this.trigger.title = active ? '停止语音输入' : '语音输入';
    this.trigger.setAttribute('aria-pressed', String(active));
    this.trigger.setAttribute('aria-expanded', String(this.open));

    this.bar.hidden = !this.open || !available;
    this.bar.dataset.active = String(active);
    this.bar.dataset.state = this.stateName(active);

    this.status.textContent = this.statusText(active);
    this.live.textContent = this.buffer;
    this.live.hidden = this.buffer.length === 0;
    this.live.title = this.buffer;

    const languageVisible = catalogReady && !active;
    this.languageWrap.hidden = !languageVisible;
    this.languageTrigger.disabled = this.pending !== undefined || !languageVisible;
    const selected = this.language.selectedOptions[0];
    this.languageLabel.textContent = selected?.textContent ?? '';
    this.languageLabel.title = this.languageLabel.textContent;
    this.language.disabled = this.pending !== undefined;
    if (!languageVisible) this.closeLanguageMenu();

    this.primary.textContent = active ? '停止' : this.buffer ? '插入' : this.cleanupUnknown ? '重试' : catalogReady ? '开始' : '重试';
    this.primary.disabled = active
      ? this.capture?.stopping === true
      : this.buffer
        ? !canEdit
        : catalogReady
          ? this.cleanupUnknown
            ? !canEdit
            : !canEdit || !this.language.value
          : this.pending !== undefined;
  }

  private mountTrigger(composer: HTMLElement) {
    this.trigger.id = 'dictation-open';
    this.trigger.type = 'button';
    this.trigger.className = 'icon-button';
    this.trigger.hidden = true;
    this.trigger.title = '语音输入';
    this.trigger.setAttribute('aria-label', '语音输入');
    this.trigger.setAttribute('aria-controls', 'dictation-bar');
    this.trigger.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M9 21h6"/></svg>';
    composer.querySelector('.left-actions')?.append(this.trigger);
  }

  private mountBar(composer: HTMLElement) {
    this.bar.id = 'dictation-bar';
    this.bar.className = 'dictation-bar ds-panel';
    this.bar.hidden = true;
    this.bar.tabIndex = -1;
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', '语音输入');

    this.dot.className = 'dictation-dot';
    this.dot.setAttribute('aria-hidden', 'true');
    this.status.className = 'dictation-status';
    this.status.setAttribute('role', 'status');
    this.live.className = 'dictation-live';

    this.language.id = 'dictation-language';
    this.language.className = 'dictation-language-native';
    this.language.tabIndex = -1;
    this.language.setAttribute('aria-label', '识别语言');

    this.languageWrap.className = 'dictation-language-wrap';
    this.languageTrigger.type = 'button';
    this.languageTrigger.className = 'dictation-language-trigger';
    this.languageTrigger.setAttribute('aria-haspopup', 'listbox');
    this.languageTrigger.setAttribute('aria-expanded', 'false');
    this.languageTrigger.setAttribute('aria-label', '识别语言');
    this.languageLabel.className = 'dictation-language-label';
    const caret = document.createElement('span');
    caret.className = 'dictation-caret disclosure-caret';
    caret.setAttribute('aria-hidden', 'true');
    this.languageTrigger.append(this.languageLabel, caret);
    this.languageMenu.className = 'dictation-language-menu';
    this.languageMenu.setAttribute('role', 'listbox');
    this.languageMenu.hidden = true;
    this.languageWrap.append(this.languageTrigger, this.languageMenu, this.language);

    this.primary.type = 'button';
    this.primary.className = 'dictation-primary ds-button ds-button-primary';
    this.dismiss.type = 'button';
    this.dismiss.className = 'dictation-icon ds-icon-button';
    this.dismiss.textContent = '✕';
    this.dismiss.setAttribute('aria-label', '关闭语音输入');
    this.dismiss.title = '关闭语音输入';

    this.bar.append(this.dot, this.status, this.live, this.languageWrap, this.primary, this.dismiss);
    const anchor = composer.parentElement ?? composer;
    anchor.insertBefore(this.bar, composer);
  }

  private stateName(active: boolean) {
    if (active) return 'active';
    if (this.pending) return 'pending';
    if (this.cleanupUnknown || this.notice) return 'error';
    return 'idle';
  }

  private statusText(active: boolean) {
    if (active) {
      if (this.capture?.stopping) return '正在结束…';
      return `正在听写 ${this.clock()}`;
    }
    if (this.pending) return '正在准备…';
    if (this.notice) return this.notice;
    if (this.cleanupUnknown) return '请检查麦克风后重试';
    if (this.catalog?.available) return '';
    if (this.catalog) return '没有可用的识别语言';
    return '';
  }

  private clock() {
    const elapsed = this.capture ? Math.max(0, Math.floor((Date.now() - this.capture.startedAt) / 1000)) : 0;
    return `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  }

  private toggleLanguageMenu() {
    if (this.languageOpen) this.closeLanguageMenu();
    else this.openLanguageMenu();
  }

  private openLanguageMenu(focus = false) {
    if (this.languageTrigger.disabled || this.language.options.length === 0) return;
    this.renderLanguageMenu();
    this.languageOpen = true;
    this.languageMenu.hidden = false;
    this.languageTrigger.setAttribute('aria-expanded', 'true');
    if (!focus) return;
    const item = this.languageMenu.querySelector<HTMLElement>('[aria-selected="true"]')
      ?? this.languageMenu.querySelector<HTMLElement>('.dictation-language-option');
    item?.focus();
  }

  private renderLanguageMenu() {
    this.languageMenu.replaceChildren(...Array.from(this.language.options).map(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dictation-language-option';
      item.dataset.languageId = option.value;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.value === this.language.value));
      item.textContent = option.textContent ?? option.value;
      return item;
    }));
  }

  private closeLanguageMenu() {
    if (!this.languageOpen) return;
    this.languageOpen = false;
    this.languageMenu.hidden = true;
    this.languageTrigger.setAttribute('aria-expanded', 'false');
  }

  private outsideLanguage = (event: PointerEvent) => {
    if (!this.languageWrap.contains(event.target as Node)) this.closeLanguageMenu();
  };

  private toggle() {
    if (this.capture) {
      this.stop();
      return;
    }
    this.open = !this.open;
    if (this.open && !this.catalog) this.probe();
    this.refresh();
    if (this.open) this.bar.focus({preventScroll: true});
  }

  private primaryAction() {
    if (this.capture) {
      this.stop();
      return;
    }
    if (this.buffer) {
      this.apply();
      return;
    }
    if (this.cleanupUnknown || !this.catalog) {
      this.probe();
      return;
    }
    if (this.catalog.available) this.start();
  }

  private send(action: 'probe' | 'start' | 'stop' | 'cancel', extra: object = {}) {
    const s = this.state;
    if (this.dead || !s) throw Error('语音输入尚未就绪');
    const id = ++this.sequence;
    this.host.postMessage({type: 'dictation', id, threadId: s.threadId, connectionId: s.connectionId, action, ...extra});
    return id;
  }

  private probe() {
    if (this.pending || this.capture || this.state?.dictationAvailable !== true) return;
    this.selectedLanguage = this.language.value || this.selectedLanguage;
    this.catalog = undefined;
    this.notice = '';
    let id: number;
    try {
      id = this.send('probe');
    } catch {
      this.notice = '读取语言失败，请重试';
      this.refresh();
      return;
    }
    const timer = setTimeout(() => {
      if (this.pending?.id !== id) return;
      this.pending = undefined;
      this.notice = '读取语言失败，请重试';
      this.refresh();
    }, PROBE_TIMEOUT_MS);
    this.pending = {id, timer};
    this.refresh();
  }

  private start() {
    if (this.capture || this.pending || this.catalog?.available !== true || !this.editable()) return;
    const id = this.sequence + 1;
    this.buffer = '';
    this.notice = '';
    const timeout = setTimeout(() => {
      if (this.capture?.id !== id) return;
      try {
        this.send('cancel', {captureId: id});
      } catch {
        // The timeout still ends the local capture.
      }
      this.finish('听写超时', true);
    }, CAPTURE_TIMEOUT_MS);
    this.capture = {id, sequence: 0, startedAt: Date.now(), stopping: false, timeout};
    this.startTicker();
    this.refresh();
    this.changed();
    try {
      this.send('start', {recognizerId: this.language.value});
    } catch {
      this.finish('无法开始听写', false);
    }
  }

  private stop() {
    const value = this.capture;
    if (!value || value.stopping) return;
    value.stopping = true;
    this.notice = '';
    try {
      this.send('stop', {captureId: value.id});
    } catch {
      try {
        this.send('cancel', {captureId: value.id});
      } catch {
        // The local state is closed below regardless.
      }
      this.finish('停止失败，请重试', true);
    }
    this.refresh();
  }

  private finish(notice: string, apply: boolean) {
    const value = this.capture;
    if (value) clearTimeout(value.timeout);
    this.stopTicker();
    this.capture = undefined;
    this.notice = notice;
    this.changed();
    if (apply && this.buffer) this.apply();
    else this.refresh();
  }

  private apply() {
    if (!this.buffer) return;
    try {
      if (!this.editable() || !this.insert(this.buffer)) throw Error('无法加入草稿');
      this.buffer = '';
      this.notice = '';
      this.open = false;
    } catch {
      this.notice = '无法加入草稿，请重试';
      this.open = true;
      showFormulaToast('无法加入草稿，请重试', true);
    }
    this.refresh();
    this.changed();
  }

  private close() {
    this.open = false;
    this.cancelPreparation(false);
    this.refresh();
    this.trigger.focus({preventScroll: true});
  }

  private startTicker() {
    this.stopTicker();
    this.ticker = setInterval(() => this.refresh(), 500);
  }

  private stopTicker() {
    if (this.ticker === undefined) return;
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private receive = (event: MessageEvent) => {
    const m = event.data;
    const s = this.state;
    if (this.dead || !s || m?.threadId !== s.threadId || m.connectionId !== s.connectionId) return;

    if (m.type === 'dictation-cleanup') {
      if (!Number.isSafeInteger(m.captureId) || m.captureId <= this.lastProbeSuccess) return;
      this.cleanupUnknown = true;
      this.notice = '';
      this.refresh();
      return;
    }

    if (m.type === 'dictation-result') {
      const pending = this.pending;
      if (m.action === 'probe' && pending && m.id === pending.id) {
        clearTimeout(pending.timer);
        this.pending = undefined;
        try {
          if (!m.ok) throw Error(typeof m.error === 'string' && m.error ? m.error : '读取语言失败');
          this.catalog = dictationCatalog({protocol: 1, microphoneOpened: false, recognizers: m.catalog?.recognizers});
          this.language.replaceChildren(...this.catalog.recognizers.map(value => {
            const option = document.createElement('option');
            option.value = value.id;
            option.textContent = languageLabel(value.culture, value.name);
            return option;
          }));
          this.language.value = this.catalog.recognizers.some(value => value.id === this.selectedLanguage)
            ? this.selectedLanguage
            : this.catalog.recognizers.find(value => value.culture === 'zh-CN')?.id ?? this.catalog.recognizers[0]?.id ?? '';
          this.selectedLanguage = this.language.value;
          this.cleanupUnknown = false;
          this.lastProbeSuccess = m.id;
          this.notice = this.catalog.available ? '' : '没有可用的识别语言';
        } catch (error) {
          this.catalog = undefined;
          const detail = error instanceof Error ? error.message : '';
          this.status.title = detail;
          this.notice = detail ? `读取语言失败：${detail}` : '读取语言失败，请重试';
        }
        this.refresh();
      } else if (!m.ok && this.capture && (m.id === this.capture.id || m.captureId === this.capture.id)) {
        try {
          this.send('cancel', {captureId: this.capture.id});
        } catch {
          // Nothing else to release locally.
        }
        this.finish('无法开始听写', true);
      }
      return;
    }

    const value = this.capture;
    if (m.type !== 'dictation-event' || !value || m.captureId !== value.id) return;
    if (m.phase === 'text') {
      try {
        if (m.sequence !== value.sequence + 1 || !validDictationText(m.text)) throw Error('听写片段未核对');
        this.buffer = appendDictation(this.buffer, m.text, true);
        value.sequence = m.sequence;
        this.notice = '';
      } catch {
        try {
          this.send('cancel', {captureId: value.id});
        } catch {
          // Keep the confirmed text that already arrived.
        }
        this.finish('听写中断，已保留文字', false);
      }
      this.refresh();
    } else if (m.phase === 'listening') {
      this.notice = '';
      this.refresh();
    } else if (m.phase === 'stopping') {
      value.stopping = true;
      this.refresh();
    } else if (m.phase === 'ended') {
      this.finish('', true);
    } else if (m.phase === 'error') {
      if (m.cleanupUnknown === true) this.cleanupUnknown = true;
      this.finish('听写中断，已保留文字', false);
    } else if (m.phase === 'cancelled') {
      this.buffer = '';
      this.finish('已取消', false);
    }
  };
}
