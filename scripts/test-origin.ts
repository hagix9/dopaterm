/**
 * Origin 検証の回帰テスト（loopback Origin の厳密判定）
 * 実行: npm run test:origin
 *
 * 検証:
 *  - isAllowedOrigin（HTTP CORS と WebSocket upgrade 共通 helper）の許可/拒否一覧
 *  - isAllowedHost（DNS rebinding 対策の Host 判定）と、実際の HTTP / WebSocket 経路での拒否
 *  - Electron のナビゲーション判定（electron/nav-guard.cjs）の port prefix 攻撃などの拒否
 *  - 不正トークン試行でも、試行値・正規トークンがログ（console.*）へ出ない
 *  - 実際の HTTP 経路: 許可 Origin にだけ Access-Control-Allow-Origin が付く
 *  - 実際の WebSocket upgrade 経路: 不正 Origin は有効トークンでも拒否、
 *    Origin 無し（CLI 等）は従来どおり許可、トークン検証は維持
 *
 * バックエンドは空きポート（port 0）で自前起動するため、4040 等の既存サーバーには触れない。
 */
import * as http from 'node:http';
import { inspect } from 'node:util';
import WebSocket from 'ws';
import { createRequire } from 'node:module';
import { isAllowedOrigin, isAllowedHost } from '../server/origin.js';
import { startBackend } from '../server/index.js';

const { isSameOrigin } = createRequire(import.meta.url)('../electron/nav-guard.cjs') as {
  isSameOrigin: (navUrl: string, allowedOrigin: string) => boolean;
};

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

console.log('=== isAllowedHost (helper) ===');
const HOST_ALLOW = ['127.0.0.1:4040', 'localhost:4040', '127.0.0.1:5173', 'localhost:54321', '127.0.0.1', 'localhost'];
const HOST_DENY = [
  'evil.example', 'evil.example:4040', '127.0.0.1.evil.example', '127.0.0.1.evil.example:4040',
  'localhost.evil.example', 'localhost.evil.example:4040', 'evil-localhost.example', '127.0.0.10', '127.0.0.10:4040',
  '127.1', '0x7f.0.0.1', '[::1]:4040', 'user@127.0.0.1:4040', '127.0.0.1:4040/path', 'localhost.', 'LOCALHOST:4040',
  '127.0.0.1:99999', '127.0.0.1:', '', ' ', 'a b', '%%%', '127.0.0.1:80',
];
for (const h of HOST_ALLOW) check(`Host 許可: ${h}`, isAllowedHost(h) === true);
for (const h of HOST_DENY) check(`Host 拒否: ${JSON.stringify(h)}`, isAllowedHost(h) === false);

console.log('=== Electron navigation guard (electron/nav-guard.cjs) ===');
const AO = 'http://127.0.0.1:54321';
const NAV_ALLOW = [`${AO}/`, `${AO}`, `${AO}/?token=abc`, `${AO}/a/b?x=1#h`];
const NAV_DENY = [
  'http://127.0.0.1:543210/', // port prefix 攻撃
  'http://127.0.0.1:5432/',
  'http://127.0.0.1:54321.evil.example/', // 不正 port（parse 失敗）
  'http://127.0.0.1.evil.example:54321/', // hostname suffix 攻撃
  'http://127.0.0.1:54321@evil.example/', // userinfo 偽装（実ホストは evil.example）
  'http://evil.example/',
  'https://127.0.0.1:54321/', // scheme 違い
  'http://localhost:54321/',
  'file:///etc/passwd', 'about:blank', 'javascript:alert(1)', 'not a url', '',
];
for (const u of NAV_ALLOW) check(`navigation 許可: ${u}`, isSameOrigin(u, AO) === true);
for (const u of NAV_DENY) check(`navigation 拒否: ${JSON.stringify(u)}`, isSameOrigin(u, AO) === false);

// ---- 2. 実際の HTTP / WebSocket 経路 ----
// ログ出力の捕捉（トークン漏洩チェック用）。startBackend はこのプロセス内で動く。
const captured: string[] = [];
const origConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function startCapture() {
  for (const k of ['log', 'warn', 'error', 'info'] as const) {
    console[k] = (...a: unknown[]) => { captured.push(a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 5 }))).join(' ')); };
  }
}
function stopCapture() { Object.assign(console, origConsole); }

const backend = await startBackend({ port: 0 });
const { port, token } = backend;

function httpReq(method: string, path: string, origin?: string, hostHeader?: string): Promise<{ status: number; acao: string | undefined; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers.Origin = origin;
    if (hostHeader !== undefined) headers.Host = hostHeader;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, acao: res.headers['access-control-allow-origin'] as string | undefined, location: res.headers.location as string | undefined }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function wsTry(path: string, origin?: string, hostHeader?: string): Promise<'open' | 'rejected'> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers.Origin = origin;
    if (hostHeader !== undefined) headers.Host = hostHeader;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
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

  console.log('=== Host 検証（実経路 / DNS rebinding 対策） ===');
  for (const h of [`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173' /* Vite dev proxy は Host を転送する */]) {
    const r = await httpReq('GET', sess, undefined, h);
    check(`HTTP: 正規 Host を許可: ${h}`, r.status === 200, JSON.stringify(r));
    check(`WS: 正規 Host を許可: ${h}`, (await wsTry(ev(token), undefined, h)) === 'open');
  }
  for (const h of ['evil.example', `evil.example:${port}`, `127.0.0.1.evil.example:${port}`, `localhost.evil.example:${port}`, '127.0.0.10']) {
    const r = await httpReq('GET', sess, undefined, h);
    check(`HTTP: 不正 Host を拒否(403): ${h}`, r.status === 403, JSON.stringify(r));
    check(`WS: 不正 Host を拒否（有効トークンでも）: ${h}`, (await wsTry(ev(token), undefined, h)) === 'rejected');
  }
  const redir = await httpReq('GET', '/', undefined, 'evil.example');
  check("不正 Host では '/' のトークン付きリダイレクトが返らない（rebinding でのトークン取得を防ぐ）", redir.status === 403 && redir.location === undefined, JSON.stringify(redir));
  const okRedir = await httpReq('GET', '/', undefined, `127.0.0.1:${port}`);
  check("正規 Host の '/' は従来どおりトークン付きへ 302（ブラウザモード/smoke の前提）", okRedir.status === 302 && /token=[0-9a-f]{64}/.test(okRedir.location ?? ''));
  check('Host 検証後もサーバーは健在', (await wsTry(ev(token), 'http://127.0.0.1:4040')) === 'open');

  console.log('=== トークンのログ漏洩チェック ===');
  const attempt = 'LEAKCHECK' + 'f'.repeat(55);
  startCapture();
  try {
    await wsTry(ev(attempt), 'http://127.0.0.1:4040'); // 不正トークン
    await wsTry(ev(token), 'http://evil.example'); // 不正 Origin（有効トークン）
    await wsTry(ev(token), undefined, 'evil.example'); // 不正 Host（有効トークン）
    await httpReq('GET', `/api/session?token=${attempt}`);
  } finally { stopCapture(); }
  const logText = captured.join('\n');
  check('拒否ログが出力されている（検査が空振りでない）', /\[Security\] Rejected/.test(logText));
  check('試行された不正トークンの値がログに出ない', !logText.includes(attempt));
  check('正規トークンの値がログに出ない', !logText.includes(token));
} finally {
  await backend.close();
}

console.log(failures === 0 ? '\n=== ALL PASS ===' : `\n=== ${failures} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
