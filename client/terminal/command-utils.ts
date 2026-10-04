/**
 * コマンド分類・PTY出力加工ユーティリティ
 * InputWatcher（入力候補）と main.ts（OSC 133 確定イベント）で分類規則を共有する
 */

import { CommandType } from '../types/events.js';

const KNOWN_COMMANDS: readonly CommandType[] = ['cp', 'mkdir', 'rm', 'git', 'cargo'];

/**
 * コマンドライン先頭語を CommandType に分類する。
 * 分類できない場合は 'unknown' を返す（成功・失敗の断定には使わない）。
 */
export function commandTypeFromName(firstWord: string): CommandType {
  const base = firstWord.trim();
  return (KNOWN_COMMANDS as readonly string[]).includes(base) ? (base as CommandType) : 'unknown';
}

/**
 * PTY 出力から ANSI エスケープシーケンスを除去する。
 * PTY は stdout/stderr を区別しないため、これは「出力末尾の抜粋」であり
 * 厳密な stderr ではないことに注意。
 */
export function stripAnsi(data: string): string {
  return data
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC (133等)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI
    .replace(/\x1b[()][0-9A-B]/g, '') // 文字セット指定
    .replace(/\x1b[@-_]/g, '') // その他2文字エスケープ
    .replace(/\r/g, '');
}

/**
 * 直前のPTY出力バッファから、エラー分類用の末尾抜粋を生成する。
 */
export function extractOutputTail(data: string, maxLines = 3, maxChars = 500): string {
  const lines = stripAnsi(data)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.slice(-maxLines).join('\n').slice(-maxChars);
}
