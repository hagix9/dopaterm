# Dopaterm 技術調査報告書 (Technical Research Report)

- **プロジェクト名**: Dopaterm
- **フェーズ**: Phase 0（調査・設計）
- **作成日**: 2026-10-03
- **対象読者**: 設計者、開発者

---

## 1. 最小構成と依存関係の選定

Dopatermのコア設計方針である「**実用部分は堅実、演出部分だけ狂わせる**」「**演出が止まってもシェル操作を継続できる**」を達成するための最小スタックを調査・選定しました。

### 1.1 バックエンド (Local Backend)

| コンポーネント | 選定候補 | バージョン/ライセンス | 選定理由・評価 |
|---|---|---|---|
| ランタイム | **Node.js** | v20+ LTS (MIT) | クロスプラットフォームPTYライブラリとの親和性、WebSocketの堅牢性 |
| PTY制御 | **node-pty** | 1.0+ (MIT) | VS Codeでも採用される業界標準。macOS/Linux (POSIX pty) および Windows (ConPTY) を安定サポート |
| 通信 (WebSocket) | **ws** | 8.x (MIT) | 軽量、高速、余計なオーバーヘッドがない。バイナリとテキストの双方に対応 |
| Webサーバー | **Node.js標準 `http`** または **Vite dev server** | MIT | 静的アセット提供用。余計なWebフレームワーク（Express/Fastify等）は不要 |

> **注意点**: `node-pty` はネイティブC++モジュールを含むため、ビルド環境（macOS: Xcode Command Line Tools, Python）が必要です。実行環境にはmacOSが用意されているため問題ありません。

### 1.2 フロントエンド (Browser UI & Effect Engine)

| 領域 | 選定技術 | ライセンス | 役割と選定理由 |
|---|---|---|---|
| 言語・ビルド | **TypeScript + Vite** | MIT | 型安全性の担保と高速なHMR。React/Vue等の重厚なフレームワークは排除し、Vanilla DOM操作で描画遅延を最小化 |
| ターミナル描画 | **xterm.js (`@xterm/xterm`)** | MIT | VT100/ANSIエスケープシーケンス、IME、キーボード入力のデファクトスタンダード |
| ターミナル拡張 | **`@xterm/addon-fit`** | MIT | ウィンドウサイズ変更に伴う行・桁（cols/rows）の自動再計算 |
| マスコット | **インラインSVG + Spring物理 (TS)** | 自作 (MIT) | 外部ライブラリ不要。独自物理パラメータ（stiffness, damping）で弾むアニメーションを軽量描画 |
| パーティクル | **HTML5 Canvas 2D** | 標準API | 紙吹雪、星、コイン、飛ぶファイル。オブジェクトプールによりGC負荷をゼロ化 |
| 背景演出 | **WebGL (Quad Shader) + CSSフォールバック** | 標準API | 虹・サイバー・発光トンネル。Context lost時は自動的にCSSグラデーションに退避 |
| UIオーバーレイ | **CSS Transitions / Keyframes** | 標準API | カードポップアップ、XPゲージ、コンボバッジ。GPUアクセラレーション (`transform`, `opacity`) |
| 音響効果 | **Web Audio API** | 標準API | 音声ファイル（mp3/wav）不要。OscillatorNode / GainNode による完全動的シンセシス |

### 1.3 参考実装 (dopa-drill) のライセンスと分離

参考実装（`https://github.com/grmchn/dopa-drill`）の調査結果：
- **ソースコード**: MIT License（責務分離やWeb Audio合成、Canvasパーティクル構造などの技術的思想は自由に参考可能）。
- **キャラクター・名称・ロゴ**: 「ドパキチ」等のビジュアルやブランドは**MIT Licenseの除外対象**であり、非商用利用に限られる等の個別条件が存在。
- **Dopatermの決定方針**:
  - Dopa Drillのコード・キャラクター画像・SVG・音声パラメータは一切流用・コピーしない。
  - 完全オリジナルのマスコット、UIデザイン、効果音パラメータ、パーティクルロジックを新規実装する。
  - 技術的な着想（「学習・作業の進捗を過剰に褒める快感原則」と「SVG/Canvas/WebAudioの責務分離」）のみをオマージュする。

---

## 2. xterm.js と node-pty の接続・入出力・リサイズ・切断

### 2.1 通信プロトコルのチャネル分離

PTYのデータストリームと、制御・演出メッセージ（リサイズ、イベント、心拍）の多重化について、以下の2案を検討しました。

- **案1: 単一WebSocket + JSONラッパー**
  - 全てのPTY入出力を `{ type: "pty", data: "..." }` で包む。
  - 評価: 実装は容易だが、PTYの大量出力（`find /` や `cat large.txt`）時にJSONパース・文字列エスケープのオーバーヘッドが大きく、実用ターミナルとしての軽快さを損なう。
- **案2: デュアルWebSocket分離 (推奨: ★★★)**
  - **Channel 1 (`/ws/pty`)**: 生のテキスト/バイナリ専用。xterm.jsのI/Oをそのまま直結。
  - **Channel 2 (`/ws/events`)**: JSON専用（クライアント認証、ウィンドウリサイズ、コマンド候補・状態通知、死活監視）。
  - **評価**:
    - **完全な障害隔離**: エフェクトエンジンやJSONパースが万が一クラッシュ・ハングしても、PTYの標準入出力ストリームは無傷で動作を継続。
    - **最大のスループット**: PTYデータは純粋なバイナリ/UTF-8としてノーヘッドで中継。

### 2.2 リサイズ (Resize) の同期

1. ブラウザ側の `window.onresize` または `ResizeObserver` が発火。
2. `@xterm/addon-fit` の `fitAddon.proposeDimensions()` で最適な `cols` と `rows` を計算。
3. `/ws/events` 経由で `{ type: "resize", cols, rows }` を送信。
4. バックエンドで `ptyProcess.resize(cols, rows)` を呼び出し、OSカーネルの擬似端末サイズ（`winsize`）を更新。
5. シェル（およびフォアグラウンドプロセス）に `SIGWINCH` シグナルが送信され、画面が正しく再描画される。

### 2.3 切断・異常終了時のハンドリング

- **クライアント切断 (ブラウザタブ閉じ、リロード、ネットワーク瞬断)**:
  - バックエンドは即時にPTYを殺さず、10秒間の再接続猶予タイマー（Reconnect Grace Period）を開始。
  - 猶予期間内に再接続がなければ、子プロセス（シェル）に `SIGHUP` を送信して安全に終了させる。
- **シェル終了 (`exit` コマンド、プロセス終了)**:
  - `node-pty` の `onExit` イベントを検知。
  - クライアントに `{ type: "session_closed", exitCode }` を送信し、xterm上に `[プロセスが終了しました]` を表示して入力を無効化。

---

## 3. コマンド候補検出・実行確認・終了状態取得の実現可能性

Dopatermの最大の技術的論点は「**いかにシェル本来の動作を破壊せず、安全かつ確実にコマンドの実行と終了（exit code）を捉えるか**」です。

### 3.1 手法比較表

| 方式 | 仕組み | 利点 | 欠点・リスク | 評価 |
|---|---|---|---|---|
| **A. 入力キー観測 (Key Interception)** | ブラウザ側でキー入力を監視し、改行直前の文字列から `cp` を正規表現で検出 | シェル側の設定が一切不要 | 矢印キー履歴、補完、Ctrl+C、エイリアス、環境変数展開で誤認多発。**終了状態・成否は取得不可** | **候補 (Candidate) の推測のみに限定利用** |
| **B. PTY stdout 正規表現スキャン** | バックエンドでPTY出力（プロンプト等）を文字列マッチング | シェル設定不要 | プロンプトのカスタマイズ（Starship, Oh-My-Zsh等）やANSIカラーコードで誤検知。プロンプト出力はexit codeを保証しない | **不採用 (脆すぎる)** |
| **C. OSC 133 / FinalTerm 規格 (Shell Integration)** | ターミナル業界標準のOSCシーケンス（`OSC 133 ; A ST` 等）をシェル起動時に透過注入 | **業界標準 (VS Code/Ghostty/iTerm2同等)**。stdoutを汚染せずxtermパーサーで不可視化。exit codeも正確に取得可能 | シェルごとの起動時フック注入が必要 | **本命 (推奨: ★★★)** |
| **D. 専用IPCパイプ (FIFO/Socket)** | シェルの `preexec`/`precmd` からローカルUnixドメインソケットにJSONを送る | PTYストリームと完全分離 | Windowsでの実装差異、ソケット管理の複雑さ | 将来の拡張候補 |

### 3.2 採用方針: OSC 133 (Shell Integration) + 入力観測のハイブリッド

Dopatermでは、**VS CodeやGhosttyでも標準採用されている OSC 133 (Shell Integration)** を採用します。

#### OSC 133 シーケンス仕様:
- `\x1b]133;A\x07`: **Prompt start**（プロンプト描画開始）
- `\x1b]133;B\x07`: **Command start**（プロンプト描画終了・コマンド入力開始）
- `\x1b]133;C\x07`: **Command executed**（Enter打鍵・コマンド実行開始）
- `\x1b]133;D;<exit_code>\x07`: **Command finished**（コマンド終了と終了コード）

#### フックの安全な導入方法:
PTY起動時に、ユーザーの既存設定ファイルを直接書き換えることは**絶対にしません**。
`ENV` 変数（例: macOS/zsh の場合 `ZDOTDIR` または起動フラグ `zsh -d -f -i` ではなく、一時ディレクトリに生成した安全なラッパースクリプトを `source` させる）を利用し、既存の `.zshrc` を読み込んだ上で末尾にOSC 133フックを追加します。

```zsh
# Dopaterm zsh integration snippet (safe & non-destructive)
dopaterm_preexec() {
  printf '\033]133;C;cmd=%s\007' "$1"
}
dopaterm_precmd() {
  local last_status=$?
  printf '\033]133;D;%d\007' "$last_status"
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec dopaterm_preexec
add-zsh-hook precmd dopaterm_precmd
```

#### クライアント側（xterm.js）での透過受信:
xterm.js には `registerOscHandler` API が備わっています。
```typescript
terminal.parser.registerOscHandler(133, (data) => {
  // OSC 133シーケンスをパースしてエフェクトエンジンへイベント送信
  // return true を返すことで、画面上には一切表示（汚染）されない！
  handleShellIntegrationOsc(data);
  return true;
});
```

---

## 4. シェルフックのOS・シェル差と誤検出の限界

### 4.1 シェルごとの差異

1. **zsh (macOS デフォルト)**: `add-zsh-hook preexec / precmd`。極めて安定。
2. **bash (Linux / 一部macOS)**: `DEBUG` トラップ (`preexec` 模倣) および `PROMPT_COMMAND`。
3. **fish**: `fish_preexec` / `fish_postexec` イベントハンドラ。
4. **PowerShell (Windows)**: `Set-PSReadLineOption` の実行フック。

### 4.2 誤検出の限界と境界条件

以下のケースでは、コマンドの正確な追跡に原理的な限界が存在します：

- **対話型アプリケーション (`vim`, `nano`, `less`, `tmux`, `ssh`, `python` REPL)**:
  - 内部でユーザーが文字列を入力しても、ホストシェルの `preexec` は走りません。
  - **対策**: OSC 133 の `Command executed` が発行されていない状態（対話アプリ実行中）では、クライアント側のキー入力観測によるエフェクト発火を完全に抑制（ガード）します。
- **パイプライン・サブシェル**:
  - `echo "hello" | cp fileA fileB`: コマンドライン全体が1行として渡されるため、トークナイザーで `cp` の出現を安全に解析。
- **alias / 関数**:
  - `alias cp='cp -i'`: 実際のバイナリ `cp` と同様に扱って演出可能。
- **スクリプト内実行**:
  - `./build.sh` の内部で `cp` が呼ばれても、親シェルのフックは捕捉しません。これは設計書Rev.3の「実測できないものは演出しない」方針に適合します。

---

## 5. 演出とPTYの完全分離と障害隔離設計

「**演出がクラッシュしてもシェルは絶対に殺さない**」を実現するための防御アーキテクチャ：

```text
┌──────────────────────────────────────────────────────────────┐
│ Browser Window                                               │
│                                                              │
│  ┌─────────────────────────┐     ┌────────────────────────┐  │
│  │  Terminal Layer (Lower) │     │  Effect Overlay (Upper)│  │
│  │  - xterm.js container   │     │  - pointer-events: none│  │
│  │  - Raw PTY WebSocket    │     │  - SVG Mascot          │  │
│  │  - Full User Control    │     │  - Canvas Particles    │  │
│  │  - No DOM Blockers      │     │  - WebGL Background    │  │
│  └─────────────────────────┘     └────────────────────────┘  │
│               ▲                               │              │
│               │ (Independent)                 │ (try/catch)  │
│               ▼                               ▼              │
│  ┌─────────────────────────┐     ┌────────────────────────┐  │
│  │  Terminal Event Loop    │     │  Effect Director Loop  │  │
│  └─────────────────────────┘     └────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

1. **ポインターイベントの無効化**:
   エフェクトレイヤー（Canvas、マスコット、通知カード）のルート要素に `pointer-events: none` を強制指定。ユーザーのテキスト選択、クリック、スクロール、コピー＆ペーストを物理的に妨害しません。
2. **サンドボックス実行**:
   エフェクトエンジンの全描画コール（`requestAnimationFrame` 内）、Web Audio再生コード、DOM更新処理を `try-catch` で包含。例外発生時はコンソールにワーニングを出すのみで、ターミナルコンポーネントには一切伝播させません。
3. **独立した通信ソケット**:
   前述の通り、PTYデータストリームとイベントストリームを分離。

---

## 6. 描画・音響の負荷制限とフォールバック

### 6.1 パーティクルシステム (Canvas 2D)
- **オブジェクトプール**: `Particle` インスタンスを事前生成（例: 600個）。毎フレームの `new` / `delete` を排除し、V8エンジンのガベージコレクション（GCポーズ）を根絶。
- **動的フレームレート保護 (Dynamic Throttling)**:
  - 毎フレームの経過時間（`deltaTime`）を計測。
  - FPSが 45fps を下回った場合、新規放出パーティクル数を自動的に半減（スロットル）。

### 6.2 背景演出 (WebGL + CSS)
- **Context Lost 耐性**:
  - `canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); switchToCssFallback(); })` を実装。
  - GPUメモリ枯渇やドライバリセット時は、即座にCSSグラデーションアニメーションへシームレスに切り替え。

### 6.3 音響効果 (Web Audio API)
- **ブラウザのAutoplayポリシー対策**:
  - 起動時は `AudioContext.state === 'suspended'`。
  - 最初のキー押下またはクリックイベントで `audioCtx.resume()` を透過実行。
- **ボイススティーリング (Polyphony Limiter)**:
  - 同時発音数を最大 8 ボイスに制限。過度なコンボ音による音割れ（クリッピング）とCPU負荷を防止。

### 6.4 ユーザー環境への配慮
- `window.matchMedia('(prefers-reduced-motion: reduce)')` が有効な場合は、画面シェイクおよびパーティクル爆発を自動停止。
- タブがバックグラウンドに回った場合（`document.hidden === true`）、描画ループおよびオーディオ出力を即座に一時停止。

---

## 7. ローカルセキュリティと秘密情報保護

「**ローカルサーバーだから無条件に安全**」という誤認を排除するためのセキュリティ要件：

### 7.1 Cross-Site WebSocket Hijacking (CSWSH) 対策
悪意のあるWebページをユーザーがブラウザで閲覧した際、そのスクリプトが `ws://127.0.0.1:<port>` に接続して任意コマンドを実行する攻撃を完全に防ぎます。

1. **Origin ヘッダーの厳密検証**:
   バックエンドのHTTP/WebSocketサーバーは、リクエストの `Origin` ヘッダーを検査。
   `http://127.0.0.1:<port>` または `http://localhost:<port>` 以外のOriginからの接続は即座に HTTP 403 / ソケット破棄。
2. **ワンタイム暗号セッショントークン**:
   - バックエンド起動時に `crypto.randomBytes(32).toString('hex')` でランダムな64文字トークンを生成。
   - サーバー起動URL: `http://127.0.0.1:4040/?token=abc123...`
   - WebSocket接続時のクエリパラメータまたは初期ハンドシェイクでトークンの一致を要求。トークンが一致しない接続は即時拒否。

### 7.2 秘密情報 (パスワード・鍵) の保護
- PTYの送受信ログをファイルやDBに永続化しません（完全インメモリ）。
- `sudo` 等のパスワードプロンプト入力時、キーロガーとして機能しないよう、候補判定バッファは短時間（2秒）で自動クリア。
- WebSocket通信はローカルホスト（`127.0.0.1`）にのみバインド（`0.0.0.0` にはバインドしない）。

---

## 8. 技術調査の結論

本調査により、以下の設計でPhase 1（最小PoC）が安全かつ高信頼に実現可能であることが確認されました：
1. **フロントエンド**: TypeScript + xterm.js + Canvas 2D + Web Audio API (Vite駆動)
2. **バックエンド**: Node.js + node-pty + ws (Loopback限定バインド + トークン認証)
3. **コマンド検出**: OSC 133 Shell Integration（実測の開始・終了・exit code） + クライアント側入力補佐（候補推測）
4. **オリジナル性**: Dopa Drillの素材は一切流用せず、完全新規のSVGマスコットとサウンドシンセシスを構築。
