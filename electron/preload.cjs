// Preload: contextIsolation 有効のため、contextBridge 経由で
// 必要最小限の API のみをレンダラーに公開する。
// 汎用的な OS コマンド実行APIは公開しない（セキュリティ要件）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dopaterm', {
  isElectron: true,
  platform: process.platform,
  /** 秘密鍵ファイル選択ダイアログ（キャンセル時 null） */
  pickFile: () => ipcRenderer.invoke('dopaterm:pick-file'),
  /** アプリ情報 */
  info: () => ipcRenderer.invoke('dopaterm:info'),
  /** アプリ終了（ランチャーの EXIT ボタン用。Cmd+Q と同じ経路） */
  quit: () => ipcRenderer.invoke('dopaterm:quit'),
});
