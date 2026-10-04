import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { EchoSuppressor } from './echo-suppress.js';
import '@xterm/xterm/css/xterm.css';

export interface TerminalManagerOptions {
  container: HTMLElement;
  wsUrl: string;
  onOsc133Command: (type: string, payload: string) => void;
  /** 内部制御 OSC（リモートフックの準備/確立マーカー等）。SSH セッションのみ利用 */
  onDopaMarker?: (payload: string) => void;
  onDataInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  /** PTY からの生出力（term.write 前に通知。エラー分類用の出力末尾採取などに使用） */
  onPtyOutput?: (data: string) => void;
}

export class TerminalManager {
  private term: Terminal;
  private fitAddon: FitAddon;
  private ws: WebSocket | null = null;
  private options: TerminalManagerOptions;
  private isConnected = false;
  private disposed = false;
  /** 自分が送信した注入コマンドのエコーだけを除去する抑制器（通常出力は通す） */
  private echoSuppressor = new EchoSuppressor();

  constructor(options: TerminalManagerOptions) {
    this.options = options;

    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: '#0D0B14',
        foreground: '#EDEAF6',
        cursor: '#00F5D4',
        selectionBackground: 'rgba(255, 27, 141, 0.3)',
        black: '#171524',
        red: '#FF4757',
        green: '#2ED573',
        yellow: '#FFE600',
        blue: '#1E90FF',
        magenta: '#FF1B8D',
        cyan: '#00F5D4',
        white: '#EDEAF6',
      },
      // allowTransparency は指定しない（=false）。xterm.js の Canvas が
      // theme.background を確実に描画するようにするため
      // （透明だと CSS 側背景しか見えずテーマ変更が反映されない）。
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(options.container);
    this.fit();

    this.setupOsc133Handler();
    this.setupInputListener();
    this.setupResizeListener();
  }

  private setupOsc133Handler() {
    // OSC 133 Shell Integration handler
    // Returns true to hide/consume the OSC sequence from terminal display
    this.term.parser.registerOscHandler(133, (data) => {
      // data format: "A", "B", "C;cmd=cp -R a b", "D;0"
      const parts = data.split(';');
      const action = parts[0];
      const payload = parts.slice(1).join(';');
      this.options.onOsc133Command(action, payload);
      return true; // Consume! Do not show on screen
    });
    // Dopaterm 内部プロトコル（OSC 5901;R/A/U）。WS チャンク分割は
    // xterm パーサーが終端までバッファするためそのまま処理できる
    this.term.parser.registerOscHandler(5901, (data) => {
      this.options.onDopaMarker?.(data);
      return true;
    });
  }

  private setupInputListener() {
    this.term.onData((data) => {
      this.options.onDataInput(data);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
      }
    });
  }

  private setupResizeListener() {
    const resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    resizeObserver.observe(this.options.container);
  }

  public fit() {
    try {
      this.fitAddon.fit();
      if (this.term.cols && this.term.rows) {
        this.options.onResize(this.term.cols, this.term.rows);
      }
    } catch {}
  }

  public connect(wsUrl: string) {
    // 旧接続が残っていれば閉じる。旧 ws の遅延イベントが新接続に混入
    // しないよう、ハンドラ内で「現在の ws と同一か」を確認する
    // エコー抑制の保留バイトは実出力なので書き戻してから解除する
    const held = this.echoSuppressor.clear();
    if (held) this.term.write(held);
    try { this.ws?.close(); } catch {}
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.isConnected = true;
      this.fit();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws || this.disposed) return; // 旧世代/破棄後の遅延出力は破棄
      if (typeof event.data === 'string') {
        // onPtyOutput には生データを渡す（エラー分類・診断を歪めない）。
        // 端末描画のみ抑制器を通して、送信済み注入行のエコーだけを除去する
        this.options.onPtyOutput?.(event.data);
        this.term.write(this.echoSuppressor.feed(event.data));
      } else if (event.data instanceof Blob) {
        event.data.text().then((text) => {
          if (this.ws !== ws || this.disposed) return;
          this.options.onPtyOutput?.(text);
          this.term.write(this.echoSuppressor.feed(text));
        });
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws || this.disposed) return; // 旧世代/破棄後の切断通知は無視
      this.isConnected = false;
      this.term.write('\r\n\x1b[31;1m[Dopaterm PTY Session Disconnected]\x1b[0m\r\n');
    };

    ws.onerror = (err) => {
      console.error('[Terminal] WebSocket Error:', err);
    };
  }

  public write(text: string) {
    if (this.disposed) return;
    this.term.write(text);
  }

  /**
   * 次に届く PTY 出力から target と完全一致するエコー（+直後の改行1つ）を除去する。
   * SSH 注入コマンドのエコー非表示用。対象が見つからなければ何も消えない。
   */
  public suppressNextEcho(target: string) {
    this.echoSuppressor.arm(target);
  }

  /** 抑制を解除。保留中の実出力バイトは捨てずに端末へ書き戻す
   * （onPtyOutput は生データ経路で通知済みのため二重通知しない） */
  public clearEchoSuppress() {
    const rest = this.echoSuppressor.clear();
    if (rest) this.term.write(rest);
  }

  /** PTY へキー入力を送信（zsh の dopaterm_theme_refresh ウィジェット呼出し等に使用） */
  public sendInput(data: string) {
    if (this.disposed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  public focus() {
    this.term.focus();
  }

  public getDimensions() {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  public applyTheme(theme: any) {
    this.term.options.theme = theme;
  }

  public applyCursorStyle(style: 'block' | 'underline' | 'bar') {
    this.term.options.cursorStyle = style;
  }

  public get connected() {
    return this.isConnected;
  }

  /** セッション破棄（タブクローズ時）。WS と xterm インスタンスを解放する */
  public dispose() {
    this.disposed = true;
    try {
      this.ws?.close();
    } catch {}
    try {
      this.term.dispose();
    } catch {}
  }
}
