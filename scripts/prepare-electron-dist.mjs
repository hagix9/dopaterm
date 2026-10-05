#!/usr/bin/env node
/**
 * build:backend の後半: Electron メインプロセス用ファイルを dist/ へ配置する。
 * 以前の `mkdir -p ... && cp ...` は Windows の cmd.exe では動かないため Node で実装。
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist', 'electron');

mkdirSync(out, { recursive: true });
for (const f of ['main.cjs', 'preload.cjs', 'nav-guard.cjs']) {
  copyFileSync(join(root, 'electron', f), join(out, f));
}
// dist/ 配下の tsc 出力（server/*.js）は CommonJS として読み込む
writeFileSync(join(root, 'dist', 'package.json'), JSON.stringify({ type: 'commonjs' }));
