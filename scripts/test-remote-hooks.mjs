#!/usr/bin/env node
/**
 * SSH リモート OSC 133 フック — 自動注入プロトコルの実機検証。
 *
 * 検証内容（client/terminal/remote-osc133.ts と server/ssh-profiles.ts
 * の実装と同一手順）:
 *   1. ラッパー `printf OSC5901;R; exec $SHELL -l` によるシェル起動検知
 *   2. 出力静止 → reader 行注入 → OSC5901;W ACK 受信 → `: ` 分割ペイロード
 *      （ペイロードがターミナルにエコーされないことを確認。
 *       W を受け取る前にペイロードを送る旧方式は、reader 未起動の状態で
 *       ペイロードがプロンプトへ漏れて初期化が壊れる不具合があった）
 *   3. フック確立確認 OSC 5901;A → true/false/不明コマンドで 133;C/D 発火
 *   4. vim が壊れないこと（alternate screen の出入り）
 *   5. 既存シェル設定との共存（bash: PROMPT_COMMAND/DEBUG 保持・
 *      zsh: 既存 preexec/precmd 保持）
 *   6. 注入中断・終端未着・壊れたペイロード時の復旧と F マーカー
 *   7. 実 SSH (localhost) E2E・ネストSSH・ProxyJump
 *
 * 実行: npm run test:remote
 * （node-pty / localhost sshd が利用できない環境では該当テストを SKIP）
 */
import fs from 'node:fs';

// ---- 検証対象をソースから抽出（実装と同期） ----
const src = fs.readFileSync(
  new URL('../client/terminal/remote-osc133.ts', import.meta.url), 'utf-8'
);
const scriptM = src.match(/export const REMOTE_OSC133_SCRIPT = `([\s\S]*?)`;/);
const planM = src.match(/const line = `([\s\S]*?)`;/);
const outerM = src.match(/const outer = `([\s\S]*?)`;/);
const endM = src.match(/INJECT_END_LINE = '([^']+)'/);
const chunkM = src.match(/INJECT_CHUNK_SIZE = (\d+)/);
if (!scriptM || !planM || !outerM || !endM || !chunkM) {
  console.log('FAIL: remote-osc133.ts から注入プロトコルを抽出できません');
  process.exit(1);
}
// remote-osc133.ts のテンプレート内で使われる定数を同値で定義して eval 可能にする
const OSC = '\\033]5901;';
const BEL = '\\007';
const MARKER_SHELL_READY = 'R';
const MARKER_FX_WAIT = 'W';
const MARKER_FX_VREAD = 'V';
const MARKER_FX_ARMED = 'A';
const MARKER_FX_FAIL = 'F';
const MARKER_UNSUPPORTED = 'U';
const SCRIPT = eval('`' + scriptM[1] + '`');
const INJECT_END_LINE = endM[1];
const INJECT_LINE_PREFIX = ': ';
const INJECT_READ_TIMEOUT = 8;
const OUTER = eval('`' + outerM[1] + '`');
const CHUNK = Number(chunkM[1]);
const B64 = Buffer.from(SCRIPT, 'utf-8').toString('base64');
const b64 = B64; // buildInjectionPlan の line テンプレート内で使われる変数名
const endBare = INJECT_END_LINE.slice(INJECT_LINE_PREFIX.length); // 同上
const LINE1 = eval('`' + planM[1] + '`');
// buildInjectionPlan のペイロード部と同じ分割（`: ` プレフィックス + 終端行。
// 行終端は \n — \r は ICRNL off の tty 状態で行境界にならない）
const payloadFor = (scriptText) => {
  const e = Buffer.from(scriptText, 'utf-8').toString('base64');
  return (e.match(new RegExp(`.{1,${CHUNK}}`, 'g')) || []).map((c) => ': ' + c).join('\n')
    + `\n${INJECT_END_LINE}\n\x1e`;
};
const PAYLOAD = payloadFor(SCRIPT);
const LINE1_FOR = (scriptText) =>
  LINE1.replace(`_n=${B64.length}`,
    `_n=${Buffer.from(scriptText, 'utf-8').toString('base64').length}`);

// ラッパー（server/ssh-profiles.ts REMOTE_SHELL_WRAPPER と同一形。
// ローカルシミュレーションでは exec 先シェルを明示する）
const wrapper = (shell) =>
  `printf '\\033]5901;R\\007' 2>/dev/null; exec "${shell}" -l`;

let pty;
try {
  pty = await import('node-pty');
  pty = pty.default ?? pty;
} catch {
  console.log('SKIP: node-pty が利用できません');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

function makeWatcher(getBuf) {
  return {
    async waitFor(re, timeout = 8000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (re.test(getBuf())) return true;
        await sleep(60);
      }
      return false;
    },
  };
}

/** クライアント runInjection + sendPayload と同じ手順:
 *  R 待ち → 出力静止 → outer → V ACK → line1（read -s で無エコー）→
 *  W ACK → payload（各段 ACK を見てからしか次を送らない） */
async function runInjection(proc, w, getBuf, line1 = LINE1, payload = PAYLOAD) {
  if (!(await w.waitFor(/\x1b\]5901;R\x07/, 10000))) return false;
  // 出力静止を検出（固定時間ではなく「直近出力が止まった」ことを確認）
  let prev = -1, quiet = 0;
  while (quiet < 4) {
    await sleep(60);
    const len = getBuf().length;
    quiet = len === prev ? quiet + 1 : 0;
    prev = len;
  }
  const vStart = getBuf().length;
  proc.write(OUTER);
  // 外側 read -s 起動 ACK (OSC 5901;V) を待つ
  let t0 = Date.now();
  while (!getBuf().slice(vStart).includes('\x1b]5901;V\x07')) {
    if (Date.now() - t0 > 10000) { console.log('  (debug) V ACK 未着:', JSON.stringify(getBuf().slice(vStart, vStart + 300))); return false; }
    await sleep(30);
  }
  const wStart = getBuf().length;
  proc.write(line1);
  // reader 起動 ACK (OSC 5901;W) を待つ — 出力静止や固定時間は根拠にしない
  t0 = Date.now();
  while (!getBuf().slice(wStart).includes('\x1b]5901;W\x07')) {
    if (Date.now() - t0 > 10000) { console.log('  (debug) W ACK 未着:', JSON.stringify(getBuf().slice(wStart, wStart + 300))); return false; }
    await sleep(30);
  }
  proc.write(payload);
  return true;
}

async function testShell(label, proc, { nestedSsh = false } = {}) {
  console.log(`\n=== ${label} ===`);
  let buf = '';
  proc.onData((d) => { buf += d; });
  const getBuf = () => buf;
  const w = makeWatcher(getBuf);

  if (!(await runInjection(proc, w, getBuf))) {
    check('READY マーカー (OSC 5901;R) 受信', false);
    proc.kill();
    return;
  }
  check('READY マーカー (OSC 5901;R) 受信', true);

  check('外側 read 起動 ACK (OSC 5901;V) 受信', buf.includes('\x1b]5901;V\x07'));
  check('reader 起動 ACK (OSC 5901;W) 受信', buf.includes('\x1b]5901;W\x07'));
  const armed = await w.waitFor(/\x1b\]5901;A\x07/, 6000);
  check('ARMED 確認 (OSC 5901;A)', armed, JSON.stringify(buf.slice(0, 300)));
  if (!armed) { proc.kill(); return; }
  check('b64 ペイロードが画面エコーされない', !buf.includes(B64.slice(0, 40)));
  check('F マーカーなし（受信長一致）', !buf.includes('\x1b]5901;F\x07'));
  // フェーズ0 外側行のみエコー・フェーズ1 以降は read -s で無エコー
  check('注入コマンド行は無エコー（read -s で取り込み）', !buf.includes('while read'));
  check('有効化メッセージ', /effects enabled/.test(buf));

  buf = '';
  proc.write('true\r');
  await w.waitFor(/133;D/, 4000);
  check('true → 133;C 開始', buf.includes('133;C'));
  check('true → 133;D;0 成功', buf.includes('133;D;0'));

  buf = '';
  proc.write('false\r');
  await w.waitFor(/133;D/, 4000);
  check('false → 133;D;1 失敗', buf.includes('133;D;1'));

  buf = '';
  proc.write('dopaterm-nonexistent-cmd\r');
  await w.waitFor(/133;D/, 4000);
  check('不明コマンド → 133;D;127', buf.includes('133;D;127'));

  buf = '';
  proc.write('echo hello-remote\r');
  await w.waitFor(/133;D/, 4000);
  check('echo → コマンド名が C に含まれる', buf.includes('cmd=echo'));

  buf = '';
  proc.write('vim\r');
  const vimIn = await w.waitFor(/\?1049h/, 5000);
  check('vim → alternate screen へ遷移', vimIn);
  proc.write('\x1b:q!\r');
  await w.waitFor(/133;D/, 5000);
  check('vim 終了 → 133;D 発火・シェル復帰', buf.includes('133;D'));

  if (nestedSsh) {
    buf = '';
    proc.write('ssh -tt -o BatchMode=yes -o ConnectTimeout=8 localhost\r');
    await w.waitFor(/133;C/, 5000);
    check('ネスト ssh 自体の 133;C 発火', buf.includes('133;C'));
    await sleep(2500);
    buf = '';
    proc.write('echo INNER_MARKER_CMD\r');
    await sleep(2000);
    check('内側シェルのコマンドはイベントを出さない（混同しない）',
      !buf.includes('133;D'), JSON.stringify(buf.slice(0, 200)));
    buf = '';
    proc.write('exit\r');
    await w.waitFor(/133;D/, 6000);
    check('ネスト ssh 終了 → 外側シェルが 133;D を発行', buf.includes('133;D'));
    buf = '';
    proc.write('true\r');
    await w.waitFor(/133;D/, 5000);
    check('復帰後も外側シェルのエフェクトは継続 (true → C/D)',
      buf.includes('133;C') && buf.includes('133;D;0'));
  }

  proc.kill();
}

// ---- 0) ローカル PTY プロトコルシミュレーション（zsh / bash） ----
for (const [shell, name] of [['/bin/zsh', 'local pty: zsh'], ['/bin/bash', 'local pty: bash']]) {
  const proc = pty.spawn(shell, ['-c', wrapper(shell)], {
    name: 'xterm-256color', cols: 100, rows: 30,
    cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' },
  });
  await testShell(name, proc);
}

// ---- 1) 既存シェル設定との共存 ----
{
  console.log('\n=== coexistence: bash (PROMPT_COMMAND + DEBUG trap 保持) ===');
  const proc = pty.spawn('/bin/bash', ['-c', wrapper('/bin/bash')], {
    name: 'xterm-256color', cols: 100, rows: 30,
    cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' },
  });
  let buf = '';
  proc.onData((d) => { buf += d; });
  const w = makeWatcher(() => buf);
  await w.waitFor(/\x1b\]5901;R\x07/, 10000);
  await sleep(600);
  // 既存設定を先に入れる
  proc.write("PROMPT_COMMAND='echo PC_ORIG_MARKER'\r");
  proc.write("trap 'echo DBG_ORIG_MARKER' DEBUG\r");
  await sleep(800);
  await runInjection(proc, w, () => buf);
  await w.waitFor(/\x1b\]5901;A\x07/, 6000);
  check('共存環境でも ARMED', /\x1b\]5901;A\x07/.test(buf));
  buf = '';
  proc.write("trap -p DEBUG; echo '---'; true\r");
  await w.waitFor(/133;D/, 5000);
  check('既存 DEBUG トラップが保持されている', buf.includes('DBG_ORIG_MARKER'));
  check('DEBUG トラップに既存+新規がチェインされている',
    buf.includes('dopaterm') && buf.includes('DBG_ORIG_MARKER'));
  check('既存 PROMPT_COMMAND が保持されている', buf.includes('PC_ORIG_MARKER'));
  check('共存時も 133;C/D が発火する', buf.includes('133;C') && buf.includes('133;D;0'));
  proc.kill();
}
{
  console.log('\n=== coexistence: zsh (既存 preexec/precmd 保持) ===');
  const proc = pty.spawn('/bin/zsh', ['-c', wrapper('/bin/zsh')], {
    name: 'xterm-256color', cols: 100, rows: 30,
    cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' },
  });
  let buf = '';
  proc.onData((d) => { buf += d; });
  const w = makeWatcher(() => buf);
  await w.waitFor(/\x1b\]5901;R\x07/, 10000);
  await sleep(600);
  proc.write("preexec() { echo ZPRE_ORIG; }\r");
  proc.write("precmd() { echo ZPCD_ORIG; }\r");
  await sleep(800);
  await runInjection(proc, w, () => buf);
  await w.waitFor(/\x1b\]5901;A\x07/, 6000);
  buf = '';
  proc.write('true\r');
  await w.waitFor(/133;D/, 5000);
  check('既存 preexec が保持されている', buf.includes('ZPRE_ORIG'));
  check('既存 precmd が保持されている', buf.includes('ZPCD_ORIG'));
  check('共存時も 133;C/D が発火する', buf.includes('133;C') && buf.includes('133;D;0'));
  proc.kill();
}

// ---- 1.5) 配色ヘッダ注入（既存フックへの変数前置・ファイル/永続変更なし） ----
for (const shell of ['/bin/zsh', '/bin/bash']) {
  console.log(`\n=== theme: 配色ヘッダ注入 (${shell}) ===`);
  const proc = pty.spawn(shell, ['-c', wrapper(shell)], {
    name: 'xterm-256color', cols: 100, rows: 30,
    cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' },
  });
  let buf = '';
  proc.onData((d) => { buf += d; });
  const w = makeWatcher(() => buf);
  const colored =
    `__dopaterm_input_color='226'\n__dopaterm_prompt_color='51'\n${SCRIPT}`;
  const ok = await runInjection(
    proc, w, () => buf, LINE1_FOR(colored), payloadFor(colored));
  const armed = ok && (await w.waitFor(/\x1b\]5901;A\x07/, 6000));
  check('配色付き注入でも ARMED', armed);
  if (!armed) { proc.kill(); continue; }
  buf = '';
  proc.write('echo "IC=$__dopaterm_input_color PC=$__dopaterm_prompt_color"\r');
  await w.waitFor(/IC=226 PC=51/, 5000);
  check('色変数がシェル内で有効（メモリのみ）', buf.includes('IC=226 PC=51'),
    JSON.stringify(buf.slice(-300)));
  buf = '';
  proc.write('true\r');
  await w.waitFor(/133;D/, 5000);
  check('プロンプト色が PS1 装飾として出力される', buf.includes('38;5;51'),
    JSON.stringify(buf.slice(-300)));
  proc.kill();
}

// ---- 2) 注入中断・異常系の復旧 ----
/** フェーズ0 outer を送って V ACK を待つ（read -s 起動確認） */
async function sendOuterAndWaitV(proc, getBuf) {
  const start = getBuf().length;
  proc.write(OUTER);
  const t0 = Date.now();
  while (!getBuf().slice(start).includes('\x1b]5901;V\x07')) {
    if (Date.now() - t0 > 8000) return false;
    await sleep(30);
  }
  return true;
}
{
  console.log('\n=== recovery: read 中の Ctrl-C 中断 ===');
  const proc = pty.spawn('/bin/zsh', ['-l'], {
    name: 'xterm-256color', cols: 100, rows: 30,
    cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' },
  });
  let buf = '';
  proc.onData((d) => { buf += d; });
  const w = makeWatcher(() => buf);
  await sleep(1200);
  await sendOuterAndWaitV(proc, () => buf);
  proc.write(LINE1);
  await sleep(300);
  proc.write(': AAAA\n');
  await sleep(300);
  proc.write('\x03'); // read 待ち中に中断
  await sleep(600);
  buf = '';
  proc.write('echo RECOVER_OK\r');
  await w.waitFor(/RECOVER_OK/, 4000);
  check('中断後もプロンプト操作できる', buf.includes('RECOVER_OK'));
  check('エコーが無効のまま残らない（入力が見える）', buf.includes('echo RECOVER_OK'));
  proc.kill();
}
{
  console.log('\n=== recovery: 終端行未着（read -t タイムアウトで復帰） ===');
  const proc = pty.spawn('/bin/bash', ['-l'], {
    name: 'xterm-256color', cols: 100, rows: 30,
    cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' },
  });
  let buf = '';
  proc.onData((d) => { buf += d; });
  const w = makeWatcher(() => buf);
  await sleep(1200);
  await sendOuterAndWaitV(proc, () => buf);
  proc.write(LINE1);
  await sleep(300);
  proc.write(': AAAA\n'); // 終端行を送らない
  buf = '';
  await sleep(9500); // read -st 8 のタイムアウト待ち
  check('受信長不一致で F マーカー発行', buf.includes('\x1b]5901;F\x07'),
    JSON.stringify(buf.slice(0, 300)));
  proc.write('echo TIMEOUT_OK\r');
  await w.waitFor(/TIMEOUT_OK/, 5000);
  check('read タイムアウト後もプロンプト操作できる', buf.includes('TIMEOUT_OK'));
  proc.kill();
}
{
  console.log('\n=== recovery: 壊れたペイロード（デコード/eval 失敗でも継続） ===');
  const proc = pty.spawn('/bin/zsh', ['-l'], {
    name: 'xterm-256color', cols: 100, rows: 30,
    cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' },
  });
  let buf = '';
  proc.onData((d) => { buf += d; });
  const w = makeWatcher(() => buf);
  await sleep(1200);
  await sendOuterAndWaitV(proc, () => buf);
  proc.write(LINE1);
  await sleep(300);
  proc.write(`: %%%INVALID%%%\n${INJECT_END_LINE}\n\x1e`);
  await sleep(800);
  buf = '';
  proc.write('echo DECODE_OK\r');
  await w.waitFor(/DECODE_OK/, 4000);
  check('デコード失敗後もプロンプト操作できる', buf.includes('DECODE_OK'));
  proc.kill();
}
{
  console.log('\n=== recovery: ペイロードがコマンドとして漏れても無害 ===');
  const proc = pty.spawn('/bin/zsh', ['-l'], {
    name: 'xterm-256color', cols: 100, rows: 30,
    cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color' },
  });
  let buf = '';
  proc.onData((d) => { buf += d; });
  const w = makeWatcher(() => buf);
  await sleep(1200);
  // read ループなしで直接ペイロード断片を送る（`: ` 始まり → no-op で無害のはず）
  buf = '';
  proc.write(': IyBEb3BhdGVybSByZW1vdGUgT1ND\n: __DOPA_END__\n');
  await sleep(600);
  proc.write('echo LEAK_OK\r');
  await w.waitFor(/LEAK_OK/, 4000);
  check('`: ` ペイロードは no-op として無害（command not found が出ない）',
    buf.includes('LEAK_OK') && !buf.includes('command not found') && !buf.includes('no such'),
    JSON.stringify(buf.slice(0, 300)));
  proc.kill();
}

// ---- 2b) 回帰: W ハンドシェイクの安定性（旧方式が実機で壊れたパスを反復検証） ----
{
  console.log('\n=== regression: W ゲート注入を実 SSH localhost で反復 ===');
  let wFails = 0;
  for (let i = 0; i < 3; i++) {
    const proc = pty.spawn('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-tt', 'localhost',
      `printf '\\033]5901;R\\007' 2>/dev/null; exec "\${SHELL:-/bin/sh}" -l`,
    ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
    let buf = '';
    proc.onData((d) => { buf += d; });
    const w = makeWatcher(() => buf);
    const ok = await runInjection(proc, w, () => buf);
    const armed = ok && (await w.waitFor(/\x1b\]5901;A\x07/, 6000));
    const leaked = buf.includes(B64.slice(0, 60));
    if (!(armed && !leaked)) wFails++;
    proc.kill();
  }
  check('実 SSH で W ゲート注入が 3/3 成功・漏出なし', wFails === 0, `${wFails} failed`);
}

// ---- 3) 実 SSH localhost E2E（BatchMode で鍵認証が通る場合のみ） ----
const sshProbe = pty.spawn('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6',
  '-o', 'StrictHostKeyChecking=accept-new', 'localhost', 'echo SSH_PROBE_OK',
], { name: 'xterm-256color', cols: 80, rows: 24, env: process.env });
let probeOut = '';
sshProbe.onData((d) => { probeOut += d; });
const probeOk = await new Promise((res) => {
  sshProbe.onExit(() => res(probeOut.includes('SSH_PROBE_OK')));
  setTimeout(() => res(false), 10000);
});

if (!probeOk) {
  console.log('\n=== ssh localhost ===\n  SKIP: localhost への非対話 SSH が使えません');
} else {
  for (const [shell, name] of [['${SHELL:-/bin/sh}', 'ssh localhost: login shell (zsh)'], ['/bin/bash', 'ssh localhost: bash']]) {
    const proc = pty.spawn('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-tt', 'localhost',
      `printf '\\033]5901;R\\007' 2>/dev/null; exec "${shell}" -l`,
    ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
    await testShell(name, proc, { nestedSsh: true });
  }

  // 踏み台経由（ssh -W による ProxyCommand チェイン — -J localhost は
  // "jumphost loop" で拒否されるため ProxyCommand で等価経路を検証。
  // リモートコマンドは最終接続先で実行される点は ProxyJump と同一）
  {
    const proc = pty.spawn('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
      '-o', 'ProxyCommand=ssh -W %h:%p -o BatchMode=yes localhost',
      '-tt', 'localhost',
      `printf '\\033]5901;R\\007' 2>/dev/null; exec "/bin/zsh" -l`,
    ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
    await testShell('ssh 踏み台経由 (ProxyCommand/-W): zsh', proc);
  }
}

// ---- 4) ログアウト系統の終了コード（自動再接続判定の前提） ----
{
  console.log('\n=== logout: 通常 exit → 終了コード 0 ===');
  const proc = pty.spawn('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-tt', 'localhost',
    `printf '\\033]5901;R\\007' 2>/dev/null; exec "\${SHELL:-/bin/sh}" -l`,
  ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
  let buf = '';
  let exitCode = null;
  proc.onData((d) => { buf += d; });
  proc.onExit((e) => { exitCode = e.exitCode; });
  const w = makeWatcher(() => buf);
  await w.waitFor(/\x1b\]5901;R\x07/, 10000);
  await sleep(1500);
  proc.write('exit\r');
  const t0 = Date.now();
  while (exitCode === null && Date.now() - t0 < 8000) await sleep(100);
  check('exit → ssh 終了コード 0（正常終了として識別可能）', exitCode === 0, `code=${exitCode}`);
}
{
  console.log('\n=== logout: 多段 ssh → 順次 exit ===');
  const proc = pty.spawn('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-tt', 'localhost',
    `printf '\\033]5901;R\\007' 2>/dev/null; exec "/bin/zsh" -l`,
  ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
  let buf = '';
  let exitCode = null;
  proc.onData((d) => { buf += d; });
  proc.onExit((e) => { exitCode = e.exitCode; });
  const w = makeWatcher(() => buf);
  await w.waitFor(/\x1b\]5901;R\x07/, 10000);
  await sleep(1500);
  proc.write('ssh -tt -o BatchMode=yes -o ConnectTimeout=8 localhost\r');
  await sleep(3000);
  check('内側 ssh 開始後も外側 PTY は生存', exitCode === null);
  buf = '';
  proc.write('exit\r'); // B → A へ戻る
  await sleep(2000);
  check('内側 exit で外側セッションは終了しない', exitCode === null);
  proc.write('exit\r'); // A 終了
  const t0 = Date.now();
  while (exitCode === null && Date.now() - t0 < 8000) await sleep(100);
  check('外側 exit → ssh 終了コード 0（正常終了として識別可能）', exitCode === 0, `code=${exitCode}`);
}
{
  console.log('\n=== logout: 失敗コマンド後の exit（終了コードの引き継ぎ） ===');
  const proc = pty.spawn('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-tt', 'localhost',
    `printf '\\033]5901;R\\007' 2>/dev/null; exec "/bin/zsh" -l`,
  ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
  let buf = '', exitCode = null;
  proc.onData((d) => { buf += d; });
  proc.onExit((e) => { exitCode = e.exitCode; });
  const w = makeWatcher(() => buf);
  await w.waitFor(/\x1b\]5901;R\x07/, 10000);
  await sleep(1500);
  proc.write('false\r');
  await sleep(1500);
  proc.write('exit\r');
  const t0 = Date.now();
  while (exitCode === null && Date.now() - t0 < 8000) await sleep(100);
  // zsh/bash: 引数なし exit は直前の $? を返すため非ゼロになり得る。
  // クライアントは終了コードではなく「exit コマンドの実行」で正常ログアウトを判定する。
  check('false → exit → シェルは終了する（終了コードは非ゼロになり得る）', exitCode !== null, `code=${exitCode}`);
  console.log(`    (info) exit code after false: ${exitCode}`);
}
{
  console.log('\n=== logout: Ctrl-D でのログアウト ===');
  const proc = pty.spawn('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-tt', 'localhost',
    `printf '\\033]5901;R\\007' 2>/dev/null; exec "/bin/zsh" -l`,
  ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
  let exitCode = null;
  proc.onData(() => {});
  proc.onExit((e) => { exitCode = e.exitCode; });
  const w = makeWatcher(() => '');
  await sleep(2500);
  proc.write('\x04'); // Ctrl-D
  const t0 = Date.now();
  while (exitCode === null && Date.now() - t0 < 8000) await sleep(100);
  check('Ctrl-D → ssh 終了コード 0（正常終了として識別可能）', exitCode === 0, `code=${exitCode}`);
}
{
  console.log('\n=== logout: 認証失敗（非ゼロ終了・R 未到達） ===');
  const proc = pty.spawn('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
    '-o', 'PreferredAuthentications=publickey',
    '-tt', 'dopaterm_no_such_user@localhost',
    `printf '\\033]5901;R\\007' 2>/dev/null; exec "/bin/zsh" -l`,
  ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
  let buf = '', exitCode = null;
  proc.onData((d) => { buf += d; });
  proc.onExit((e) => { exitCode = e.exitCode; });
  const t0 = Date.now();
  while (exitCode === null && Date.now() - t0 < 15000) await sleep(100);
  check('認証失敗 → 非ゼロ終了コード', exitCode !== null && exitCode !== 0, `code=${exitCode}`);
  check('認証失敗では R マーカーは届かない（ラッパー未実行と区別可能）',
    !buf.includes('\x1b]5901;R\x07'));
}
{
  console.log('\n=== logout: 接続失敗（sshd 未到達） ===');
  const proc = pty.spawn('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
    '-tt', '-p', '64999', 'localhost',
    `printf '\\033]5901;R\\007' 2>/dev/null; exec "/bin/zsh" -l`,
  ], { name: 'xterm-256color', cols: 100, rows: 30, env: process.env });
  let buf = '', exitCode = null;
  proc.onData((d) => { buf += d; });
  proc.onExit((e) => { exitCode = e.exitCode; });
  const t0 = Date.now();
  while (exitCode === null && Date.now() - t0 < 12000) await sleep(100);
  check('接続失敗 → 非ゼロ終了コード', exitCode !== null && exitCode !== 0, `code=${exitCode}`);
  check('接続失敗でも R マーカーは届かない', !buf.includes('\x1b]5901;R\x07'));
}

console.log(failures === 0 ? '\n=== ALL PASS ===' : `\n=== ${failures} FAILURES ===`);
process.exit(failures === 0 ? 0 : 1);
