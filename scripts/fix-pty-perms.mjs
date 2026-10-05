#!/usr/bin/env node
/**
 * postinstall: node-pty のプリビルド spawn-helper に実行権限を付与する（POSIX のみ）。
 * 以前の `chmod +x ... 2>/dev/null || true` は Windows の cmd.exe では失敗するため Node で実装。
 * 該当ファイルが無い・権限変更に失敗しても install は失敗させない。
 */
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  const root = join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', 'node-pty', 'prebuilds');
  if (existsSync(root)) {
    for (const dir of readdirSync(root)) {
      const helper = join(root, dir, 'spawn-helper');
      try {
        chmodSync(helper, statSync(helper).mode | 0o111);
      } catch {
        /* spawn-helper の無いプラットフォーム等は無視 */
      }
    }
  }
}
