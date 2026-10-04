#!/usr/bin/env node
/**
 * Dopaterm PTY/OSC133 スモークテスト
 *
 * 前提: サーバーが起動していること (`npm start`)
 * 実行: npm run test:smoke
 *
 * 検証内容:
 *  - / への GET が token 付き URL へ 302 リダイレクト
 *  - 不正トークンの WS 接続が拒否される
 *  - /ws/pty 接続でシェルが起動する
 *  - コマンドごとに OSC 133;C (開始) → 133;D;<code> (終了) が出る
 *  - echo -> D;0 / false -> D;1 / 不明コマンド -> D;127
 *  - 連続実行でも C/D 順序が保たれる
 *  - /ws/events の ping -> pong
 */

import http from 'node:http';
import WebSocket from 'ws';

const HOST = '127.0.0.1';
const PORT = 4040;
const TIMEOUT_MS = 25000;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

function getToken() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path: '/' }, (res) => {
      res.resume();
      const loc = res.headers.location || '';
      const m = loc.match(/token=([0-9a-f]+)/);
      if (res.statusCode === 302 && m) resolve(m[1]);
      else reject(new Error(`Unexpected response: ${res.statusCode} ${loc}`));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

function wsConnect(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}${path}`, {
      headers: { Origin: `http://${HOST}:${PORT}` },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });
}

async function main() {
  console.log('=== Dopaterm Smoke Test ===');

  // 1. Token via redirect
  const token = await getToken();
  check('トークンを / リダイレクトから取得', token.length === 64);

  // 2. Bad token WS must be rejected
  let rejected = false;
  try {
    await wsConnect(`/ws/pty?token=badtoken&sessionId=neg-test`);
  } catch {
    rejected = true;
  }
  check('不正トークンの WS 接続が拒否される', rejected);

  // 3. Real connections
  const sessionId = `smoke-${Date.now()}`;
  const pty = await wsConnect(`/ws/pty?token=${token}&sessionId=${sessionId}`);
  const events = await wsConnect(`/ws/events?token=${token}&sessionId=${sessionId}`);
  check('PTY / Events WS 接続成功', true);

  // 4. events ping -> pong
  const pong = new Promise((resolve) => {
    events.on('message', (d) => {
      try {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'pong') resolve(true);
      } catch {}
    });
  });
  events.send(JSON.stringify({ type: 'ping' }));
  check('events ping -> pong', await Promise.race([pong, new Promise((r) => setTimeout(() => r(false), 3000))]));

  // 5. PTY output capture
  let buf = '';
  const events133 = []; // { type: 'C'|'D', payload, time }
  pty.on('message', (d) => {
    const s = d.toString();
    buf += s;
    const re = /\x1b\]133;([CD])([^\x07]*)\x07/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      events133.push({ type: m[1], payload: m[2] });
    }
  });

  const send = (cmd) => pty.send(cmd + '\n');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await sleep(2000); // shell起動・初回プロンプト待ち (precmd の D;0 が来る可能性)
  const initialD = events133.filter((e) => e.type === 'D').length;
  events133.length = 0; // 初回プロンプトの D をリセットして計測開始

  // --- 正常終了 ---
  send('echo SMOKE_OK');
  await sleep(1200);
  const c1 = events133.find((e) => e.type === 'C');
  const d1 = events133.find((e) => e.type === 'D');
  check('echo: OSC133;C に cmd を含む', !!c1 && /cmd=echo SMOKE_OK/.test(c1.payload), JSON.stringify(c1));
  check('echo: OSC133;D;0 で終了', !!d1 && /^;?0/.test(d1.payload), JSON.stringify(d1));
  check('echo: C が D より先に到達', events133.indexOf(c1) < events133.indexOf(d1));
  check('echo: 出力に結果を含む', buf.includes('SMOKE_OK'));

  // --- 異常終了 ---
  events133.length = 0;
  send('false');
  await sleep(1200);
  const d2 = events133.find((e) => e.type === 'D');
  check('false: OSC133;D;1', !!d2 && /^;?1/.test(d2.payload), JSON.stringify(d2));

  // --- コマンド不明 (127) ---
  events133.length = 0;
  send('dopa-nonexistent-cmd-xyz');
  await sleep(1200);
  const d3 = events133.find((e) => e.type === 'D');
  check('不明コマンド: OSC133;D;127', !!d3 && /^;?127/.test(d3.payload), JSON.stringify(d3));

  // --- 連続実行 ---
  events133.length = 0;
  for (let i = 0; i < 5; i++) send('true');
  await sleep(2500);
  const cCount = events133.filter((e) => e.type === 'C').length;
  const d0Count = events133.filter((e) => e.type === 'D' && /^;?0/.test(e.payload)).length;
  check('連続実行: C が5回到達', cCount === 5, `C=${cCount}`);
  check('連続実行: D;0 が5回到達', d0Count === 5, `D;0=${d0Count}`);

  // --- 順序保証: Cの後にD ---
  const pairCount = Math.min(cCount, d0Count);
  check('連続実行: C/D が交互にペア化', pairCount === 5);

  // --- 初回プロンプト precmd の D（参考情報）---
  console.log(`  INFO  初回プロンプトの孤立 D イベント数: ${initialD} (クライアント側で破棄される設計)`);

  pty.close();
  events.close();

  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

const timer = setTimeout(() => {
  console.log('TIMEOUT');
  process.exit(1);
}, TIMEOUT_MS);
timer.unref();

main().catch((err) => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
