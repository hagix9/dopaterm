/**
 * Dopaterm クライアントロジック回帰テスト（ヘッドレス）
 * 実行: npx tsx scripts/test-effects.ts
 *
 * 検証:
 *  - command_finished の成功/失敗/不明(exitCode null) の集計
 *  - デモイベントが実績・スコアに影響しない
 *  - 演出レベル0でも集計が継続する
 *  - スコアの localStorage 永続化
 */

// ---- 最小限の DOM / ブラウザ環境スタブ ----
class FakeEl {
  children: any[] = [];
  innerHTML = '';
  textContent = '';
  style: Record<string, string> = {};
  className = '';
  dataset: Record<string, string> = {};
  classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };
  appendChild(c: any) {
    this.children.push(c);
    return c;
  }
  remove() {}
  querySelector() {
    return new FakeEl();
  }
  querySelectorAll() {
    return [] as any[];
  }
  addEventListener() {}
  setAttribute() {}
}

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).document = {
  createElement: () => new FakeEl(),
  documentElement: { style: { setProperty: () => {} } },
  body: new FakeEl(),
};
(globalThis as any).window = globalThis;

const { ScoreManager } = await import('../client/effect/score-manager.js');
const { EffectDirector } = await import('../client/effect/effect-director.js');
import type { CommandFinishedEvent } from '../client/types/events.js';

// ---- エンジンモック ----
const calls: string[] = [];
const rec =
  (name: string) =>
  (...args: any[]) => {
    calls.push(name + (args.length ? `(${args[0]})` : ''));
  };

const engines = {
  mascot: { setState: rec('mascot.state'), setComboRank: rec('mascot.rank'), setExcited: rec('mascot.excited') },
  particles: {
    emitFlyingDocs: rec('p.docs'),
    emitConfetti: rec('p.confetti'),
    emitCoins: rec('p.coins'),
    emitFireworks: rec('p.fireworks'),
    emitLaserBeams: rec('p.lasers'),
    emitEmbers: rec('p.embers'),
    clear: rec('p.clear'),
  },
  background: { setRank: rec('bg.rank'), setDisaster: rec('bg.disaster'), reset: rec('bg.reset') },
  audio: {
    playBlip: rec('a.blip'),
    playTransferStart: rec('a.transfer'),
    playSuccessChime: rec('a.chime'),
    playComboArpeggio: rec('a.arp'),
    playFeverFanfare: rec('a.fever'),
    playHyperDopaChord: rec('a.hyper'),
    playSingularityJingle: rec('a.sing'),
    playTypoCrash: rec('a.typo'),
    playPadlock: rec('a.lock'),
    playExplosion: rec('a.expl'),
  },
  overlay: {
    showCandidateBanner: rec('o.cand'),
    showTransferChallenge: rec('o.challenge'),
    showSuccessCelebration: rec('o.success'),
    showFailure: rec('o.failure'),
    showTypo: rec('o.typo'),
    showTypoJackpot: rec('o.typoJackpot'),
    showDisaster: rec('o.disaster'),
    showSingularityCredits: rec('o.singularity'),
    clear: rec('o.clear'),
  },
  themeManager: { setEffectState: rec('theme.state') },
};

// ---- テストランナー ----
let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

function fin(exitCode: number | null, extra: Partial<CommandFinishedEvent> = {}): CommandFinishedEvent {
  return {
    type: 'command_finished',
    command: 'cp',
    executionId: 'test-exec',
    exitCode,
    durationMs: 10,
    timestamp: Date.now(),
    sessionId: 'test',
    ...extra,
  };
}

const score = new ScoreManager(new FakeEl() as any);
const director = new EffectDirector({
  ...(engines as any),
  scoreManager: score,
});

// スロットル回避のためイベント間隔を確保
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GAP = 100;

console.log('=== Client Logic Tests ===');

// 1. 実成功 → コンボ+スコア加算（ランダム獲得量 80〜420 XP: base80-140 x jitter0.9-1.1 x LUCKY3）
await sleep(GAP);
director.handleFinished(fin(0));
let st = score.getState();
check('成功: successPoints が範囲内(72-462)', st.successPoints >= 72 && st.successPoints <= 462, `${st.successPoints}`);
check('成功: totalSuccessCount=1', st.totalSuccessCount === 1);
check('成功: successCombo=1', director.getComboStats().successCombo === 1);

// 2. 実失敗 → FP加算・コンボ中断
await sleep(GAP);
director.handleFinished(fin(1));
st = score.getState();
check('失敗: failurePoints が範囲内(30-180)', st.failurePoints >= 30 && st.failurePoints <= 180, `${st.failurePoints}`);
check('失敗: successCombo=0', director.getComboStats().successCombo === 0);
check('失敗: failureCombo=1', director.getComboStats().failureCombo === 1);

// 3. exitCode null → 何も計上しない
await sleep(GAP);
const before = score.getState();
director.handleFinished(fin(null));
st = score.getState();
check('不明: スコア不変', st.successPoints === before.successPoints && st.failurePoints === before.failurePoints);
check('不明: コンボ不変', director.getComboStats().failureCombo === 1);

// 4. デモ成功 → 実績に影響なし
await sleep(GAP);
director.setSimulatedCombo(9999);
director.handleFinished(fin(0), true);
st = score.getState();
check('デモ成功: スコア不変', st.successPoints === before.successPoints && st.totalSuccessCount === before.totalSuccessCount);
check('デモ成功: successCombo不変', director.getComboStats().successCombo === 0, `${director.getComboStats().successCombo}`);

// 5. デモ失敗 → 実績に影響なし
await sleep(GAP);
director.handleFinished(fin(127, { failureCategory: 'typo' }), true);
check('デモ失敗: failureCombo不変', director.getComboStats().failureCombo === 1);
check('デモ失敗: FP不変', score.getState().failurePoints === before.failurePoints);

// 6. setSimulatedCombo は実績に触れない
director.setSimulatedCombo(10000);
check('setSimulatedCombo: successCombo不変', director.getComboStats().successCombo === 0);

// 7. 演出レベル0でも集計継続
director.setEffectLevel(0);
await sleep(GAP);
const callsBeforeLv0 = calls.length;
director.handleFinished(fin(0));
st = score.getState();
check(
  'Lv0: 成功が計上される',
  st.successPoints > before.successPoints && st.successPoints <= before.successPoints + 462,
  `${st.successPoints}`
);
check('Lv0: successCombo=1', director.getComboStats().successCombo === 1);
check('Lv0: 成功演出は発火しない', !calls.slice(callsBeforeLv0).some((c) => c.startsWith('o.success')));
director.setEffectLevel(3);

// 7.5 熱量（余韻・興奮）: 連続成功でマスコット興奮が発火する
await sleep(GAP);
director.handleFinished(fin(0));
await sleep(GAP);
director.handleFinished(fin(0));
await sleep(GAP);
director.handleFinished(fin(0));
check('熱量: 連続成功で興奮状態になる', calls.some((c) => c === 'mascot.excited(true)'), calls.slice(-8).join(','));

// 8. エラー分類ヒューリスティック（outputTail）
await sleep(GAP);
director.handleFinished(fin(1, { outputTail: 'cp: x.txt: No such file or directory' }));
check('分類: no such file → 墓石演出(not_found)', calls.includes('o.failure(not_found)'), calls.slice(-3).join(','));
await sleep(GAP);
director.handleFinished(fin(126));
check('分類: 126 → 南京錠(permission_denied)', calls.includes('o.failure(permission_denied)'));
await sleep(GAP);
director.handleFinished(fin(127));
check('分類: 127 → TYPO専用演出', calls.some((c) => c.startsWith('o.typo')), calls.slice(-6).join(','));
await sleep(GAP);
director.handleFinished(fin(1));
check('分類: 判定不能 → generic_error', calls.includes('o.failure(generic_error)'));

// 9. localStorage 永続化
st = score.getState();
const saved = store.get('dopaterm_cumulative_score_v1');
check('永続化: localStorage に保存', !!saved && JSON.parse(saved).successPoints === st.successPoints);

// 10. リセット
score.resetScore();
st = score.getState();
check('リセット: 全項目0', st.successPoints === 0 && st.failurePoints === 0 && st.totalSuccessCount === 0 && st.totalFailureCount === 0);

// 11. SSH 注入エコー抑制器（EchoSuppressor）
{
  const { EchoSuppressor } = await import('../client/terminal/echo-suppress.js');
  const LINE = ` printf '\\033]5901;V\\007'; read -st 8 _q; eval "$_q"`;

  // 1チャンク完結: エコー+改行のみ除去、通常出力は維持
  let s = new EchoSuppressor();
  s.arm(LINE);
  check('抑制: エコー行だけ除去（前後の通常出力は残る）',
    s.feed(`% ${LINE}\r\n% ok\r\n`) === '% % ok\r\n');

  // チャンク分割されたエコーも除去（途中の実出力は保留されず正しく流れる）
  s = new EchoSuppressor();
  s.arm(LINE);
  const part1 = s.feed('pr' + LINE.slice(0, 10));
  const part2 = s.feed(LINE.slice(10) + '\r\nnext');
  check('抑制: 分割エコーも除去（実出力+改行消費）',
    part1 + part2 === 'prnext', JSON.stringify(part1 + part2));

  // エコーが来ない場合は何も消さない（安全側・通常出力を優先）
  s = new EchoSuppressor();
  s.arm(LINE);
  const noEcho = s.feed('regular output\r\n') + s.feed('more data\r\n') + s.clear();
  check('抑制: 対象未着では通常出力を破棄しない',
    noEcho === 'regular output\r\nmore data\r\n', JSON.stringify(noEcho));

  // 通常出力とエコーが同一チャンクに混在してもエコーのみ除去
  s = new EchoSuppressor();
  s.arm(LINE);
  check('抑制: 同一チャンク内混在でエコーのみ除去',
    s.feed(`real1${LINE}\r\nreal2`) === 'real1real2');

  // clear は保留バイトを捨てずに返す（実出力なので書き戻す）
  s = new EchoSuppressor();
  s.arm(LINE);
  s.feed('abc' + LINE.slice(0, 5));
  check('抑制: clear が保留末尾を返す', s.clear() === LINE.slice(0, 5));

  // zsh ZLE の再描画で同一エコーが二度現れても両方除去（clear まで解除しない）
  s = new EchoSuppressor();
  s.arm(LINE);
  const r1 = s.feed(`% ${LINE}\r\n`);
  const r2 = s.feed(`prompt${LINE.slice(0, 20)}`);
  const r3 = s.feed(`${LINE.slice(20)}\x1b[?2004l\r\n`);
  check('抑制: 再描画の二度目エコーも除去（分割・clear まで継続）',
    r1 + r2 + r3 === '% prompt\x1b[?2004l\r\n', JSON.stringify(r1 + r2 + r3));

  // clear 後は通常通り表示される（抑制の残存なし）
  s.clear();
  check('抑制: clear 後は対象文字列も通す', s.feed(`x${LINE}y`) === `x${LINE}y`);

  // --- Windows ConPTY 想定: エコー中に制御シーケンスが挟まる再描画 ---
  // エコー文字の間に CSI が挟まっても対象文字だけを除去し、CSI は残す
  s = new EchoSuppressor();
  s.arm(LINE);
  const mid = LINE.slice(0, 12) + '\x1b[1;5H' + LINE.slice(12);
  check('抑制: ConPTY再描画（エコー中のCSI挟み込み）で対象文字のみ除去・CSI温存',
    s.feed(`${mid}\r\nafter`) === '\x1b[1;5Hafter', JSON.stringify(s.armed ? '' : ''));

  // エコー途中の折り返し改行（\r\n）も挟み込みとして吸収する
  s = new EchoSuppressor();
  s.arm(LINE);
  const wrapped = LINE.slice(0, 15) + '\r\n' + LINE.slice(15);
  check('抑制: ConPTY折り返し（エコー中の\\r\\n）を吸収',
    s.feed(`% ${wrapped}\r\nok`) === '% ok', '');

  // 挟まりエスケープがチャンク分割されても追跡する
  s = new EchoSuppressor();
  s.arm(LINE);
  const q1 = s.feed(`pre${LINE.slice(0, 8)}\x1b[?`);
  const q2 = s.feed(`2004l${LINE.slice(8)}\r\npost`);
  check('抑制: 挟まりCSIがチャンク分割されても除去・CSI温存',
    q1 + q2 === 'pre\x1b[?2004lpost', JSON.stringify(q1 + q2));

  // 一致途中で不一致 → 保留バイトは実在の出力として順序通り書き戻す
  s = new EchoSuppressor();
  s.arm(LINE);
  const m1 = s.feed(`x${LINE.slice(0, 8)}\x1b[K`);
  const m2 = s.feed('ZZZ done\r\n');
  check('抑制: 一致途中の不一致で保留分（prefix+CSI）を順序通り書き戻す',
    m1 + m2 === `x${LINE.slice(0, 8)}\x1b[KZZZ done\r\n`, JSON.stringify(m1 + m2));

  // 不完全なエスケープをチャンク末尾で保留し、clear でも捨てない
  s = new EchoSuppressor();
  s.arm(LINE);
  const im1 = s.feed('ok\x1b[?20');
  const im2 = s.clear();
  check('抑制: 不完全エスケープは hold に残り clear で返す',
    im1 === 'ok' && im2 === '\x1b[?20', JSON.stringify(im1) + '|' + JSON.stringify(im2));
}

// ---- ローカルシェル初期 cwd 解決（Windows PowerShell ホーム起動修正） ----
{
  console.log('=== Local Shell cwd Resolution ===');
  const os = await import('os');
  const path = await import('path');
  const { resolveLocalShellCwd } = await import('../server/pty-manager.js');
  const realDir = os.tmpdir();
  const missing = path.join(realDir, 'dopa-nonexistent-dir-xyz');
  const prevProfile = process.env.USERPROFILE;

  check('cwd: 明示指定が有効なら最優先（win32）',
    resolveLocalShellCwd(realDir, 'win32', missing, missing) === realDir);
  check('cwd: 明示指定が有効なら最優先（darwin）',
    resolveLocalShellCwd(realDir, 'darwin', missing, missing) === realDir);
  check('cwd: 明示指定が無効パスなら無視（win32→ホーム）',
    resolveLocalShellCwd(missing, 'win32', realDir, missing) === realDir);

  process.env.USERPROFILE = missing;
  check('cwd: win32 はホームを既定にする（アプリ展開先でない）',
    resolveLocalShellCwd(undefined, 'win32', realDir, missing) === realDir);
  check('cwd: win32 ホーム不可→USERPROFILEへフォールバック',
    (() => { process.env.USERPROFILE = realDir; return resolveLocalShellCwd(undefined, 'win32', missing, missing) === realDir; })());
  delete process.env.USERPROFILE;
  check('cwd: win32 ホームもUSERPROFILEも不可→最終フォールバック',
    resolveLocalShellCwd(undefined, 'win32', missing, realDir) === realDir);

  check('cwd: darwin は従来どおりプロセス cwd（ホームで上書きしない）',
    resolveLocalShellCwd(undefined, 'darwin', missing, realDir) === realDir);
  check('cwd: linux もプロセス cwd 維持',
    resolveLocalShellCwd(undefined, 'linux', realDir, realDir) === realDir);

  if (prevProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevProfile;
}

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'} ===`);
process.exit(failures === 0 ? 0 : 1);
