/**
 * Dopaterm Electron メインプロセス（CommonJS）。
 * 既存の Node バックエンド（HTTP+WS+PTY）をプロセス内で起動し、
 * トークン付きURLを BrowserWindow にロードする。
 * ブラウザ版（`npm start`）とは同一バックエンドを共有する。
 *
 * ※ ESM 版は Electron 内蔵ローダーの CJS 依存解析と相性が悪かったため
 *   確実に動作する CommonJS で実装。
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { isSameOrigin } = require('./nav-guard.cjs');

let backend = null;
let mainWindow = null;

async function startBackend() {
  // dist/electron/main.cjs -> dist/server/index.js (CommonJS)
  const { startBackend } = require(path.join(__dirname, '..', 'server', 'index.js'));
  // ポート 0 → 空きポート自動選択。static は dist/client。
  return startBackend({ port: 0, staticDir: path.join(__dirname, '..', 'client') });
}

async function createWindow() {
  backend = await startBackend();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'Dopaterm',
    backgroundColor: '#0D0B14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 外部ナビゲーション・新規ウィンドウを禁止（ローカルバックエンドのみ許可）
  const allowedOrigin = `http://127.0.0.1:${backend.port}`;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (!isSameOrigin(navUrl, allowedOrigin)) {
      event.preventDefault();
    }
  });

  // レンダラーのコンソールをメイン側ログへ転送（デバッグ用）
  mainWindow.webContents.on('console-message', (...args) => {
    const text = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    // Chromium の WebSocket 失敗メッセージ等は token 付き URL を含み得るため、伏せてから出力する
    console.log('[renderer]', text.split(backend.token).join('[redacted]'));
  });

  if (process.env.DOPATERM_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  await mainWindow.loadURL(backend.url).catch((err) => {
    // Electron のエラーメッセージには読み込み URL（= トークン）が含まれ得るため、伏せてから投げ直す
    throw Object.assign(new Error(String(err && err.message).split(backend.token).join('[redacted]')), {
      code: err && err.code,
      errno: err && err.errno,
    });
  });
  console.log(`[Dopaterm] Window loaded: ${allowedOrigin}`);
}

// preload 経由の最小限 IPC（汎用コマンド実行APIは公開しない）
ipcMain.handle('dopaterm:pick-file', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '秘密鍵ファイルを選択',
    properties: ['openFile', 'showHiddenFiles'],
  });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('dopaterm:info', () => ({
  platform: process.platform,
  version: app.getVersion(),
}));
// ランチャーの EXIT ボタン → 通常の Cmd+Q と同じ終了経路（before-quit でバックエンドを畳む）
ipcMain.handle('dopaterm:quit', () => {
  app.quit();
});

app.whenReady().then(() => {
  void createWindow();

  app.on('activate', () => {
    // macOS: Dock クリックでウィンドウ再生成
    if (BrowserWindow.getAllWindows().length === 0 && backend) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // ターミナルアプリのため全プラットフォームで終了
  app.quit();
});

app.on('before-quit', () => {
  void backend?.close();
});

// 予期しない終了でもバックエンドのPTY群を畳む
process.on('exit', () => {
  void backend?.close();
});
