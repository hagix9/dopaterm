# Dopaterm デモ動画

| ファイル | 内容 | 長さ | サイズ |
|---|---|---|---|
| `dopaterm-demo.mp4` | 本編（1280x800 H.264 + AAC 音声） | 約 29 秒 | 約 10 MB |
| `dopaterm-preview.gif` | README 用プレビュー（640px・12fps・音声なし） | 約 12.5 秒 | 約 5.5 MB |

## 収録内容

1. **成功演出**: `ls` / `echo DOPATERM` / `date` の実行で XP 加算・紙吹雪・マスコット反応
2. **失敗演出**: `cpx src dst`（存在しないコマンド）で FP 加算・TYPO 演出
3. **スロット**: 写真筐体モードでレバー → 3 リール回転 → 3 停止ボタンで停止
   （2 回実行。当たり判定は既存ロジックそのまま・改変なし）
4. **演出デモ**: 大当たり級の祝演出は**演出デモ機能**（`#btn-demo-success`、
   コンボ値 120 に設定）で再生。実スコア・実コンボは汚染されないデモ経路を使用

## 収録方法

- macOS 上の Electron 開発ビルドを CDP（Chrome DevTools Protocol）で操作
- 映像: `Page.startScreencast` の JPEG フレームを連続取得（約 47fps・1280x800）
- 音声: `Page.addScriptToEvaluateOnNewDocument` で `AudioContext` をラップし、
  `ctx.destination` への接続を `MediaStreamDestination` にタップ →
  `MediaRecorder` で webm/opus 収録（アプリの実際の効果音）
- 操作: `Input.insertText`/`dispatchKeyEvent` でコマンド入力、
  DOM クリックでレバー・停止ボタン操作（`demo/record.mjs`）
- プライバシー: 収録専用の `$HOME`（空の `.dopaterm`・独自プロンプト
  `demo@dopaterm`）で起動。ユーザー名・ホスト名・SSH 接続先・履歴は映らない

## 再生成

```bash
# 1. 収録用 HOME を用意（prompt: demo@dopaterm）
mkdir -p /tmp/dopa-home && printf "PROMPT='demo@dopaterm %%1~ %% '\n" > /tmp/dopa-home/.zshrc

# 2. ビルドして起動
npm run build && npm run build:backend
HOME=/tmp/dopa-home node_modules/.bin/electron . --remote-debugging-port=9223 &

# 3. 収録（ws 依存が必要。プロジェクトルートで実行）
node demo/record.mjs   # ./demo-recording/ に frames/*.jpg + audio.webm

# 4. 結合（ffmpeg）
ffmpeg -framerate 46.8 -i demo-recording/frames/%05d.jpg -c:v libx264 -pix_fmt yuv420p \
  -crf 19 -preset slow -movflags +faststart video-raw.mp4
ffmpeg -i video-raw.mp4 -i demo-recording/audio.webm -c:v copy -c:a aac -b:a 160k \
  -shortest -movflags +faststart dopaterm-demo.mp4

# 5. GIF（12.5 秒の抜粋・640px・12fps・パレット最適化）
ffmpeg -ss 14.5 -t 12.5 -i dopaterm-demo.mp4 -vf \
  "fps=12,scale=640:-1:flags=lanczos,palettegen=max_colors=192" pal.png
ffmpeg -ss 14.5 -t 12.5 -i dopaterm-demo.mp4 -i pal.png -lavfi \
  "fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer" \
  dopaterm-preview.gif
```

収録に使用したツール: Electron (CDP), ffmpeg（imageio-ffmpeg 同梱バイナリ）, Node.js + ws
