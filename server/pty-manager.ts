import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { setupShellIntegration } from './shell-integration.js';
import { TerminalDimensions } from './types.js';

let ptyModule: any = null;
// 遅延ロード（top-level await を避け、ESM/CJS 両方のエミットで動作させる）
const ptyReady: Promise<void> = import('node-pty')
  .then((m: any) => {
    ptyModule = m?.default?.spawn ? m.default : m;
  })
  .catch((err: unknown) => {
    console.warn('⚠️ node-pty not available:', err);
  });

/** node-pty のロード完了を保証（セッション作成前に await する） */
export function ensurePtyReady(): Promise<void> {
  return ptyReady;
}

export interface IPtySession {
  readonly id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number, signal?: number) => void): void;
  dispose(): void;
  /** 実行中シェルの配色を更新（precmd が次回プロンプトで反映）。値は ANSI 色番号/色名 */
  setShellTheme?(colors: { inputColor?: string; promptColor?: string }): void;
}

function dirUsable(p: string | undefined | null): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * ローカルシェルセッションの初期 cwd をセッションごとに決定する。
 * - 明示指定が有効なディレクトリなら最優先
 * - Windows はユーザーホーム（os.homedir()）を既定とし、Electron の
 *   一時展開先やアプリ内部を初期 cwd にしない。ホームが使えない場合は
 *   USERPROFILE、それも不可なら fallbackCwd へ順にフォールバック
 * - macOS/Linux は従来どおりプロセスの cwd を維持
 */
export function resolveLocalShellCwd(
  explicitCwd?: string | null,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  fallbackCwd: string = process.cwd()
): string {
  if (explicitCwd && dirUsable(explicitCwd)) return explicitCwd;
  if (platform === 'win32') {
    if (dirUsable(home)) return home;
    if (dirUsable(process.env.USERPROFILE)) return process.env.USERPROFILE as string;
  }
  return fallbackCwd;
}

export function createPtySession(
  sessionId: string,
  initialDimensions: TerminalDimensions,
  extraEnv: Record<string, string> = {},
  initialCwd?: string
): IPtySession {
  const cwd = resolveLocalShellCwd(initialCwd);
  let defaultShell = process.env.SHELL;
  if (!defaultShell || !fs.existsSync(defaultShell)) {
    if (os.platform() === 'win32') {
      defaultShell = 'powershell.exe';
    } else if (fs.existsSync('/bin/zsh')) {
      defaultShell = '/bin/zsh';
    } else if (fs.existsSync('/bin/bash')) {
      defaultShell = '/bin/bash';
    } else {
      defaultShell = 'sh';
    }
  }

  const { env: baseEnv, args: shellArgs, themeFile, cleanup } = setupShellIntegration(defaultShell);
  const env = { ...baseEnv, ...extraEnv };

  // 実行中セッションの配色をプロンプト経由で更新するためのテーマファイル。
  // 初期値は起動時の extraEnv、以後はクライアントの theme_update で上書きされる。
  const VALID_COLOR = /^[a-zA-Z0-9]{1,12}$/;
  const writeThemeFile = (inputColor?: string, promptColor?: string) => {
    const lines: string[] = [];
    if (inputColor && VALID_COLOR.test(inputColor)) lines.push(`DOPATERM_INPUT_COLOR=${inputColor}`);
    if (promptColor && VALID_COLOR.test(promptColor)) lines.push(`DOPATERM_PROMPT_COLOR=${promptColor}`);
    try {
      fs.writeFileSync(themeFile, lines.join('\n') + '\n', 'utf-8');
    } catch {}
  };
  writeThemeFile(extraEnv.DOPATERM_INPUT_COLOR, extraEnv.DOPATERM_PROMPT_COLOR);

  const setShellTheme = (colors: { inputColor?: string; promptColor?: string }) => {
    writeThemeFile(colors.inputColor, colors.promptColor);
  };

  if (ptyModule && ptyModule.spawn) {
    try {
      const ptyProcess = ptyModule.spawn(defaultShell, shellArgs, {
        name: 'xterm-256color',
        cols: initialDimensions.cols || 80,
        rows: initialDimensions.rows || 24,
        cwd,
        env: env as { [key: string]: string },
      });

      return {
        id: sessionId,
        setShellTheme,
        write: (data: string) => ptyProcess.write(data),
        resize: (cols: number, rows: number) => {
          try {
            if (cols > 0 && rows > 0) ptyProcess.resize(cols, rows);
          } catch {}
        },
        onData: (cb) => ptyProcess.onData(cb),
        onExit: (cb) => {
          ptyProcess.onExit((e: { exitCode: number; signal?: number }) => {
            cleanup();
            cb(e.exitCode, e.signal);
          });
        },
        dispose: () => {
          try {
            ptyProcess.kill();
          } catch {}
          cleanup();
        },
      };
    } catch (err) {
      console.warn('⚠️ node-pty.spawn failed, falling back to child_process:', err);
    }
  }

  // Fallback to standard child_process spawn
  console.log('Using standard child_process fallback for session:', sessionId);
  const proc = spawn(defaultShell, [...shellArgs, '-i'], {
    cwd,
    env: env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    id: sessionId,
    setShellTheme,
    write: (data: string) => {
      try {
        proc.stdin?.write(data);
      } catch {}
    },
    resize: () => {},
    onData: (cb) => {
      proc.stdout?.on('data', (d: Buffer) => cb(d.toString('utf-8')));
      proc.stderr?.on('data', (d: Buffer) => cb(d.toString('utf-8')));
    },
    onExit: (cb) => {
      proc.on('close', (code: number) => {
        cleanup();
        cb(code ?? 0);
      });
    },
    dispose: () => {
      try {
        proc.kill();
      } catch {}
      cleanup();
    },
  };
}

/**
 * 任意コマンドを PTY で実行するセッション（SSH クライアント等）。
 * シェル統合（OSC 133 / テーマ注入）は適用しない — SSH 先の
 * コマンド終了結果は MVP では検出しない（スコア推測加算もしない）。
 */
export function createCommandSession(
  sessionId: string,
  file: string,
  args: string[],
  initialDimensions: TerminalDimensions
): IPtySession {
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  } as { [key: string]: string };

  if (ptyModule && ptyModule.spawn) {
    try {
      const ptyProcess = ptyModule.spawn(file, args, {
        name: 'xterm-256color',
        cols: initialDimensions.cols || 80,
        rows: initialDimensions.rows || 24,
        cwd: os.homedir(),
        env,
      });
      return {
        id: sessionId,
        write: (data: string) => ptyProcess.write(data),
        resize: (cols: number, rows: number) => {
          try {
            if (cols > 0 && rows > 0) ptyProcess.resize(cols, rows);
          } catch {}
        },
        onData: (cb) => ptyProcess.onData(cb),
        onExit: (cb) => {
          ptyProcess.onExit((e: { exitCode: number; signal?: number }) => cb(e.exitCode, e.signal));
        },
        dispose: () => {
          try {
            ptyProcess.kill();
          } catch {}
        },
      };
    } catch (err) {
      console.warn('⚠️ node-pty.spawn (command) failed, falling back to child_process:', err);
    }
  }

  // child_process フォールバック（PTY なし — 対話性は低下するが動作はする）
  console.log('Using child_process fallback for command session:', sessionId, file);
  const proc = spawn(file, args, {
    cwd: os.homedir(),
    env: env as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    id: sessionId,
    write: (data: string) => {
      try {
        proc.stdin?.write(data);
      } catch {}
    },
    resize: () => {},
    onData: (cb) => {
      proc.stdout?.on('data', (d: Buffer) => cb(d.toString('utf-8')));
      proc.stderr?.on('data', (d: Buffer) => cb(d.toString('utf-8')));
    },
    onExit: (cb) => {
      proc.on('close', (code: number) => cb(code ?? 0));
    },
    dispose: () => {
      try {
        proc.kill();
      } catch {}
    },
  };
}
