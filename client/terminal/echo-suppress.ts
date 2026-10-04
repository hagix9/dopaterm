/**
 * SSH 注入エコー抑制器 — Dopaterm が自分で送信したコマンドのエコーだけを
 * PTY 出力から除去する。
 *
 * 方針:
 * - 除去対象は「送信した内容と完全一致する文字列」のみ。正規表現や
 *   固定時間の出力破棄は使わない（ユーザーの通常出力を誤って消さない）
 * - エコーが WS チャンクに分割されても跨いで追跡する（未確定バイトは
 *   内部に保留し、不一致と判明した時点で実在の出力として書き戻す）
 * - エコーの文字と文字の間にエスケープシーケンス（CSI/OSC 等）や改行が
 *   挟まっても追跡する — Windows の ConPTY は出力を独自に再描画し、
 *   カーソル位置制御や折り返しを挿入することがある。除去するのは
 *   対象文字だけで、挟まった制御シーケンスは出力として残す
 * - 同一文字列の一致は clear() まで繰り返し除去する — zsh の ZLE が
 *   入力行を再描画で二度エコーすることがあり、1回目で解除すると
 *   2回目が画面に残る不具合があった。解除は V ACK・失敗・再接続時の
 *   clear() が担う
 * - エコー文字列と直後の改行（\r\n / \n / \r いずれか1つ）を除去対象に含める
 * - 対象が見つからなければ何も消えない（安全側）
 */
export class EchoSuppressor {
  private target = '';
  /** 一致途中の保留バイト（一致済み prefix + 挟まった制御/改行） */
  private pend = '';
  /** pend 内で一致済みの target 文字数 */
  private pos = 0;
  /** チャンク末尾で不完全だったエスケープシーケンスの受け持ち */
  private hold = '';
  /** 直前に target を除去済み → 続く改行1つだけを除去する待機状態 */
  private consumeNl = false;

  /** 次に来るエコーとして除去する文字列を設定（clear() まで一致を除去し続ける） */
  public arm(target: string) {
    this.target = target;
    this.pend = '';
    this.pos = 0;
    this.hold = '';
    this.consumeNl = false;
  }

  public get armed(): boolean {
    return this.target !== '';
  }

  /**
   * 解除。未確定のために保留していたバイトを返す
   * （呼び出し側が通常出力として書き戻すべき残り。実在の出力なので捨てない）
   */
  public clear(): string {
    const r = this.pend + this.hold;
    this.pend = '';
    this.pos = 0;
    this.hold = '';
    this.target = '';
    this.consumeNl = false;
    return r;
  }

  /** s[i] から始まるエスケープシーケンスの終端（排他）を返す。未完なら -1 */
  private static escEnd(s: string, i: number): number {
    const b1 = s.charCodeAt(i + 1);
    if (Number.isNaN(b1)) return -1; // 末尾が \x1b のみ
    if (s[i + 1] === '[') {
      // CSI: パラメータ/中間バイト(0x20-0x3F)* + 最終バイト(0x40-0x7E)
      for (let j = i + 2; j < s.length; j++) {
        const c = s.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) return j + 1;
        if (c < 0x20 || c > 0x3f) return i + 1; // 想定外: \x1b 単独として扱う
      }
      return -1;
    }
    // OSC / DCS / SOS / PM / APC: ベル or ST(\x1b\\) で終了
    if (']PX^_'.includes(s[i + 1])) {
      for (let j = i + 2; j < s.length; j++) {
        if (s[j] === '\x07') return j + 1;
        if (s[j] === '\x1b' && s[j + 1] === '\\') return j + 2;
      }
      return -1;
    }
    // 単純エスケープ: \x1b + 中間バイト(0x20-0x2F)* + 最終バイト(0x30-0x7E)
    if (b1 >= 0x20 && b1 <= 0x7e) {
      for (let j = i + 1; j < s.length; j++) {
        const c = s.charCodeAt(j);
        if (c >= 0x30 && c <= 0x7e) return j + 1;
        if (c < 0x20 || c > 0x2f) return j + 1;
      }
      return -1;
    }
    return i + 1;
  }

  /** pend 内のエスケープシーケンスだけを抽出（除去対象文字・改行は捨てる） */
  private static escapesOnly(pend: string): string {
    let out = '';
    for (let i = 0; i < pend.length; ) {
      if (pend[i] === '\x1b') {
        const end = EchoSuppressor.escEnd(pend, i);
        if (end > i) {
          out += pend.slice(i, end);
          i = end;
          continue;
        }
      }
      i++;
    }
    return out;
  }

  /** PTY 出力を受け取り、表示すべき部分だけを返す */
  public feed(data: string): string {
    if (!this.target) {
      if (this.consumeNl) {
        this.consumeNl = false;
        const nl = data.match(/^(\r\n|\n|\r)/);
        if (nl) data = data.slice(nl[0].length);
      }
      return data;
    }
    const t = this.target;
    const s = this.hold + data;
    this.hold = '';
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (this.pos === 0) {
        if (this.consumeNl) {
          this.consumeNl = false;
          if (c === '\r' || c === '\n') {
            i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
            continue;
          }
        }
        if (c === '\x1b') {
          const end = EchoSuppressor.escEnd(s, i);
          if (end < 0) {
            this.hold = s.slice(i);
            break;
          }
          out += s.slice(i, end);
          i = end;
          continue;
        }
        if (c === t[0]) {
          this.pos = 1;
          this.pend = c;
          i++;
          continue;
        }
        out += c;
        i++;
      } else {
        // 一致途中: 挟まった制御シーケンス・改行は保留に含めて追跡継続
        if (c === '\x1b') {
          const end = EchoSuppressor.escEnd(s, i);
          if (end < 0) {
            this.hold = s.slice(i);
            break;
          }
          this.pend += s.slice(i, end);
          i = end;
          continue;
        }
        if (c === '\r' || c === '\n') {
          this.pend += c;
          i++;
          continue;
        }
        if (c === t[this.pos]) {
          this.pend += c;
          this.pos++;
          i++;
          if (this.pos === t.length) {
            // 完全なエコー一致: 制御シーケンスだけを残し文字と改行を除去。
            // target は解除しない — ZLE の再描画で同一エコーが再度現れ得る。
            // 解除は V ACK・失敗・再接続時の clear() が行う
            out += EchoSuppressor.escapesOnly(this.pend);
            this.pend = '';
            this.pos = 0;
            this.consumeNl = true;
          }
          continue;
        }
        // 不一致: 保留分は実在の出力として書き戻し、現在文字は再評価
        out += this.pend;
        this.pend = '';
        this.pos = 0;
      }
    }
    return out;
  }
}
