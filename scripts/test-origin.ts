/**
 * Origin 検証の回帰テスト（loopback Origin の厳密判定）
 * 実行: npm run test:origin
 *
 * 検証:
 *  - isAllowedOrigin（HTTP CORS と WebSocket upgrade 共通 helper）の許可/拒否一覧
 *  - 実際の HTTP 経路: 許可 Origin にだけ Access-Control-Allow-Origin が付く
 *  - 実際の WebSocket upgrade 経路: 不正 Origin は有効トークンでも拒否、
 *    Origin 無し（CLI 等）は従来どおり許可、トークン検証は維持
 *
 * バックエンドは空きポート（port 0）で自前起動するため、4040 等の既存サーバーには触れない。
 */
import * as http from 'node:http';
import WebSocket from 'ws';
import { isAllowedOrigin } from '../server/origin.js';
import { startBackend } from '../server/index.js';

// サーバーが固まってもテスト全体が止まらないようにする
setTimeout(() => { console.error('test-origin: watchdog timeout'); process.exit(2); }, 60000).unref();

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name} ${detail}`); }
}

// ---- 1. helper ----
console.log('=== isAllowedOrigin (helper) ===');
const ALLOW = [
  'http://127.0.0.1:4040',
  'http://localhost:4040',
  'http://127.0.0.1:5173', // Vite dev server
  'http://localhost:54321', // Electron の自動選択ポート
  'http://127.0.0.1',
  'http://localhost',
];
const DENY = [
  'http://127.0.0.1.evil.example',
  'http://127.0.0.1.evil.example:4040',
  'http://localhost.evil.example',
  'http://localhost.evil.example:4040',
  'http://evil-localhost.example',
  'http://127.0.0.10:4040',
  'http://127.0.0.1@evil.example',
  'http://evil.example@127.0.0.1:4040', // userinfo 付きは正規形ではない
  'http://127.0.0.1:4040/path',
  'http://127.1', // WHATWG が 127.0.0.1 に正規化する省略記法
  'http://0x7f.0.0.1',
  'http://[::1]:4040', // 現状の Dopaterm は IPv4 loopback のみ
  'https://example.com',
  'https://127.0.0.1:4040',
  'https://localhost:4040',
  'file:///etc/passwd',
  'ws://127.0.0.1:4040',
  'javascript:alert(1)',
  'null',
  'not-a-valid-origin',
  '',
  'http://',
  'http://localhost:99999', // 不正ポート
];
for (const o of ALLOW) check(`許可: ${o}`, isAllowedOrigin(o) === true);
for (const o of DENY) check(`拒否: ${JSON.stringify(o)}`, isAllowedOrigin(o) === false);
let threw = false;
try { for (const o of ['\u0000', '%%%', 'http://[', 'http://a b']) isAllowedOrigin(o); } catch { threw = true; }
check('malformed Origin で例外を投げない', !threw);

// ---- 2. 実際の HTTP / WebSocket 経路 ----
const backend = await startBackend({ port: 0 });
const { port, token } = backend;

function httpReq(method: string, path: string, origin?: string): Promise<{ status: number; acao: string | undefined }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, acao: res.headers['access-control-allow-origin'] as string | undefined }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function wsTry(path: string, origin?: string): Promise<'open' | 'rejected'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, origin === undefined ? {} : { headers: { Origin: origin } });
    const timer = setTimeout(() => { ws.terminate(); resolve('rejected'); }, 4000);
    ws.once('open', () => { clearTimeout(timer); ws.close(); resolve('open'); });
    ws.once('unexpected-response', () => { clearTimeout(timer); resolve('rejected'); });
    ws.once('error', () => { clearTimeout(timer); resolve('rejected'); });
  });
}

try {
  console.log('=== HTTP CORS（実経路） ===');
  const sess = `/api/session?token=${token}`;
  for (const o of ['http://127.0.0.1:4040', 'http://localhost:4040']) {
    const r = await httpReq('GET', sess, o);
    check(`許可 Origin に ACAO が付く: ${o}`, r.status === 200 && r.acao === o, JSON.stringify(r));
  }
  for (const o of ['http://127.0.0.1.evil.example', 'http://localhost.evil.example', 'http://evil-localhost.example',
                   'http://127.0.0.10:4040', 'https://example.com', 'not-a-valid-origin']) {
    const r = await httpReq('GET', sess, o);
    check(`不正 Origin に ACAO が付かない: ${o}`, r.acao === undefined, JSON.stringify(r));
  }
  const pre = await httpReq('OPTIONS', sess, 'http://127.0.0.1.evil.example');
  check('不正 Origin の preflight に ACAO が付かない', pre.acao === undefined, JSON.stringify(pre));
  const noOrigin = await httpReq('GET', sess);
  check('Origin 無しは従来どおり応答（ACAO なし）', noOrigin.status === 200 && noOrigin.acao === undefined, JSON.stringify(noOrigin));
  const badTok = await httpReq('GET', '/api/session?token=wrong', 'http://127.0.0.1:4040');
  check('HTTP: 不正トークンは許可 Origin でも 401', badTok.status === 401, JSON.stringify(badTok));

  console.log('=== WebSocket upgrade（実経路） ===');
  const ev = (t: string) => `/ws/events?token=${t}&sessionId=origin-test`;
  for (const o of ['http://127.0.0.1:4040', 'http://localhost:4040']) {
    check(`許可 Origin + 有効トークン → 接続可: ${o}`, (await wsTry(ev(token), o)) === 'open');
  }
  check('Origin 無し（CLI 等）+ 有効トークン → 接続可（従来仕様）', (await wsTry(ev(token))) === 'open');
  for (const o of ['http://127.0.0.1.evil.example', 'http://localhost.evil.example', 'http://evil-localhost.example',
                   'http://127.0.0.10:4040', 'https://example.com', 'not-a-valid-origin']) {
    check(`不正 Origin + 有効トークン → 拒否: ${o}`, (await wsTry(ev(token), o)) === 'rejected');
  }
  check('許可 Origin + 不正トークン → 拒否（トークン検証は維持）', (await wsTry(ev('0'.repeat(64)), 'http://127.0.0.1:4040')) === 'rejected');
  check('Origin 無し + 不正トークン → 拒否', (await wsTry(ev('wrong'))) === 'rejected');
  check('不正 Origin 拒否後もサーバーは健在', (await wsTry(ev(token), 'http://127.0.0.1:4040')) === 'open');
} finally {
  await backend.close();
}

console.log(failures === 0 ? '\n=== ALL PASS ===' : `\n=== ${failures} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
