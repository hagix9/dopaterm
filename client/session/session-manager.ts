/**
 * セッション/タブ管理 — ローカルシェルと SSH セッションをタブで並行管理する。
 * 各セッションは独立した TerminalManager（xterm インスタンス）・
 * /ws/pty・/ws/events ソケット・コマンド追跡状態を持つ。
 * OSC 133 検出はセッション単位で行い、EffectDirector は共有。
 */
import { TerminalManager } from '../terminal/terminal-manager.js';
import { InputWatcher } from '../terminal/input-watcher.js';
import { commandTypeFromName, extractOutputTail } from '../terminal/command-utils.js';
import { CommandType } from '../types/events.js';
import {
  buildInjectionPlan,
  INJECT_END_LINE,
  MARKER_SHELL_READY,
  MARKER_FX_WAIT,
  MARKER_FX_VREAD,
  MARKER_FX_ARMED,
  MARKER_FX_FAIL,
  MARKER_UNSUPPORTED,
} from '../terminal/remote-osc133.js';
import type { EffectDirector } from '../effect/effect-director.js';
import type { ThemeManager } from '../terminal/theme-manager.js';

export interface SshProfileInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: 'agent' | 'keyfile' | 'password';
  keyPath?: string;
}

interface PendingExecution {
  executionId: string;
  command: CommandType;
  commandLine: string;
  startTimeMs: number;
}

/** SSH エフェクト自動有効化の状態機械 */
type FxState =
  | 'idle'          // ローカル等、注入対象外
  | 'await-ready'   // リモートコマンドラッパーからの OSC 5901;R 待ち
  | 'injecting'     // 静止検出 → フェーズ0 外側読み取り行を送出済み
  | 'await-vread'   // 外側 read 起動 ACK (OSC 5901;V) 待ち — 以後の行は無エコー
  | 'await-reader'  // reader 起動 ACK (OSC 5901;W) 待ち — ペイロード未送信
  | 'await-armed'   // ペイロード送信済み — フック確立確認 OSC 5901;A 待ち
  | 'armed'         // 確立済み — OSC 133 を受理する
  | 'off';          // 非対応/失敗 — OSC 133 を受理しない（通常ターミナルとして動作）

/** タブに表示するエフェクト状態（確定した事実のみに基づく） */
type FxDisplay =
  | 'init'        // 初期化中
  | 'on'          // エフェクト有効（A 確認済み）
  | 'off'         // エフェクト無効（非対応/未注入/プレーン接続）
  | 'fail'        // 初期化失敗（タイムアウト等）
  | 'unverified'; // ネストシェル系コマンド実行中 — 現シェルのフック状態は未確認

/** 実行すると別シェル・別環境へ移る可能性のあるコマンド（表示専用の推定。
    誤検出しても FX? と表示するだけでイベント処理には影響しない） */
const SHELL_NEST_RE = /^(ssh|mosh|telnet|rsh|sudo|su|doas|tmux|screen|script|docker|podman|kubectl|machinectl|nsenter|chroot|login|expect|zsh|bash|sh|fish)\b/;

export interface SessionRecord {
  id: string;
  kind: 'local' | 'ssh';
  label: string;
  sshProfileId?: string;
  sshTarget?: string;
  state: 'connecting' | 'connected' | 'closed';
  /** SSH: リモートフック確立確認（OSC 5901;A）を受けた場合のみ true。
      未承認の OSC 133 シーケンス（リモートプログラムの任意出力）は無視する */
  osc133Armed: boolean;
  /** SSH エフェクト注入の状態（ローカルは 'idle' 固定） */
  fxState: FxState;
  /** タブ表示用のエフェクト状態 */
  fxDisplay: FxDisplay;
  /** SSH: リモートコマンドラッパーを使わないプレーン接続（フォールバック後 true） */
  sshPlain: boolean;
  /** SSH: OSC 5901;R を受信済み＝ラッパーが実際に実行された確証
      （ラッパー拒否時の自動フォールバック判定に使う） */
  sawShellReady: boolean;
  /** 初期化世代（再接続ごとに +1。診断ログ用） */
  fxGen: number;
  /** 直近の PTY 出力/ユーザー入力時刻（注入タイミングの静止検出用） */
  lastOutputAt: number;
  lastUserInputAt: number;
  /** フェーズ1 読み取り行を送出した時刻（注入中のユーザー入力混入検出用） */
  injectLine1At: number;
  /** セッション開始時刻（自動フォールバック判定用） */
  connectAt: number;
  fxTimers: ReturnType<typeof setTimeout>[];
  view: HTMLElement;
  tabEl: HTMLElement;
  terminal: TerminalManager;
  eventsWs: WebSocket | null;
  inputWatcher: InputWatcher;
  pendingExec: PendingExecution | null;
  execSeq: number;
  outputBuffer: string;
  /** 明示的ログアウト判定用の入力追跡（可印文字のみ・escape/制御文字で中断） */
  typedBuf: string;
  /** 直近 Enter 確定の入力行（exit/logout 判定用） */
  lastTypedLine: string;
  lastTypedAt: number;
  /** 空バッファ時の Ctrl-D(EOF) 検出時刻 */
  ctrlDAt: number;
  /** 直近 OSC 133 C/D イベント時刻（入力意図の鮮度判定用） */
  lastOscEventAt: number;
  /** 注入世代ごとのプラン（フェーズ0送信時に配色込みで1回生成し各段で共有） */
  injectPlan: { outer: string; line: string; payload: string } | null;
}

interface SessionManagerDeps {
  token: string;
  viewsHost: HTMLElement;
  tabBar: HTMLElement;
  director: EffectDirector;
  themeManager: ThemeManager;
  /** 全てのセッションが閉じられたとき（ランチャー再表示用） */
  onAllClosed?: () => void;
}

const OUTPUT_BUFFER_MAX = 8192;

/** 出力に含まれた場合「シェル起動前の失敗」（認証・接続・ホスト鍵）とみなし、
    ラッパー拒否の自動フォールバックを行わない既知シグネチャ */
const PRE_SHELL_FAILURE_RE =
  /permission denied|authentication failed|host key verification|connection refused|connection timed out|operation timed out|no route to host|could not resolve hostname|name or service|network is unreachable|kex_exchange/i;

/** backend と同一オリジンから配信される前提。Vite dev(:5173) 時のみ :4040 へ向ける */
function wsBase(): string {
  const host = window.location.hostname || '127.0.0.1';
  const port = window.location.port === '5173' ? '4040' : window.location.port;
  return `ws://${host}:${port}`;
}

export class SessionManager {
  private deps: SessionManagerDeps;
  private sessions = new Map<string, SessionRecord>();
  private activeId: string | null = null;
  private seq = 0;

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
    this.renderTabs();
  }

  get active(): SessionRecord | null {
    return this.activeId ? this.sessions.get(this.activeId) ?? null : null;
  }

  get all(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  // ---------- セッション生成 ----------

  createLocal(): SessionRecord {
    return this.createSession({ kind: 'local', label: `local ${++this.seq}` });
  }

  createSsh(profile: SshProfileInfo): SessionRecord {
    return this.createSession({
      kind: 'ssh',
      label: profile.name || `${profile.user}@${profile.host}`,
      sshProfileId: profile.id,
      sshTarget: `${profile.user}@${profile.host}:${profile.port}`,
    });
  }

  private createSession(init: {
    kind: 'local' | 'ssh';
    label: string;
    sshProfileId?: string;
    sshTarget?: string;
  }): SessionRecord {
    const { token, viewsHost, director, themeManager } = this.deps;
    const sessionId = `session-${Math.random().toString(36).slice(2, 10)}`;

    const view = document.createElement('div');
    view.className = 'session-view hidden';
    viewsHost.appendChild(view);

    const record = {
      id: sessionId,
      kind: init.kind,
      label: init.label,
      sshProfileId: init.sshProfileId,
      sshTarget: init.sshTarget,
      state: 'connecting',
      osc133Armed: false,
      fxState: init.kind === 'ssh' ? 'await-ready' : 'idle',
      fxDisplay: init.kind === 'ssh' ? 'init' : 'off',
      sshPlain: false,
      sawShellReady: false,
      fxGen: 0,
      lastOutputAt: 0,
      lastUserInputAt: 0,
      injectLine1At: 0,
      connectAt: performance.now(),
      fxTimers: [],
      view,
    } as unknown as SessionRecord;

    // events WS（セッション個別の制御面: resize/theme/close）
    const eventsWs = new WebSocket(
      `${wsBase()}/ws/events?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`
    );
    record.eventsWs = eventsWs;
    eventsWs.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'session_closed') {
          this.markClosed(record, msg.exitCode);
        }
      } catch {}
    };

    // pty WS URL（SSH の場合はプロファイルIDを付与 — 秘密情報は含めない）
    const params = new URLSearchParams({ token, sessionId });
    if (init.kind === 'ssh' && init.sshProfileId) {
      params.set('sshProfile', init.sshProfileId);
    } else {
      const ic = themeManager.getInputColorAnsi();
      const pc = themeManager.getPromptColorAnsi();
      if (ic) params.set('inputColor', ic);
      if (pc) params.set('promptColor', pc);
    }
    const ptyWsUrl = `${wsBase()}/ws/pty?${params.toString()}`;

    const inputWatcher = new InputWatcher({
      sessionId,
      onCandidate: (evt) => director.handleCandidate(evt),
      onCancel: () => director.cancelCandidate(),
    });

    record.inputWatcher = inputWatcher;
    record.pendingExec = null;
    record.execSeq = 0;
    record.outputBuffer = '';
    record.typedBuf = '';
    record.lastTypedLine = '';
    record.lastTypedAt = 0;
    record.ctrlDAt = 0;
    record.lastOscEventAt = 0;
    record.injectPlan = null;

    // エスケープシーケンス（矢印キー等の CSI/SS3）追跡状態。
    // シーケンス中の '[' 'A' 等が行バッファを汚染しないよう終端まで吸収する
    let inEscSeq = false;
    const terminal = new TerminalManager({
      container: view,
      wsUrl: ptyWsUrl,
      onDataInput: (data) => {
        record.lastUserInputAt = performance.now();
        inputWatcher.handleInput(data);
        // ログアウト判定用の行入力追跡。Ctrl-D は空バッファ時（= プロンプトでの EOF）のみ記録
        for (const ch of data) {
          if (inEscSeq) {
            // CSI/SS3 の終端バイト（@ - ~）まで吸収
            if (ch >= '@' && ch <= '~') inEscSeq = false;
            continue;
          }
          if (ch === '\x1b') { inEscSeq = true; continue; }
          if (ch === '\x04') {
            if (record.typedBuf === '') record.ctrlDAt = performance.now();
            continue;
          }
          if (ch === '\r' || ch === '\n') {
            record.lastTypedLine = record.typedBuf;
            record.lastTypedAt = performance.now();
            record.typedBuf = '';
          } else if (ch === '\x7f' || ch === '\b') {
            record.typedBuf = record.typedBuf.slice(0, -1);
          } else if (ch >= ' ') {
            record.typedBuf += ch;
          } else {
            // 制御文字（Ctrl+C 等） → 行入力を中断してバッファを捨てる
            record.typedBuf = '';
          }
        }
      },
      onPtyOutput: (data) => {
        record.lastOutputAt = performance.now();
        record.outputBuffer = (record.outputBuffer + data).slice(-OUTPUT_BUFFER_MAX);
      },
      onDopaMarker: (payload) => this.handleDopaMarker(record, payload),
      onOsc133Command: (action, payload) => {
        // 終了済みセッションへの遅延イベントは破棄
        // （exit 時にシェルが発行した 133;C が session_closed より後に届き、
        //   チャレンジバナー等を再表示させるレースを防ぐ）
        if (record.state === 'closed') return;
        // SSH: フック未注入のリモートからの OSC 133 は信頼せず無視する。
        // （リモートプログラムが任意に出力し得るため、明示的有効化が信頼境界）
        if (record.kind === 'ssh' && !record.osc133Armed) return;
        record.lastOscEventAt = performance.now();
        if (action === 'C') {
          const cmdLine = payload.startsWith('cmd=') ? payload.slice(4) : payload;
          const firstWord = cmdLine.trim().split(/\s+/)[0] || '';
          record.pendingExec = {
            executionId: `${sessionId}-exec-${++record.execSeq}`,
            command: commandTypeFromName(firstWord),
            commandLine: cmdLine,
            startTimeMs: performance.now(),
          };
          record.outputBuffer = '';
          // ネストシェル系コマンドの実行中は、現シェルのフック状態が
          // 確実でないため「未確認」表示にする（イベント処理は通常どおり）
          if (record.osc133Armed && SHELL_NEST_RE.test(firstWord)) {
            record.fxDisplay = 'unverified';
            this.renderTabs();
          }
          director.handleStarted({
            type: 'command_started',
            command: record.pendingExec.command,
            commandLine: cmdLine,
            executionId: record.pendingExec.executionId,
            attemptNumber: record.execSeq,
            timestamp: Date.now(),
            sessionId,
          });
          inputWatcher.reset();
        } else if (action === 'D') {
          if (!record.pendingExec) return;
          const finished = record.pendingExec;
          record.pendingExec = null;
          const rawExitCode = parseInt(payload, 10);
          director.handleFinished({
            type: 'command_finished',
            command: finished.command,
            executionId: finished.executionId,
            exitCode: isNaN(rawExitCode) ? null : rawExitCode,
            outputTail: extractOutputTail(record.outputBuffer),
            durationMs: Math.max(0, Math.round(performance.now() - finished.startTimeMs)),
            timestamp: Date.now(),
            sessionId,
          });
          record.outputBuffer = '';
          if (record.fxDisplay === 'unverified') {
            record.fxDisplay = 'on';
            this.renderTabs();
          }
        }
      },
      onResize: (cols, rows) => {
        if (eventsWs.readyState === WebSocket.OPEN) {
          eventsWs.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      },
    });
    record.terminal = terminal;
    record.tabEl = document.createElement('div');
    this.sessions.set(sessionId, record);

    // テーマ適用（xterm オプション + shell 配色ファイル）
    const theme = themeManager.getTheme();
    terminal.applyTheme(theme.xtermTheme);
    if (theme.cursorStyle) terminal.applyCursorStyle(theme.cursorStyle);
    eventsWs.onopen = () => {
      eventsWs.send(JSON.stringify({
        type: 'shell_theme',
        inputColor: themeManager.getInputColorAnsi(),
        promptColor: themeManager.getPromptColorAnsi(),
      }));
    };

    if (init.kind === 'ssh') {
      this.fxLog(record, `connect-start target=${init.sshTarget}`);
    }
    terminal.connect(ptyWsUrl);
    this.renderTab(record);
    this.activate(sessionId);
    return record;
  }

  // ---------- SSH エフェクト自動有効化 ----------

  /**
   * 内部プロトコル OSC 5901 のマーカー処理。
   * R(ready): リモートコマンドラッパーが認証後に発行 → 注入シーケンス開始
   * W(wait): 読み取り行が実行を開始した ACK → この後だけペイロード送信可
   * A(armed): フックスクリプトの確立確認 → OSC 133 を受理開始
   * F(fail): ペイロード受信が期待長と不一致 → 初期化失敗として終了
   * U(unsupported): 非対応シェル → 通常ターミナルとして継続
   */
  /** 初期化診断ログ（秘密情報・ペイロード内容は記録しない） */
  private fxLog(rec: SessionRecord, stage: string, detail = '') {
    const t = Math.round(performance.now() - rec.connectAt);
    console.log(`[fx] ${rec.id} gen=${rec.fxGen} t=${t}ms state=${rec.fxState} ${stage}${detail ? ` ${detail}` : ''}`);
  }

  private handleDopaMarker(rec: SessionRecord, payload: string) {
    if (rec.kind !== 'ssh' || rec.state === 'closed') return;
    const code = payload.split(';')[0].trim();
    this.fxLog(rec, `marker:${code || '?'}`);
    if (code === MARKER_SHELL_READY) {
      rec.sawShellReady = true;
    }
    if (code === MARKER_SHELL_READY && rec.fxState === 'await-ready') {
      rec.fxState = 'injecting';
      rec.fxDisplay = 'init';
      this.renderTabs();
      this.runInjection(rec);
    } else if (code === MARKER_FX_VREAD && rec.fxState === 'await-vread') {
      // 外側 read -s が起動 — 以後の入力は無エコー。フェーズ1 行を送る
      // （エコーは V より先に到着済みのはずなので抑制を解除して残りを流す）
      rec.terminal.clearEchoSuppress();
      rec.fxState = 'await-reader';
      rec.injectLine1At = performance.now();
      try {
        rec.terminal.sendInput(rec.injectPlan?.line ?? '');
      } catch (e) {
        this.failInjection(rec, `FX 初期化エラー（${String(e)}）`);
        return;
      }
      this.fxLog(rec, 'line1-sent');
    } else if (code === MARKER_FX_WAIT && rec.fxState === 'await-reader') {
      this.sendPayload(rec);
    } else if (code === MARKER_FX_ARMED) {
      this.clearFxTimers(rec);
      rec.fxState = 'armed';
      rec.osc133Armed = true;
      rec.fxDisplay = 'on';
      this.showFxPill(rec, '🎰 FX ON');
      this.renderTabs();
    } else if (code === MARKER_FX_FAIL) {
      this.failInjection(rec, 'FX 初期化失敗（通常のSSH操作は可能）');
    } else if (code === MARKER_UNSUPPORTED) {
      this.clearFxTimers(rec);
      rec.fxState = 'off';
      rec.fxDisplay = 'off';
      this.showFxPill(rec, 'エフェクト未対応シェル（通常のSSH操作は可能）');
      this.renderTabs();
    }
  }

  /** 初期化失敗: 状態を off/fail にして通常SSHとして継続（再送しない） */
  private failInjection(rec: SessionRecord, message: string) {
    if (rec.fxState === 'off' || rec.fxState === 'armed' || rec.state === 'closed') return;
    this.fxLog(rec, `fail reason="${message}"`);
    this.clearFxTimers(rec);
    // エコー抑制の残留を解除（保留バイトは実出力なので端末へ書き戻される）
    rec.terminal.clearEchoSuppress();
    rec.fxState = 'off';
    rec.fxDisplay = 'fail';
    this.showFxPill(rec, message);
    this.renderTabs();
  }

  /**
   * 出力静止を検出してからフェーズ1（読み取り行）を送る。
   * ペイロードは送らない — reader 起動 ACK (OSC 5901;W) を受け取ってから
   * sendPayload で送る。出力静止や固定時間だけを準備完了の根拠にしない。
   * フェーズ1 は 1 接続世代につき 1 回だけ送る（fxState 遷移で保証）。
   * ユーザー入力中は注入を遅延し、上限を超えたら今回は諦める
   * （通常の SSH 操作を妨げないことが優先）。
   */
  private runInjection(rec: SessionRecord) {
    const QUIET_MS = 140;
    const INPUT_GUARD_MS = 800;
    const MAX_TOTAL_MS = 20000;
    const started = performance.now();

    const poll = () => {
      if (rec.fxState === 'off' || rec.fxState === 'armed' || rec.state === 'closed') return;
      const now = performance.now();
      if (now - started > MAX_TOTAL_MS) {
        this.failInjection(rec, 'FX 自動有効化タイムアウト（通常のSSH操作は可能）');
        return;
      }
      if (rec.fxState !== 'injecting') return; // await-reader 以降へ進行済み
      const quiet = now - rec.lastOutputAt >= QUIET_MS;
      const idle = now - rec.lastUserInputAt >= INPUT_GUARD_MS;
      if (quiet && idle) {
        // フェーズ0: 外側読み取り行（V ACK + read -s）。この行だけがエコー
        // されるため、送信内容と完全一致のみ端末描画から除去する。
        // 'await-vread' へ遷移してから送るので、この poll が再度走っても
        // 二重送信されない
        rec.fxState = 'await-vread';
        try {
          // プランは世代ごとに1回生成（outer/line/payload で同一内容を保証し、
          // 注入中のテーマ変更で受信長が不整合にならないようにする）。
          // 配色は既存フックスクリプトへの変数前置のみ — 新規フック注入や
          // リモートファイル配置は行わない
          rec.injectPlan = buildInjectionPlan({
            inputColor: this.deps.themeManager.getInputColorAnsi(),
            promptColor: this.deps.themeManager.getPromptColorAnsi(),
          });
          // エコー対象は末尾改行を除いた行テキスト（改行は抑制器側で別途消費）
          rec.terminal.suppressNextEcho(rec.injectPlan.outer.replace(/\n$/, ''));
          rec.terminal.sendInput(rec.injectPlan.outer);
        } catch (e) {
          // ペイロード生成失敗等の例外でも FX… 固着にしない
          this.failInjection(rec, `FX 初期化エラー（${String(e)}）`);
          return;
        }
        this.fxLog(rec, 'outer-sent');
        // V/W ACK が来なければ失敗（以後の行は送らないので
        // 通常シェルへの漏出は起こらない）
        rec.fxTimers.push(setTimeout(() => {
          if (rec.fxState === 'await-vread' || rec.fxState === 'await-reader') {
            this.failInjection(rec, 'FX 初期化応答なし（通常のSSH操作は可能）');
          }
        }, 10000));
        return;
      }
      rec.fxTimers.push(setTimeout(poll, 80));
    };
    poll();
  }

  /**
   * フェーズ2: reader 起動 ACK (W) 受信後にだけ呼ばれるペイロード送信。
   * W 到着までにユーザー入力があった場合は、入力が read に取り込まれて
   * ペイロード受信が壊れるのを避けるため終端行+終端記号のみ送って中止する
   * （`: __DOPA_END__` はプロンプトに出ても no-op 組み込みで無害）。
   */
  private sendPayload(rec: SessionRecord) {
    rec.fxState = 'await-armed';
    const plan = rec.injectPlan ?? buildInjectionPlan();
    if (rec.lastUserInputAt > rec.injectLine1At) {
      this.fxLog(rec, 'abort:user-input-during-init');
      rec.terminal.sendInput(`${INJECT_END_LINE}\n\x1e`);
      // リモート側は受信長不一致で F を返す → failInjection へ
      return;
    }
    this.fxLog(rec, 'payload-sent');
    try {
      rec.terminal.sendInput(plan.payload);
    } catch (e) {
      this.failInjection(rec, `FX 初期化エラー（${String(e)}）`);
      return;
    }
    // ARMED 確認タイムアウト（F マーカーが先行した場合はそちらで失敗処理）
    rec.fxTimers.push(setTimeout(() => {
      if (rec.fxState === 'await-armed') {
        this.failInjection(rec, 'FX 有効化なし（通常のSSH操作は可能）');
      }
    }, 8000));
  }

  private clearFxTimers(rec: SessionRecord) {
    for (const t of rec.fxTimers) clearTimeout(t);
    rec.fxTimers = [];
  }

  /** 注入結果をさりげなく表示する一時ピル（自動で消える・操作不要） */
  private showFxPill(rec: SessionRecord, text: string) {
    rec.view.querySelector('.ssh-arm-banner')?.remove();
    const pill = document.createElement('div');
    pill.className = 'ssh-arm-banner';
    const label = document.createElement('span');
    label.textContent = text;
    pill.appendChild(label);
    rec.view.appendChild(pill);
    setTimeout(() => {
      pill.classList.add('fade');
      setTimeout(() => pill.remove(), 600);
    }, 2600);
  }

  // ---------- 表示制御 ----------

  activate(sessionId: string) {
    const rec = this.sessions.get(sessionId);
    if (!rec) return;
    this.activeId = sessionId;
    for (const s of this.sessions.values()) {
      s.view.classList.toggle('hidden', s.id !== sessionId);
      s.tabEl.classList.toggle('active', s.id === sessionId);
    }
    // 表示後に fit しないとサイズが 0 になる
    requestAnimationFrame(() => {
      rec.terminal.fit();
      rec.terminal.focus();
    });
    this.renderTabs();
  }

  fitActive() {
    this.active?.terminal.fit();
  }

  private renderTab(rec: SessionRecord) {
    const tab = rec.tabEl;
    tab.className = `session-tab kind-${rec.kind} state-${rec.state}`;
    const icon = rec.kind === 'ssh' ? '🔑' : '💻';
    tab.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = `${icon} ${rec.label}`;
    label.title = rec.sshTarget ?? rec.label;
    tab.appendChild(label);
    if (rec.state === 'closed') {
      const re = document.createElement('span');
      re.className = 'tab-status';
      re.textContent = '切断';
      tab.appendChild(re);
    } else if (rec.kind === 'ssh') {
      // エフェクト状態チップ（確定した事実のみ表示）
      const chip = document.createElement('span');
      const fxText: Record<SessionRecord['fxDisplay'], string> = {
        init: 'FX…', on: 'FX', off: 'FX OFF', fail: 'FX !', unverified: 'FX ?',
      };
      const fxTitle: Record<SessionRecord['fxDisplay'], string> = {
        init: 'エフェクト初期化中',
        on: 'エフェクト有効（リモートフック確認済み）',
        off: 'エフェクト無効（通常のSSH操作は可能）',
        fail: '初期化失敗（通常のSSH操作は可能）',
        unverified: 'ネストシェル実行中 — 現シェルのフック状態は未確認',
      };
      chip.className = `fx-chip fx-${rec.fxDisplay}`;
      chip.textContent = fxText[rec.fxDisplay];
      chip.title = fxTitle[rec.fxDisplay];
      tab.appendChild(chip);
    }
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'セッションを閉じる';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close(rec.id);
    });
    tab.appendChild(close);
    tab.addEventListener('click', () => this.activate(rec.id));
  }

  private renderTabs() {
    const bar = this.deps.tabBar;
    bar.innerHTML = '';
    for (const s of this.sessions.values()) {
      this.renderTab(s);
      bar.appendChild(s.tabEl);
    }
    const plus = document.createElement('button');
    plus.id = 'tab-plus';
    plus.className = 'session-tab tab-plus';
    plus.textContent = '＋';
    plus.title = '新しい接続';
    plus.addEventListener('click', () => {
      document.getElementById('launcher')?.classList.remove('hidden');
    });
    bar.appendChild(plus);
    const hasTabs = this.sessions.size > 0;
    bar.classList.toggle('hidden', !hasTabs);
    document.getElementById('app')?.classList.toggle('has-tabs', hasTabs);
    // タブバーの出現/消滅でターミナル領域が変わるため refit
    if (hasTabs) {
      requestAnimationFrame(() => this.active?.terminal.fit());
    }
  }

  // ---------- 状態変化 ----------

  private markClosed(rec: SessionRecord, exitCode?: number) {
    if (rec.state === 'closed') return;
    rec.state = 'closed';
    this.clearFxTimers(rec);

    // 切断時は未完了コマンド状態とフック有効化状態を破棄（イベント混入防止）。
    // pendingExec はログアウト判定（exit コマンド実行中に終了したか）に使うため退避
    const lastExec = rec.pendingExec;
    rec.pendingExec = null;
    rec.injectPlan = null;
    rec.osc133Armed = false;
    rec.fxState = rec.kind === 'ssh' ? 'off' : 'idle';
    rec.fxDisplay = 'off';
    this.fxLog(rec, `closed exitCode=${exitCode ?? '?'}`);
    rec.inputWatcher.reset();
    rec.view.querySelector('.ssh-arm-banner')?.remove();

    // 実行中コマンドの演出（バナー/マスコット/charge グロー）を停止する。
    // オーバーレイはグローバル共有のため、表示中演出の所有者がこの
    // セッションの場合にだけクリアする（他タブの演出は消さない）
    this.deps.director.endSession(rec.id);

    // 自動再接続は「ラッパーが実行されずに終了した」と明確に識別できる場合のみ:
    //   R マーカー未到達（= リモートコマンドが実行されなかった）
    //   + 接続後すぐ終了 + ユーザー入力なし + 明示的な非ゼロ終了コード
    //   + 出力に認証・接続失敗の既知シグネチャがない
    // exit・Ctrl-D・正常ログアウト・R 受信後の切断では絶対に自動再接続しない。
    const quickExit = performance.now() - rec.connectAt < 15000;
    const noUserInput = rec.lastUserInputAt === 0;
    const earlyFail =
      rec.kind === 'ssh' && !rec.sshPlain && !rec.sawShellReady &&
      quickExit && noUserInput && typeof exitCode === 'number' && exitCode !== 0;
    if (earlyFail) {
      // 最終出力は session_closed より後に届き得る（PTY WS とイベント WS は
      // 別ソケットで順序保証なし）。失敗シグネチャの到着を待ってから判定する
      const gen = rec.fxGen;
      window.setTimeout(() => {
        if (!this.sessions.has(rec.id) || rec.state !== 'closed' || rec.fxGen !== gen) return;
        if (PRE_SHELL_FAILURE_RE.test(rec.outputBuffer)) {
          this.fxLog(rec, 'early-exit with pre-shell failure signature → closed (no fallback)');
          this.showClosedUi(rec, exitCode);
        } else {
          this.fxLog(rec, `wrapper-rejected exitCode=${exitCode} → sshPlain fallback`);
          rec.sshPlain = true;
          rec.terminal.write('\r\n\x1b[33m[Dopaterm] リモートがシェルラッパーを受け付けませんでした。標準SSHで再接続します（エフェクトは無効）。\x1b[0m\r\n');
          this.reconnect(rec);
        }
      }, 250);
      this.renderTabs();
      return;
    }
    // 正常終了の判定: 終了コード 0、またはユーザーの明示的ログアウトを検出。
    // zsh/bash では引数なし exit が直前コマンドの終了ステータスを引き継ぐため、
    // 非ゼロ終了でも明示的ログアウトなら自動クローズする。
    //   - 実行中コマンドが exit/logout（OSC 133;C で確定・最も信頼できる）
    //   - 直近に exit/logout 行を Enter 確定し、その後コマンドイベントなし
    //   - プロンプト（空バッファ）での Ctrl-D 直後に終了
    // 終了コードだけではログアウトと推測しない。
    const now = performance.now();
    // 実行中コマンドが exit/logout（OSC 133;C で確定・最も信頼できる）。
    // bash の history 無効環境では cmd= が空になり得るため、その場合は
    // Enter 確定済みの入力行（= その C イベントを起こしたコマンド）を信用する
    const exitCmd =
      !!lastExec &&
      (/^\s*(exit|logout)\b/.test(lastExec.commandLine) ||
        (lastExec.commandLine.trim() === '' &&
          /^\s*(exit|logout)\b/.test(rec.lastTypedLine) &&
          rec.lastTypedAt > 0 && now - rec.lastTypedAt < 10000));
    // C イベント未到達（WS 順序逆転で破棄された等）の場合のフォールバック。
    // 「type後にOSCイベントなし」が必須 → 内側sshのexit等の古い入力行は
    // 直後のプロンプト再描画 D イベントで無効化され誤爆しない
    const typedLogout =
      /^\s*(exit|logout)\b/.test(rec.lastTypedLine) &&
      rec.lastTypedAt > 0 && now - rec.lastTypedAt < 10000 &&
      rec.lastTypedAt > rec.lastOscEventAt;
    const ctrlDLogout =
      rec.ctrlDAt > 0 && now - rec.ctrlDAt < 5000 &&
      rec.ctrlDAt > rec.lastOscEventAt;
    const explicitLogout = exitCmd || typedLogout || ctrlDLogout;
    this.fxLog(rec, `close-check exitCode=${exitCode ?? '?'} explicit=${explicitLogout}`);
    if (exitCode === 0 || explicitLogout) {
      this.close(rec.id);
      return;
    }
    this.showClosedUi(rec, exitCode);
  }

  /** 終了状態の表示（正常/異常の区別 + 再接続オーバーレイ） */
  private showClosedUi(rec: SessionRecord, exitCode?: number) {
    // 正常終了（ログアウト/Ctrl-D/exit → ssh 終了コード 0）と異常切断を区別
    const cleanExit = exitCode === 0;
    const reason = rec.kind === 'ssh'
      ? (cleanExit ? 'セッション終了（ログアウト）' : `切断されました (exitCode=${exitCode ?? '?'})`)
      : `セッション終了 (exitCode=${exitCode ?? '?'})`;
    rec.terminal.write(
      `\r\n\x1b[${cleanExit ? '36' : '31;1'}m[Dopaterm] ${reason}\x1b[0m\r\n`
    );
    if (rec.kind === 'ssh') {
      // SSH: 再接続ボタン（リモートプロセスは復元されない旨を明記）
      rec.terminal.write('\x1b[33mリモートの実行中プロセスは復元されません。新しい SSH セッションを開始します。\x1b[0m\r\n');
    }
    this.showReconnectOverlay(rec);
    this.renderTabs();
  }

  private showReconnectOverlay(rec: SessionRecord) {
    if (rec.view.querySelector('.reconnect-overlay')) return;
    const ov = document.createElement('div');
    ov.className = 'reconnect-overlay';
    const btn = document.createElement('button');
    btn.className = 'btn-neon';
    btn.textContent = rec.kind === 'ssh' ? 'SSH 再接続' : 'シェルを再起動';
    btn.addEventListener('click', () => {
      ov.remove();
      this.reconnect(rec);
    });
    ov.appendChild(btn);
    rec.view.appendChild(ov);
  }

  /** 同一 sessionId で再接続（サーバー側で新規 PTY/ssh が spawn される） */
  private reconnect(rec: SessionRecord) {
    rec.state = 'connecting';
    rec.connectAt = performance.now();
    rec.lastUserInputAt = 0;
    this.clearFxTimers(rec);
    // 新しいリモートシェルにはフックが入っていないため状態をリセット。
    // ラッパー経由なら再度 OSC 5901;R が届き自動注入が走る。
    rec.pendingExec = null;
    rec.outputBuffer = '';
    rec.osc133Armed = false;
    rec.sawShellReady = false;
    rec.injectLine1At = 0;
    rec.typedBuf = '';
    rec.lastTypedLine = '';
    rec.lastTypedAt = 0;
    rec.ctrlDAt = 0;
    rec.lastOscEventAt = 0;
    rec.injectPlan = null;
    rec.fxGen += 1;
    rec.fxState = rec.kind === 'ssh' && !rec.sshPlain ? 'await-ready' : 'idle';
    rec.fxDisplay = rec.kind === 'ssh' && !rec.sshPlain ? 'init' : 'off';
    this.fxLog(rec, `reconnect plain=${rec.sshPlain}`);
    const token = this.deps.token;
    const params = new URLSearchParams({ token, sessionId: rec.id });
    if (rec.kind === 'ssh' && rec.sshProfileId) {
      params.set('sshProfile', rec.sshProfileId);
      if (rec.sshPlain) params.set('sshPlain', '1');
    }
    const url = `${wsBase()}/ws/pty?${params.toString()}`;
    rec.terminal.write('\r\n\x1b[36m[Dopaterm] 再接続中…\x1b[0m\r\n');
    rec.terminal.connect(url);
    rec.state = 'connected';
    this.renderTabs();
  }

  close(sessionId: string) {
    const rec = this.sessions.get(sessionId);
    if (!rec) return;
    try {
      if (rec.eventsWs?.readyState === WebSocket.OPEN) {
        rec.eventsWs.send(JSON.stringify({ type: 'close_session' }));
      }
      rec.eventsWs?.close();
    } catch {}
    this.clearFxTimers(rec);
    // 表示中演出の所有者がこのセッションならクリア（他タブの演出は維持）
    this.deps.director.endSession(sessionId);
    rec.terminal.dispose();
    rec.view.remove();
    this.sessions.delete(sessionId);
    if (this.activeId === sessionId) {
      const next = this.sessions.keys().next().value;
      this.activeId = null;
      if (next) this.activate(next);
    }
    this.renderTabs();
    if (this.sessions.size === 0) this.deps.onAllClosed?.();
  }

  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }

  // ---------- テーマの全セッション反映 ----------

  applyThemeToAll() {
    const theme = this.deps.themeManager.getTheme();
    for (const s of this.sessions.values()) {
      s.terminal.applyTheme(theme.xtermTheme);
      if (theme.cursorStyle) s.terminal.applyCursorStyle(theme.cursorStyle);
      if (s.eventsWs?.readyState === WebSocket.OPEN) {
        s.eventsWs.send(JSON.stringify({
          type: 'shell_theme',
          inputColor: this.deps.themeManager.getInputColorAnsi(),
          promptColor: this.deps.themeManager.getPromptColorAnsi(),
        }));
      }
    }
  }

  /** ^X^R プロンプト再描画を「コマンド実行中でないローカルセッション」へ送る */
  refreshLocalPrompts() {
    for (const s of this.sessions.values()) {
      if (s.kind !== 'local') continue;
      if (s.pendingExec) continue;
      setTimeout(() => {
        if (!s.pendingExec) s.terminal.sendInput('\x18\x12');
      }, 120);
    }
  }
}
