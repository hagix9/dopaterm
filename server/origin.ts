/**
 * loopback Origin の判定（HTTP CORS と WebSocket upgrade で共通）。
 *
 * 文字列の prefix 一致ではなく URL として解析し、次をすべて満たすものだけ許可する:
 *  - scheme が http:
 *  - hostname が 127.0.0.1 または localhost に完全一致
 *  - 入力が正規のシリアライズ形（scheme://host[:port]）そのもの
 *    （userinfo・path・`127.1` のような省略記法・大文字違いなどは拒否）
 * port は制限しない（Electron は空きポートを自動選択、Vite dev server は :5173 から接続するため）。
 * parse できない値は例外ではなく false を返す。
 */
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

export function isAllowedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && ALLOWED_HOSTNAMES.has(u.hostname) && u.origin === origin;
  } catch {
    return false;
  }
}
