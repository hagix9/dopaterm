/**
 * Electron のナビゲーション判定用 helper。
 * URL として解析し、origin（scheme + host + port）が許可 origin と完全一致するときだけ true。
 * `startsWith` の文字列比較では `http://127.0.0.1:543210/` が `http://127.0.0.1:54321` に一致してしまうため使わない。
 * 解析できない値は例外ではなく false。
 */
function isSameOrigin(navUrl, allowedOrigin) {
  try {
    return new URL(navUrl).origin === allowedOrigin;
  } catch {
    return false;
  }
}

module.exports = { isSameOrigin };
