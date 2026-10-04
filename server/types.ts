export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export interface ClientSession {
  id: string;
  token: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface WsControlMessage {
  type: 'resize' | 'ping' | 'auth' | 'event' | 'shell_theme' | 'close_session';
  token?: string;
  cols?: number;
  rows?: number;
  event?: any;
  /** shell_theme: 実行中シェルの入力文字色/プロンプト色を更新（ANSI 色番号 or 色名） */
  inputColor?: string;
  promptColor?: string;
}
