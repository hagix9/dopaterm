/**
 * SSH リモートシェル用 OSC 133 フックスクリプト（一時注入型）。
 *
 * 設計方針:
 * - 接続先の設定ファイル・ファイルシステムを一切変更しない。
 * - 実行中のリモートシェルのメモリ内だけで有効。シェル終了と同時に消滅する。
 * - スクリプト自体は POSIX 準拠。zsh/bash 以外ではメッセージのみ表示して何もしない。
 * - 既存のシェル設定を壊さない:
 *   - zsh: add-zsh-hook は既存フックに追加するのみ（重複登録は除去してから追加）
 *   - bash: PROMPT_COMMAND は先頭に挿入して既存を保持し、終了ステータスを
 *     return で復元する。コマンド開始検出は bash>=4.4 では PS0、古い bash
 *     では既存 DEBUG トラップを保持したチェインで行う
 * - base64 はリモート側標準コマンド（GNU/BSD 共通の `base64 -d`）でデコードする。
 *
 * 注入プロトコル（内部制御・画面非表示）:
 * - SSH 起動時にリモートコマンド `printf <READY マーカー>; exec $SHELL -l` を
 *   指定する（server/ssh-profiles.ts buildSshArgs）。マーカーは認証・初期化
 *   完了後にだけ届くため、固定待機に頼らずシェル起動を確実に検知できる。
 * - マーカー受信後、出力静止を検出してから 3 フェーズで注入する:
 *     0. 短い外側読み取り行 `printf OSC5901;V; read -rst 8 _q; eval "$_q"`。
 *        この1行だけ通常エコーされるが、クライアントは送信済みのこの
 *        文字列と完全一致するエコーのみ描画から除去する（無差別削除しない）。
 *        `read -s` が後続入力行を無エコーで取り込む。`-r` は read が
 *        バックスラッシュを消費して制御シーケンスを壊すのを防ぐ。
 *        実行開始時の OSC 5901;V ACK をクライアントが受けてからだけ
 *        フェーズ1 の行を送る。
 *     1. `read -rs -t 8 -d $'\x1e'` の一括読み取り行 — フェーズ0 の
 *        `read -s` が無エコーで取り込み eval するため画面に一切表示されない。
 *        この行は実行開始時に OSC 5901;W を発行し、クライアントは
 *        その「reader 起動 ACK」を受け取ってからだけペイロードを送る。
 *        出力静止や固定時間だけでは reader 起動の根拠にしない。
 *        ペイロードは1回の `read` で終端記号 `\x1e` (RS) まで一括読み取り
 *        する — 行ごとの read ループでは read 同士の隙間に tty エコーが
 *        戻り、そこへ届いたバイトが画面に漏れる不具合があった。
 *        `read -s` が読み取り中ずっとエコーを抑止するため stty を触る
 *        必要がなく、中断・失敗しても tty のエコーが無効のまま残らない。
 *        `read -t` のタイムアウトで終端未着・切断時も固まらない。
 *        終端記号は `\x1e` (RS) — NUL はカノニカル入力で捨てられるため
 *        使えない。RS は行編集特殊文字でもないため安全に通る。
 *     2. `: ` プレフィックス付きの短いペイロード行 + 終端行 + `\x1e` —
 *        read がエコーなしで取り込む。万が一コマンドとして実行されても
 *        `:` は全POSIXシェルの無出力 no-op 組み込みなので無害
 *        （`#` コメントより堅牢）。
 * - 行終端は `\n` 固定。`\r` は ICRNL が off の tty 状態では行境界に
 *   ならずチャンクが融合して受信内容が破壊される不具合があった。
 * - 受信長が期待値と一致した場合のみ eval し、不一致なら OSC 5901;F
 *   を発行してクライアント側を確定的に失敗状態へ遷移させる。
 * - フック確立後はリモートから OSC 5901;A 確認が返り、それを受けて
 *   セッションの osc133Armed を立てる（信頼境界）。
 */

/** 内部制御用 OSC コード（133 等の標準コードと衝突しない任意値）。server 側 ssh-profiles.ts と同期すること */
export const DOPA_MARKER_OSC = 5901;
/** リモートコマンドラッパーが認証完了後に発行する「シェル起動」通知 */
export const MARKER_SHELL_READY = 'R';
/** フェーズ1 読み取り行が reader を起動した直前に発行する「受信待機」ACK。
 *  クライアントはこれを受け取ってからだけペイロードを送る（reader 未起動の
 *  状態で送るとペイロードがプロンプトへ漏れて破壊される不具合があった） */
export const MARKER_FX_WAIT = 'W';
/** フックスクリプトが確立時に発行する「有効化完了」確認 */
export const MARKER_FX_ARMED = 'A';
/** ペイロード受信が期待長と一致しなかった場合の「初期化失敗」通知 */
export const MARKER_FX_FAIL = 'F';
/** リモートシェルが非対応だった場合の通知 */
export const MARKER_UNSUPPORTED = 'U';
/** フェーズ0 外側 read が開始した ACK。この後に送る行は `read -s` が
 *  無エコーで取り込むため、注入コマンド自体を画面に表示しない */
export const MARKER_FX_VREAD = 'V';

const OSC = '\\033]5901;';
const BEL = '\\007';

export const REMOTE_OSC133_SCRIPT = `# Dopaterm remote OSC 133 hooks (transient, this shell only)
if [ -n "$ZSH_VERSION" ]; then
  # 入力文字色/プロンプト色（配色は注入ヘッダの __dopaterm_*_color が非空のときのみ適用。
  # ファイルは作らず、このシェルのメモリ内のみ有効。ベースPS1は初回だけ保持し、
  # 装飾は「既存プロンプトへの色の前置」に留めて内容は書き換えない）
  if [ -z "\${__DOPATERM_BASE_PS1+x}" ]; then __DOPATERM_BASE_PS1="$PS1"; fi
  __dopaterm_apply_colors() {
    if [ -n "\${__dopaterm_input_color:-}" ]; then
      zle_highlight=(\${zle_highlight:#default:*} "default:fg=\${__dopaterm_input_color}")
    fi
    if [ -n "\${__dopaterm_prompt_color:-}" ]; then
      PS1="%F{\${__dopaterm_prompt_color}}\${__DOPATERM_BASE_PS1}%f"
    fi
  }
  __dopaterm_preexec() { printf '\\033]133;C;cmd=%s\\007' "$1"; }
  __dopaterm_precmd()  { local s=$?; __dopaterm_apply_colors; printf '\\033]133;D;%d\\007' "$s"; return $s; }
  __dopaterm_apply_colors
  autoload -Uz add-zsh-hook 2>/dev/null
  if typeset -f add-zsh-hook >/dev/null 2>&1; then
    add-zsh-hook -d preexec __dopaterm_preexec 2>/dev/null
    add-zsh-hook -d precmd  __dopaterm_precmd  2>/dev/null
    add-zsh-hook preexec __dopaterm_preexec
    add-zsh-hook precmd  __dopaterm_precmd
    printf '${OSC}${MARKER_FX_ARMED}${BEL}'
    echo "Dopaterm: effects enabled (zsh)"
  else
    printf '${OSC}${MARKER_UNSUPPORTED}${BEL}'
    echo "Dopaterm: add-zsh-hook unavailable"
  fi
elif [ -n "$BASH_VERSION" ]; then
  __dopaterm_in_prompt=
  # プロンプト色（bash の readline には入力文字色相当の機能がないため PS1 のみ。
  # zle_highlight 相当は対象外）
  if [ -z "\${__DOPATERM_BASE_PS1+x}" ]; then __DOPATERM_BASE_PS1="$PS1"; fi
  # $? を先頭で捕獲して D を発行し、return で他の PROMPT_COMMAND 項目へ復元する
  __dopaterm_capture() {
    local s=$?
    if [ -n "\${__dopaterm_prompt_color:-}" ]; then
      PS1="\\[\\033[38;5;\${__dopaterm_prompt_color}m\\]\${__DOPATERM_BASE_PS1}\\[\\033[0m\\]"
    fi
    printf '\\033]133;D;%d\\007' "$s"
    return $s
  }
  __dopaterm_arm() { __dopaterm_in_prompt=1; }
  __dopaterm_c() {
    local c
    c="$(builtin history 1 2>/dev/null | sed 's/^ *[0-9]* *//')"
    printf '\\033]133;C;cmd=%s\\007' "$c"
  }
  __dopaterm_preexec() {
    if [ -n "$__dopaterm_in_prompt" ]; then
      __dopaterm_in_prompt=
      __dopaterm_c
    fi
  }
  if [ -z "$__dopaterm_hooked" ]; then
    __dopaterm_hooked=1
    # PROMPT_COMMAND: 既存を保持して先頭に capture・末尾に arm を追加
    # （capture で $? を先取り、arm で既存項目実行後にだけ検出を有効化）
    case ";$PROMPT_COMMAND;" in
      *__dopaterm_capture*) ;;
      *)
        if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then
          PROMPT_COMMAND=('__dopaterm_capture' "\${PROMPT_COMMAND[@]}" '__dopaterm_arm')
        else
          PROMPT_COMMAND="__dopaterm_capture\${PROMPT_COMMAND:+; $PROMPT_COMMAND}; __dopaterm_arm"
        fi ;;
    esac
    if [ "\${BASH_VERSINFO[0]:-0}" -gt 4 ] || { [ "\${BASH_VERSINFO[0]:-0}" = 4 ] && [ "\${BASH_VERSINFO[1]:-0}" -ge 4 ]; }; then
      # bash >= 4.4: PS0 で C を発行（DEBUG トラップは一切触れない）
      case "$PS0" in
        *__dopaterm_c*) ;;
        *) PS0='$(__dopaterm_c 2>/dev/null)'$PS0 ;;
      esac
    elif ! trap -p DEBUG 2>/dev/null | grep -q dopaterm; then
      # bash < 4.4: 既存 DEBUG トラップを保持してチェイン（無断置換しない）
      __dopaterm_old_debug="$(trap -p DEBUG | sed -n "s/^trap -- '\\(.*\\)' DEBUG$/\\1/p")"
      if [ -n "$__dopaterm_old_debug" ]; then
        trap 'eval "$__dopaterm_old_debug"; __dopaterm_preexec' DEBUG
      else
        trap '__dopaterm_preexec' DEBUG
      fi
    fi
    printf '${OSC}${MARKER_FX_ARMED}${BEL}'
    echo "Dopaterm: effects enabled (bash)"
  else
    printf '${OSC}${MARKER_FX_ARMED}${BEL}'
    echo "Dopaterm: effects enabled (bash, already hooked)"
  fi
else
  printf '${OSC}${MARKER_UNSUPPORTED}${BEL}'
  echo "Dopaterm: unsupported remote shell (zsh/bash only)"
fi
`;

/** ペイロードの終端行（`: ` 始まり — コマンド化しても no-op 組み込みで無害） */
export const INJECT_END_LINE = ': __DOPA_END__';
/** ペイロード各行のプレフィックス（`: ` = POSIX no-op 組み込み） */
const INJECT_LINE_PREFIX = ': ';
/** ペイロード1行あたりの最大長（ZLE/readline の行長ベル対策の安全側の値） */
const INJECT_CHUNK_SIZE = 200;
/** read の1行あたりタイムアウト秒（終端行未着・切断時に read が固まらないため） */
const INJECT_READ_TIMEOUT = 8;

/**
 * フェーズ1+2 を一括生成する（ペイロード長を読み取り行の検査値に使うため）。
 *
 * フェーズ1 読み取り行（フェーズ0 の `read -s` が無エコーで取り込む）:
 * - 先頭スペースは HIST_IGNORE_SPACE 設定環境での履歴除外を意図したベストエフォート
 * - `printf OSC5901;W` を read 直前に発行 — 行のパースが通り
 *   実行が始まった（＝ reader がまもなく入力待ちになる）ことの ACK。
 *   クライアントは W を受け取ってからペイロードを送る
 * - `read -rsd $'\x1e' -t` がペイロード全体を終端記号まで一括・無エコーで
 *   読み取る。行ごとのループでは read の隙間に届いたバイトが tty エコー
 *   で画面に漏れたため、単一 read に変更した
 * - 受信文字数が期待長と一致した場合のみ eval。不一致（切断・欠落・
 *   ユーザー入力混入等）なら OSC5901;F を発行して eval しない
 * - デコード失敗・eval 失敗は空評価に収まり、シェルはそのまま使える
 *
 * フェーズ2 ペイロード（`read -s` により画面に表示されない）:
 * - 各行は `: ` 始まりのため、仮に read が動いていない状態で到達しても
 *   コマンドとして実行されても無出力 no-op で無害
 * - 行終端は `\n`。`\r` は ICRNL off の tty 状態で行境界にならない
 * - 長行を避けるため INJECT_CHUNK_SIZE ごとに改行する
 * - 末尾に終端記号 `\x1e` (RS) を送って read を完了させる。
 *   NUL はカノニカル入力で捨てられるため使えない
 */
/** UTF-8 安全な base64。ブラウザの btoa() は Latin1 範囲外（スクリプト内の
 * 日本語コメント等）で InvalidCharacterError を投げるため、TextEncoder で
 * UTF-8 バイト列へ変換してから符号化する（Node 側 Buffer.from(...,'utf-8')
 * と同一の出力になる） */
function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface RemoteShellColors {
  inputColor?: string;
  promptColor?: string;
}

/**
 * 注入スクリプト生成。colors を渡すと、スクリプト先頭に色変数の代入を
 * 前置する（リモート側ファイル不要・eval 先シェルのメモリ内のみ有効）。
 * 値は英数字のみにサニタイズし、eval へのコード混入を防ぐ。
 */
export function buildInjectionPlan(colors?: RemoteShellColors): { outer: string; line: string; payload: string } {
  const VALID = /^[a-zA-Z0-9]{1,12}$/;
  const ic = colors?.inputColor && VALID.test(colors.inputColor) ? colors.inputColor : '';
  const pc = colors?.promptColor && VALID.test(colors.promptColor) ? colors.promptColor : '';
  const colorHeader = `__dopaterm_input_color='${ic}'\n__dopaterm_prompt_color='${pc}'\n`;
  const b64 = toBase64Utf8(colorHeader + REMOTE_OSC133_SCRIPT);
  // フェーズ0 外側読み取り行（この1行だけエコーされる — クライアント側が
  // 送信内容と完全一致のみ描画除去する）。V ACK を発行してから read -s で
  // フェーズ1 行を無エコーで受け取り eval する。
  // - `read -s` がエコー抑止のため stty を触らない（中断時も tty を壊さない）
  // - `read -t` で終端未着・切断時も固まらない
  // - eval されるのは1行のみ。ユーザーの誤入力が来ても「自分が打った文字列が
  //   実行される」のと同等で、注入内容がコマンドとして漏れることはない
  const outer = ` printf '${OSC}${MARKER_FX_VREAD}${BEL}'; read -rst ${INJECT_READ_TIMEOUT} _q; eval "$_q"\n`;
  // フェーズ1 行 — ペイロード全体を `read -d RS` で一括・無エコー読み取り
  // （行ループの read 隙間に tty エコーが戻って漏れる不具合の対策）。
  // `: ` プレフィックスと終端行を剥がして文字数検査し、一致時だけ eval。
  const endBare = INJECT_END_LINE.slice(INJECT_LINE_PREFIX.length);
  const line = ` printf '${OSC}${MARKER_FX_WAIT}${BEL}'; _n=${b64.length}; if IFS= read -r -s -t ${INJECT_READ_TIMEOUT} -d $'\\x1e' _d; then _g=$(printf '%s' "$_d" | sed -e 's/^: //' -e '/^${endBare}$/d' | tr -d '\\n\\r '); if [ \${#_g} -eq $_n ]; then eval "$(printf '%s' "$_g" | base64 -d)"; else printf '${OSC}${MARKER_FX_FAIL}${BEL}'; fi; else printf '${OSC}${MARKER_FX_FAIL}${BEL}'; fi; unset _d _g _n\n`;
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += INJECT_CHUNK_SIZE) {
    lines.push(INJECT_LINE_PREFIX + b64.slice(i, i + INJECT_CHUNK_SIZE));
  }
  lines.push(INJECT_END_LINE);
  // 終端記号 \x1e (RS) で read を完了させる（NUL はカノニカル入力で捨てられる）
  return { outer, line, payload: lines.join('\n') + '\n\x1e' };
}
