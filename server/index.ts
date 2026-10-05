import * as http from 'http';
import * as crypto from 'crypto';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createPtySession, createCommandSession, ensurePtyReady, IPtySession } from './pty-manager.js';
import { WsControlMessage } from './types.js';
import { isAllowedOrigin } from './origin.js';
import {
  loadProfiles, upsertProfile, deleteProfile, getProfile,
  validateProfileInput, buildSshArgs, SshProfile,
} from './ssh-profiles.js';

const HOST = '127.0.0.1'; // Strictly loopback only

export interface BackendHandle {
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

interface SessionEntry {
  pty: IPtySession;
  kind: 'local' | 'ssh';
  ptyWs?: WebSocket;
  eventsWs?: WebSocket;
}

/**
 * Dopaterm バックエンドを起動する。
 * ブラウザ版（`npm start`）と Electron メインプロセス内蔵の両方から使われる。
 * port=0 を渡すと空きポートが自動選択される（Electron 既定動作）。
 */
export async function startBackend(options: { port?: number; staticDir?: string } = {}): Promise<BackendHandle> {
  const PORT = options.port ?? (Number(process.env.DOPATERM_PORT) || 4040);
  // Generate a cryptographically secure random session token at startup
  const SERVER_SECRET_TOKEN = crypto.randomBytes(32).toString('hex');

  const readBody = (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 64 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });

  const server = http.createServer((req, res) => {
    void (async () => {
      // CORS check for loopback only
      const origin = req.headers.origin || '';
      if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const parsedUrl = url.parse(req.url || '', true);
      const clientToken = parsedUrl.query.token as string;
      const authed = clientToken === SERVER_SECRET_TOKEN;

      if (parsedUrl.pathname === '/api/session') {
        if (authed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'authenticated', valid: true }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing token' }));
        }
        return;
      }

      // ---- SSH プロファイル REST API（要トークン） ----
      const profileMatch = parsedUrl.pathname?.match(/^\/api\/ssh-profiles(?:\/([A-Za-z0-9_-]+))?$/);
      if (profileMatch) {
        if (!authed) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing token' }));
          return;
        }
        const profileId = profileMatch[1];
        try {
          if (req.method === 'GET' && !profileId) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ profiles: loadProfiles() }));
            return;
          }
          if ((req.method === 'POST' || req.method === 'PUT')) {
            const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
            const result = validateProfileInput(body, profileId || (typeof body.id === 'string' ? body.id : undefined));
            if (!result.ok) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: result.error }));
              return;
            }
            const profiles = upsertProfile(result.profile);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, profile: result.profile, profiles }));
            return;
          }
          if (req.method === 'DELETE' && profileId) {
            const profiles = deleteProfile(profileId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, profiles }));
            return;
          }
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message ?? 'Bad request' }));
          return;
        }
      }

      // Auto redirect / to /?token=... for loopback convenience
      if (parsedUrl.pathname === '/' && !parsedUrl.query.token) {
        res.writeHead(302, { Location: `/?token=${SERVER_SECRET_TOKEN}` });
        res.end();
        return;
      }

      // Serve static files from dist/client if available
      const distDir = options.staticDir ?? path.resolve(process.cwd(), 'dist/client');
      const requested = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname || '';
      const filePath = path.resolve(distDir, '.' + requested);

      // distDir 外へのパストラバーサルを拒否
      if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Dopaterm Local Backend Active. Connect via WebSocket with token.');
    })().catch((err) => {
      console.error('[HTTP] handler error:', err);
      try {
        res.writeHead(500);
        res.end('Internal error');
      } catch {}
    });
  });

  // Dual WebSocket Servers
  const wssPty = new WebSocketServer({ noServer: true });
  const wssEvents = new WebSocketServer({ noServer: true });

  // Active sessions: map sessionId -> session
  const sessions = new Map<string, SessionEntry>();
  // /ws/events は /ws/pty より先に接続され得るため、セッションの有無に関係なく
  // sessionId 単位で保持する（接続時点の sessions 参照に依存しない）
  const eventsSockets = new Map<string, WebSocket>();

  function validateRequest(req: http.IncomingMessage): boolean {
    const parsed = url.parse(req.url || '', true);
    const token = parsed.query.token as string;

    // 1. Origin verification
    const origin = req.headers.origin;
    if (origin) {
      if (!isAllowedOrigin(origin)) {
        console.warn(`[Security] Rejected WebSocket connection from unauthorized Origin: ${origin}`);
        return false;
      }
    }

    // 2. Token verification
    if (token !== SERVER_SECRET_TOKEN) {
      console.warn(`[Security] Rejected WebSocket connection with invalid token: ${token}`);
      return false;
    }

    return true;
  }

  server.on('upgrade', (req, socket, head) => {
    if (!validateRequest(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const parsed = url.parse(req.url || '', true);
    const pathname = parsed.pathname;

    if (pathname === '/ws/pty') {
      wssPty.handleUpgrade(req, socket, head, (ws) => {
        wssPty.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/events') {
      wssEvents.handleUpgrade(req, socket, head, (ws) => {
        wssEvents.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  const disposeSession = (sessionId: string) => {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    sessions.delete(sessionId);
    try { entry.pty.dispose(); } catch {}
  };

  // Handle PTY WebSocket (/ws/pty)
  wssPty.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    // node-pty の遅延ロード完了を待ってからセッション作成に進む
    void (async () => {
      await ensurePtyReady();
      handlePtyConnection(ws, req);
    })();
  });

  function handlePtyConnection(ws: WebSocket, req: http.IncomingMessage) {
    const parsed = url.parse(req.url || '', true);
    const sessionId = (parsed.query.sessionId as string) || crypto.randomUUID();
    const sshProfileId = parsed.query.sshProfile as string | undefined;

    // 入力文字色など、クライアント指定のシェル環境オプション（値は厳格に検証）
    const extraEnv: Record<string, string> = {};
    const inputColor = parsed.query.inputColor;
    if (typeof inputColor === 'string' && /^[a-zA-Z0-9]{1,12}$/.test(inputColor)) {
      extraEnv.DOPATERM_INPUT_COLOR = inputColor;
    }
    const promptColor = parsed.query.promptColor;
    if (typeof promptColor === 'string' && /^[a-zA-Z0-9]{1,12}$/.test(promptColor)) {
      extraEnv.DOPATERM_PROMPT_COLOR = promptColor;
    }

    let sessionEntry = sessions.get(sessionId);
    if (!sessionEntry) {
      let ptySession: IPtySession;
      let kind: SessionEntry['kind'] = 'local';

      if (sshProfileId) {
        // SSH セッション: OS標準の ssh クライアントを PTY で spawn。
        // 引数は配列で構築（シェル文字列連結なし）。ホスト鍵確認・
        // パスフレーズ・パスワードは全て PTY 内の OpenSSH 対話に委ねる。
        const profile = getProfile(sshProfileId);
        if (!profile) {
          ws.send(`\r\n\x1b[31m[Dopaterm] SSH profile not found: ${sshProfileId}\x1b[0m\r\n`);
          ws.close();
          return;
        }
        const sshBin = process.platform === 'win32' ? 'ssh.exe' : 'ssh';
        // sshPlain=1: ラッパー非対応環境向けプレーン接続（クライアントの自動フォールバック）
        const args = buildSshArgs(profile, parsed.query.sshPlain !== '1');
        console.log(`[PTY] SSH session: session=${sessionId} -> ${profile.user}@${profile.host}:${profile.port} (${profile.authMethod})`);
        ptySession = createCommandSession(sessionId, sshBin, args, { cols: 80, rows: 24 });
        kind = 'ssh';
      } else {
        const explicitCwd = typeof parsed.query.cwd === 'string' ? parsed.query.cwd : undefined;
        console.log(`[PTY] Client connected: session=${sessionId}`);
        ptySession = createPtySession(sessionId, { cols: 80, rows: 24 }, extraEnv, explicitCwd);
      }

      sessionEntry = { pty: ptySession, kind };
      // events ソケットが先行接続されている場合に紐付ける
      sessionEntry.eventsWs = eventsSockets.get(sessionId);
      sessions.set(sessionId, sessionEntry);

      ptySession.onData((data) => {
        if (sessionEntry?.ptyWs && sessionEntry.ptyWs.readyState === WebSocket.OPEN) {
          sessionEntry.ptyWs.send(data);
        }
      });

      ptySession.onExit((code) => {
        console.log(`[PTY] ${sessionEntry?.kind ?? 'session'} exited with code: ${code}`);
        const ev = eventsSockets.get(sessionId);
        if (ev && ev.readyState === WebSocket.OPEN) {
          ev.send(JSON.stringify({ type: 'session_closed', exitCode: code }));
        }
        sessions.delete(sessionId);
      });
    }

    sessionEntry.ptyWs = ws;

    ws.on('message', (message: Buffer | string) => {
      try {
        const dataStr = typeof message === 'string' ? message : message.toString('utf-8');
        sessionEntry?.pty.write(dataStr);
      } catch (err) {
        console.error('[PTY] Error writing to pty:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[PTY] Socket closed: session=${sessionId}`);
      if (sessionEntry) {
        sessionEntry.ptyWs = undefined;
        // Grace period before disposing PTY process
        setTimeout(() => {
          if (!sessionEntry?.ptyWs && !eventsSockets.has(sessionId)) {
            disposeSession(sessionId);
          }
        }, 15000);
      }
    });
  }

  // Handle Events WebSocket (/ws/events)
  wssEvents.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const parsed = url.parse(req.url || '', true);
    const sessionId = (parsed.query.sessionId as string) || crypto.randomUUID();

    console.log(`[Events] Client connected: session=${sessionId}`);

    eventsSockets.set(sessionId, ws);
    const sessionEntry = sessions.get(sessionId);
    if (sessionEntry) {
      sessionEntry.eventsWs = ws;
    }

    ws.on('message', (message: string) => {
      try {
        const msg = JSON.parse(message.toString()) as WsControlMessage;
        // セッションは events 接続後に作成される場合があるため毎回動的に引く
        const entry = sessions.get(sessionId);
        if (msg.type === 'resize' && msg.cols && msg.rows) {
          entry?.pty.resize(msg.cols, msg.rows);
        } else if (msg.type === 'shell_theme') {
          // 実行中シェルの配色をライブ更新（次回プロンプト描画で反映）
          entry?.pty.setShellTheme?.({
            inputColor: msg.inputColor,
            promptColor: msg.promptColor,
          });
        } else if (msg.type === 'close_session') {
          disposeSession(sessionId);
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (err) {
        console.error('[Events] Message parse error:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[Events] Socket closed: session=${sessionId}`);
      eventsSockets.delete(sessionId);
      const entry = sessions.get(sessionId);
      if (entry) {
        entry.eventsWs = undefined;
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(PORT, HOST, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : PORT;

  return {
    port: actualPort,
    token: SERVER_SECRET_TOKEN,
    url: `http://${HOST}:${actualPort}/?token=${SERVER_SECRET_TOKEN}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const [, s] of sessions) {
          try { s.pty.dispose(); } catch {}
        }
        sessions.clear();
        for (const ws of eventsSockets.values()) {
          try { ws.close(); } catch {}
        }
        wssPty.close();
        wssEvents.close();
        server.close(() => resolve());
      }),
  };
}

// CLI エントリポイント（`npm start` = tsx server/index.ts / node dist/server/index.js）
// ESM/CJS 両エミットで動作するよう import.meta ではなく argv で判定する。
// （Electron から require された場合は argv[1] が別パスなので false になる）
const isDirectRun = !!process.argv[1] && /server[\\/]index\.(ts|js)$/.test(process.argv[1]);
if (isDirectRun) {
  startBackend().then(({ port, token, url: accessUrl }) => {
    console.log('='.repeat(60));
    console.log('✨ Dopaterm Local Backend Server ✨');
    console.log(`Bound strictly to: http://${HOST}:${port}`);
    console.log(`Security Token: ${token}`);
    console.log(`Access URL: ${accessUrl}`);
    console.log('(Vite dev server が必要な場合は別途 `npm run dev:client` で :5173 を起動)');
    console.log('='.repeat(60));
    console.log(`Backend is ready and listening on ${HOST}:${port}`);
  }).catch((err) => {
    console.error('Failed to start backend:', err);
    process.exit(1);
  });
}
