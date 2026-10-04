/**
 * 演出統括ディレクター 強化版 (Dopaterm Effect Director)
 * スコアマネージャー連携、テーマ連携、高コンボレーザー演出、完全障害分離
 */

import {
  CommandCandidateEvent,
  CommandStartedEvent,
  CommandFinishedEvent,
  ComboRank,
  FailureCategory,
  DisasterType,
} from '../types/events.js';
import { MascotEngine } from './mascot.js';
import { ParticleEngine } from './particles.js';
import { BackgroundEngine } from './background.js';
import { DopatermAudio } from './audio.js';
import { UiOverlayEngine, TYPO_VARIANTS, TypoVariant } from './ui-overlay.js';
import { ScoreManager } from './score-manager.js';
import { ThemeManager } from '../terminal/theme-manager.js';

export interface EffectDirectorOptions {
  mascot: MascotEngine;
  particles: ParticleEngine;
  background: BackgroundEngine;
  audio: DopatermAudio;
  overlay: UiOverlayEngine;
  scoreManager: ScoreManager;
  themeManager?: ThemeManager;
}

export class EffectDirector {
  private mascot: MascotEngine;
  private particles: ParticleEngine;
  private background: BackgroundEngine;
  private audio: DopatermAudio;
  private overlay: UiOverlayEngine;
  private scoreManager: ScoreManager;
  private themeManager?: ThemeManager;

  /** 実コマンド結果の通知コールバック（SLOT筐体等が購読。結果そのものは変更不可） */
  public onRealResult?: (result: 'success' | 'failure') => void;

  /** 熱量変化の通知コールバック（SLOT筐体ランプ等が購読） */
  public onHeatChange?: (heat: number) => void;

  /** TYPO警告ランプ演出の通知コールバック（SLOT筐体の警告灯等が購読） */
  public onWarningLamp?: () => void;

  // Effect intensity level (0: OFF, 1: LOW, 2: HIGH, 3: DOPAMINE, 4: ABSURD, 5: GPU ABUSE)
  private effectLevel = 3;

  // Combo tracking (In-session, 実コマンド実績)
  private successCombo = 0;
  private failureCombo = 0;
  private totalAttempts = 0;
  private lastSuccessTime = 0;
  private readonly COMBO_WINDOW_MS = 15000; // 15 seconds

  // デモ専用の表示用状態（実績カウンタとは完全分離）
  private simulatedCombo = 1;
  private demoFailureCombo = 0;

  // Event throttling (Protection against 100+ commands/sec script spam)
  private lastFxTriggerTime = 0;
  private readonly MIN_FX_INTERVAL_MS = 90;

  // ---- 演出バリアントのランダム化 ----
  // 同じ演出が連続しないよう、直前のバリアント/パレットを除外して抽選する
  private lastSuccessVariant = -1;
  private lastFailureVariant = -1;
  private lastTypoVariant = -1;
  private lastSuccessPalette = -1;
  private lastFailurePalette = -1;

  private readonly SUCCESS_PALETTES = [
    ['#FF1B8D', '#00F5D4', '#FFE600', '#FFFFFF'],
    ['#00F0FF', '#E040FB', '#7CFFCB', '#FFDE59'],
    ['#FF6B00', '#FFE600', '#39FF14', '#FF1B8D'],
    ['#7928CA', '#00F5D4', '#FF78C4', '#FFFFFF'],
  ];
  private readonly FAILURE_PALETTES = [
    ['#FF4757', '#FF6B00', '#57606F', '#FFE600'],
    ['#FF0044', '#FFA502', '#2F3542', '#FF4757'],
    ['#C0392B', '#E67E22', '#7F8C8D', '#F1C40F'],
    ['#FFE600', '#F8EFBA', '#FFF200', '#FFDD59'], // 落雷系
  ];

  /** size 個から last を除いたインデックスを抽選（連続同一演出の抑止） */
  private pickIndex(size: number, last: number): number {
    if (size <= 1) return 0;
    let i = Math.floor(Math.random() * size);
    while (i === last) {
      i = Math.floor(Math.random() * size);
    }
    return i;
  }

  private shakeScreen(ms = 300) {
    try {
      document.body.classList.add('screen-shake');
      setTimeout(() => document.body.classList.remove('screen-shake'), ms);
    } catch {}
  }

  // ---- 熱量 (excitement) 管理 ----
  // 成功・失敗・実行中のイベントで熱量が上がり、操作が途切れると段階的に減衰する。
  // 熱量は --dopa-heat CSS変数・マスコット興奮・筐体ランプ・残光に反映される。
  private heat = 0; // 0.0〜1.0
  private heatColor = '#00F5D4';
  private heatDecayTimer: number | null = null;
  /** 現在表示中の候補/チャレンジバナーを最後にトリガーしたセッション。
      セッション終了時に「そのセッションの演出だけ」を消すために使う */
  private fxOwnerSessionId: string | null = null;
  private activeFollowUps = 0;
  private readonly MAX_FOLLOWUPS = 4; // 追撃の同時スケジュール上限

  /** 熱量を加算して視覚に反映（演出レベル0では発火しない） */
  private bumpHeat(amount: number, color: string) {
    if (this.effectLevel === 0) return;
    this.heat = Math.min(1, this.heat + amount * (0.85 + Math.random() * 0.3));
    this.heatColor = color;
    this.applyHeatVisuals();
    this.ensureHeatDecay();
  }

  private applyHeatVisuals() {
    try {
      const root = document.documentElement.style;
      root.setProperty('--dopa-heat', this.heat.toFixed(3));
      root.setProperty('--dopa-heat-color', this.heatColor);
    } catch {}
    this.mascot.setExcited(this.heat > 0.45);
    this.onHeatChange?.(this.heat);
  }

  /** 段階的な減衰: 高熱量は速く冷め、低熱量はじわじわ残る */
  private ensureHeatDecay() {
    if (this.heatDecayTimer !== null) return;
    this.heatDecayTimer = window.setInterval(() => {
      this.heat = Math.max(0, this.heat - (0.012 + this.heat * 0.010));
      if (this.heat <= 0) {
        this.heat = 0;
        if (this.heatDecayTimer !== null) {
          clearInterval(this.heatDecayTimer);
          this.heatDecayTimer = null;
        }
      }
      this.applyHeatVisuals();
    }, 200);
  }

  /** 追撃バースト: メイン演出の後に遅延で軽量な追加演出をランダム発火 */
  private scheduleSuccessFollowUps(rank: ComboRank, lucky: boolean) {
    const extra =
      (rank === 'fever' || rank === 'hyper_dopa' ? 1 : 0) +
      (rank === 'singularity' ? 1 : 0) +
      (lucky ? 1 : 0);
    const count = Math.min(this.MAX_FOLLOWUPS, 1 + Math.floor(Math.random() * 2) + extra);

    for (let i = 0; i < count; i++) {
      if (this.activeFollowUps >= this.MAX_FOLLOWUPS) break;
      this.activeFollowUps++;
      const delay = 200 + i * (150 + Math.random() * 300); // 追撃間隔もランダム
      setTimeout(() => {
        this.activeFollowUps--;
        if (this.effectLevel === 0) return;
        try {
          // メインと違うパレットで軽い追撃
          const p = this.pickIndex(this.SUCCESS_PALETTES.length, this.lastSuccessPalette);
          const pal = this.SUCCESS_PALETTES[p];
          const mini = Math.floor(Math.random() * 4);
          if (mini === 0) this.particles.emitConfetti(30 + Math.floor(Math.random() * 40), pal);
          else if (mini === 1) this.particles.emitFireworks(30 + Math.floor(Math.random() * 30), pal);
          else if (mini === 2) this.particles.emitCoins(10 + Math.floor(Math.random() * 15));
          else this.particles.emitLaserBeams(3 + Math.floor(Math.random() * 4), pal);
        } catch {}
      }, delay);
    }
  }

  constructor(options: EffectDirectorOptions) {
    this.mascot = options.mascot;
    this.particles = options.particles;
    this.background = options.background;
    this.audio = options.audio;
    this.overlay = options.overlay;
    this.scoreManager = options.scoreManager;
    this.themeManager = options.themeManager;
  }

  public setEffectLevel(level: number) {
    this.effectLevel = Math.max(0, Math.min(5, level));
    this.applyRankVisuals(this.getRankForCombo(this.successCombo));
    if (this.effectLevel === 0) {
      this.clearAll();
    }
  }

  public getEffectLevel(): number {
    return this.effectLevel;
  }

  public getComboStats() {
    return {
      successCombo: this.successCombo,
      failureCombo: this.failureCombo,
      totalAttempts: this.totalAttempts,
      rank: this.getRankForCombo(this.successCombo),
    };
  }

  /**
   * デモパネル用の表示コンボ設定。実績カウンタ (successCombo) には一切触れない。
   */
  public setSimulatedCombo(combo: number) {
    this.simulatedCombo = Math.max(1, combo);
    this.applyRankVisuals(this.getRankForCombo(this.simulatedCombo));
  }

  /** ランクに応じた視覚状態（背景・王冠・枠グロー）の反映 */
  private applyRankVisuals(rank: ComboRank) {
    this.background.setRank(rank);
    this.mascot.setComboRank(rank);
    if (this.themeManager) {
      this.themeManager.setEffectState(rank, this.effectLevel);
    }
  }

  private getRankForCombo(combo: number): ComboRank {
    if (combo >= 10000) return 'singularity';
    if (combo >= 1000) return 'hyper_dopa';
    if (combo >= 100) return 'fever';
    if (combo >= 10) return 'combo';
    return 'normal';
  }

  /**
   * 1. 候補検出 (Candidate)
   */
  public handleCandidate(e: CommandCandidateEvent) {
    if (this.effectLevel === 0) return;
    this.fxOwnerSessionId = e.sessionId;
    try {
      this.mascot.setState('candidate');
      this.audio.playBlip();
      if (this.effectLevel >= 2) {
        this.overlay.showCandidateBanner(e.command);
      }
    } catch (err) {
      console.warn('[EffectDirector] Error in handleCandidate:', err);
    }
  }

  /**
   * 2. 実行開始 (Started)
   */
  public handleStarted(e: CommandStartedEvent) {
    // 試行回数カウントは演出レベルに関わらず実施
    this.totalAttempts++;
    this.fxOwnerSessionId = e.sessionId;

    const now = performance.now();
    if (now - this.lastSuccessTime > this.COMBO_WINDOW_MS && this.lastSuccessTime > 0) {
      this.successCombo = 0; // Combo timed out
    }

    if (this.effectLevel === 0) return;

    // フェーズ1「予兆・溜め」: 実行開始時点で熱量をわずかに上げ、
    // 縁グロー・入力行グロー・マスコットの構えでメイン演出への期待感を作る
    this.bumpHeat(0.07, '#00F5D4');
    try {
      document.body.classList.add('exec-charge');
    } catch {}

    try {
      this.mascot.setState('transfer');
      this.audio.playTransferStart();

      if (this.effectLevel >= 1) {
        this.particles.emitFlyingDocs(this.effectLevel >= 4 ? 8 : 4);
      }

      if (this.effectLevel >= 2) {
        this.overlay.showTransferChallenge(e.command, this.totalAttempts);
      }
    } catch (err) {
      console.warn('[EffectDirector] Error in handleStarted:', err);
    }
  }

  /**
   * 3. 実行終了 (Finished)
   * isDemo=true の場合は演出のみ再生し、実績カウンタ・スコアを一切変更しない
   */
  public handleFinished(e: CommandFinishedEvent, isDemo = false) {
    if (this.fxOwnerSessionId === e.sessionId) this.fxOwnerSessionId = null;
    try {
      // 予兆チャージを解除（実行終了で溜めグロー消灯）
      try {
        document.body.classList.remove('exec-charge');
      } catch {}

      // 終了ステータス不明 (null) の場合は成功にも失敗にも加算しない！
      if (e.exitCode === null) {
        this.mascot.setState('idle');
        this.overlay.clear();
        return;
      }

      const now = performance.now();
      const isThrottled = now - this.lastFxTriggerTime < this.MIN_FX_INTERVAL_MS;
      this.lastFxTriggerTime = now;

      if (isDemo) {
        this.handleDemoFinished(e, isThrottled);
        return;
      }

      if (e.exitCode === 0) {
        // SUCCESS!
        this.successCombo++;
        this.failureCombo = 0;
        this.lastSuccessTime = now;

        // ★演出レベルが0（OFF）であってもスコア集計は継続する！
        // 獲得ポイントはこのイベントで一度だけ確定される
        const award = this.scoreManager.recordSuccess(this.successCombo, false);

        const rank = this.getRankForCombo(this.successCombo);
        this.applyRankVisuals(rank);

        // フェーズ2-4「メイン＋追撃＋余韻」（レベル0またはスロットル時はスキップ）
        // スロットル時も熱量は微増し、連続操作の盛り上がりが維持される
        this.bumpHeat(
          0.18 + (rank === 'hyper_dopa' ? 0.2 : rank === 'fever' ? 0.12 : rank === 'combo' ? 0.05 : 0) + (award?.lucky ? 0.1 : 0),
          '#00F5D4'
        );
        if (this.effectLevel > 0 && !isThrottled) {
          this.triggerSuccessEffects(rank, this.successCombo, award);
        }
        this.onRealResult?.('success');
      } else {
        // FAILURE! (exitCode !== 0 かつ null ではない)
        this.failureCombo++;
        this.successCombo = 0; // コンボ中断

        // ★演出レベルが0（OFF）であっても失敗スコア集計は継続する！
        this.scoreManager.recordFailure(false);

        const category = e.failureCategory || this.guessCategoryFromExitCode(e.exitCode, e.outputTail);
        // コンボが途切れたのでランク表示も通常へ戻す
        this.applyRankVisuals('normal');

        // 失敗も熱量は上がる（赤い残光で残る）
        this.bumpHeat(0.14, '#FF4757');
        if (this.effectLevel > 0 && !isThrottled) {
          this.triggerFailureEffects(category, this.failureCombo);
        }
        this.onRealResult?.('failure');
      }
    } catch (err) {
      console.warn('[EffectDirector] Error in handleFinished:', err);
    }
  }

  /**
   * デモ再生パス。simulatedCombo / demoFailureCombo のみを使い、
   * 実績（successCombo/failureCombo/totalAttempts/ScoreManager）は変更しない。
   */
  private handleDemoFinished(e: CommandFinishedEvent, isThrottled: boolean) {
    const code = e.exitCode;
    if (code === null) return; // 呼び出し側で排除済みだが防御的に
    if (code === 0) {
      const combo = Math.max(1, this.simulatedCombo);
      const rank = this.getRankForCombo(combo);
      this.applyRankVisuals(rank);
      if (this.effectLevel > 0 && !isThrottled) {
        this.triggerSuccessEffects(rank, combo);
      }
    } else {
      this.demoFailureCombo++;
      const category = e.failureCategory || this.guessCategoryFromExitCode(code, e.outputTail);
      if (this.effectLevel > 0 && !isThrottled) {
        this.triggerFailureEffects(category, this.demoFailureCombo);
      }
    }
  }

  private triggerSuccessEffects(
    rank: ComboRank,
    combo: number,
    award?: { points: number; multiplier: number; lucky: boolean } | null
  ) {
    if (rank === 'singularity') {
      // 10,000+ DOPA SINGULARITY 特異点祝賀（内部演出もランダム化）
      const pal = this.SUCCESS_PALETTES[this.pickIndex(this.SUCCESS_PALETTES.length, this.lastSuccessPalette)];
      this.mascot.setState('singularity');
      this.audio.playSingularityJingle();
      this.particles.emitConfetti(450 + Math.floor(Math.random() * 150), pal);
      this.particles.emitFireworks(150 + Math.floor(Math.random() * 60));
      this.particles.emitLaserBeams(10 + Math.floor(Math.random() * 6), pal);
      this.overlay.showSingularityCredits(combo);
      return;
    }

    // ランクに応じた演出量スケール
    const rankScale =
      rank === 'hyper_dopa' ? 3.2 : rank === 'fever' ? 2.4 : rank === 'combo' ? 1.6 : 1.0;

    // 音声: 高ランクは専用ジングル、normal/combo はランダム
    if (rank === 'hyper_dopa') {
      this.audio.playHyperDopaChord();
    } else if (rank === 'fever') {
      this.audio.playFeverFanfare();
    } else if (Math.random() < 0.5) {
      this.audio.playComboArpeggio();
    } else {
      this.audio.playSuccessChime();
    }

    // 成功パーティクルバリアント（直前と同じバリアント/パレットは避ける）
    const VARIANTS = 5;
    const v = this.pickIndex(VARIANTS, this.lastSuccessVariant);
    this.lastSuccessVariant = v;
    const p = this.pickIndex(this.SUCCESS_PALETTES.length, this.lastSuccessPalette);
    this.lastSuccessPalette = p;
    const pal = this.SUCCESS_PALETTES[p];

    const lvlBoost = this.effectLevel >= 4 ? 1.3 : this.effectLevel >= 2 ? 1.0 : 0.6;
    const n = (base: number) => Math.max(4, Math.round(base * rankScale * lvlBoost * (0.8 + Math.random() * 0.4)));

    switch (v) {
      case 0: // 紙吹雪ストーム
        this.particles.emitConfetti(n(130), pal);
        if (rankScale >= 2) this.particles.emitConfetti(n(60), this.SUCCESS_PALETTES[(p + 1) % this.SUCCESS_PALETTES.length]);
        break;
      case 1: // 連続花火ショー（発射位置はエンジン側でランダム）
        for (let i = 0; i < Math.min(4, 1 + Math.floor(rankScale)); i++) {
          this.particles.emitFireworks(n(60), pal);
        }
        break;
      case 2: // レーザーショー＋紙吹雪
        this.particles.emitLaserBeams(n(5), pal);
        this.particles.emitConfetti(n(50), pal);
        break;
      case 3: // コインの噴水＋金銀紙吹雪
        this.particles.emitCoins(n(25));
        this.particles.emitConfetti(n(70), pal);
        break;
      case 4: // ドキュメント祝賀パレード
        this.particles.emitFlyingDocs(Math.min(16, n(5)));
        this.particles.emitConfetti(n(60), pal);
        break;
    }

    // レベル5 (GPU ABUSE) では追加の花火・レーザーの乱れ撃ち
    if (this.effectLevel === 5) {
      this.particles.emitFireworks(100);
      this.particles.emitLaserBeams(10, pal);
    }

    // レア演出（LUCKY XP 当選時は金の大盤振る舞い）
    if (award?.lucky) {
      this.particles.emitCoins(60);
      this.particles.emitFireworks(80, ['#FFE600', '#FFDE59', '#FFFFFF', '#FFA502']);
    }

    // フェーズ3「追撃」: メインの直後に遅延ミニバーストを1〜4発
    this.scheduleSuccessFollowUps(rank, !!award?.lucky);

    // フェーズ4「余韻」: ゆっくり上昇する残光エンバー（ランクと熱量で量が変化）
    const emberCount = Math.min(40, Math.round((6 + rankScale * 4) * (0.7 + Math.random() * 0.6) + this.heat * 10));
    this.particles.emitEmbers(emberCount, pal);

    this.mascot.setState('success');
    this.overlay.showSuccessCelebration(combo, rank, award);

    // 高ランクほどダンスを長く（余韻時間に連動）
    const danceMs = 900 + Math.round(rankScale * 300) + Math.floor(Math.random() * 400);
    setTimeout(() => {
      this.mascot.setState('idle');
    }, danceMs);
  }

  private triggerFailureEffects(category: FailureCategory, failureCombo: number) {
    // TYPO（command not found系）は専用の大型バリエーションプールへ
    if (category === 'typo') {
      this.triggerTypoEffects(failureCombo);
      return;
    }

    this.mascot.setState('failure');

    // 音声はカテゴリ連動を維持（失敗の種類を音で伝える）
    if (category === 'permission_denied') {
      this.audio.playPadlock();
    } else if (category === 'build_failed' || category === 'not_found') {
      Math.random() < 0.5 ? this.audio.playExplosion() : this.audio.playTypoCrash();
    } else {
      this.audio.playTypoCrash();
    }

    // 失敗パーティクルバリアント（直前と同じバリアント/パレットは避ける）
    const VARIANTS = 4;
    const v = this.pickIndex(VARIANTS, this.lastFailureVariant);
    this.lastFailureVariant = v;
    const p = this.pickIndex(this.FAILURE_PALETTES.length, this.lastFailurePalette);
    this.lastFailurePalette = p;
    const pal = this.FAILURE_PALETTES[p];

    const lvlBoost = this.effectLevel >= 4 ? 1.3 : this.effectLevel >= 2 ? 1.0 : 0.6;
    const n = (base: number) => Math.max(3, Math.round(base * lvlBoost * (0.8 + Math.random() * 0.4)));

    switch (v) {
      case 0: // 爆発（火の玉スパーク＋画面揺れ）
        this.particles.emitFireworks(n(70), pal);
        this.shakeScreen(350 + Math.floor(Math.random() * 200));
        break;
      case 1: // 落雷（イエロー系レーザー乱射＋短い揺れ）
        this.particles.emitLaserBeams(n(8), this.FAILURE_PALETTES[3]);
        this.shakeScreen(220);
        break;
      case 2: // 瓦礫の崩落（ダーク系紙吹雪＋揺れ）
        this.particles.emitConfetti(n(80), pal);
        this.shakeScreen(300);
        break;
      case 3: // ファイル散乱＋小爆発
        this.particles.emitFlyingDocs(Math.min(10, n(4)));
        this.particles.emitFireworks(n(35), pal);
        this.shakeScreen(280);
        break;
    }

    // 余韻: くすぶる残光（失敗は暗めのパレットで少量・短め）
    this.particles.emitEmbers(4 + Math.floor(Math.random() * 8), pal);

    this.overlay.showFailure(category, failureCombo);

    setTimeout(() => {
      this.mascot.setState('idle');
    }, 1300);
  }

  /**
   * TYPO専用演出（command not found / 打ち間違い）。
   * 7バリアント＋低確率の逆転JACKPOT。直近バリアントを回避し、
   * FAILURE COMBO が増えるほど激しくなる。
   */
  private triggerTypoEffects(failureCombo: number) {
    // 低確率: 失敗なのに大当たり風祝賀（実績は失敗のまま・見た目のみ）
    if (Math.random() < 0.06) {
      const gold = ['#FFE600', '#FFDE59', '#FFFFFF', '#FFA502'];
      this.particles.emitConfetti(Math.floor(150 + Math.random() * 100), gold);
      this.particles.emitCoins(30 + Math.floor(Math.random() * 20));
      this.particles.emitFireworks(50 + Math.floor(Math.random() * 30), gold);
      this.mascot.setState('success');
      this.audio.playSuccessChime();
      this.overlay.showTypoJackpot(failureCombo);
      this.particles.emitEmbers(12, gold);
      setTimeout(() => this.mascot.setState('idle'), 1600);
      return;
    }

    const v = this.pickIndex(TYPO_VARIANTS.length, this.lastTypoVariant);
    this.lastTypoVariant = v;
    const variant = TYPO_VARIANTS[v];
    const p = this.pickIndex(this.FAILURE_PALETTES.length, this.lastFailurePalette);
    this.lastFailurePalette = p;
    const pal = this.FAILURE_PALETTES[p];

    // FAILURE COMBO 連動の激しさ倍率
    const heat = Math.min(2.2, 1 + Math.max(0, failureCombo - 1) * 0.25);
    const lvlBoost = this.effectLevel >= 4 ? 1.3 : this.effectLevel >= 2 ? 1.0 : 0.6;
    const n = (base: number) => Math.max(3, Math.round(base * lvlBoost * heat * (0.8 + Math.random() * 0.4)));

    // 音声・マスコット・衝撃をバリアント別に
    switch (variant) {
      case 'fall': // 巨大TYPO落下 → 着弾時に遅延シェイク＋粉塵
        this.audio.playTypoCrash();
        this.mascot.setState('failure');
        setTimeout(() => {
          this.shakeScreen(300 + Math.floor(Math.random() * 200));
          this.particles.emitConfetti(n(40), pal);
        }, 280 + Math.random() * 120);
        break;
      case 'slam': // 横から激突 → 着弾シェイク＋スパーク
        this.audio.playTypoCrash();
        this.mascot.setState('failure');
        setTimeout(() => {
          this.shakeScreen(340);
          this.particles.emitFireworks(n(35), pal);
        }, 240);
        break;
      case 'shatter': // 粉砕 → 破片＋爆発音＋揺れ
        Math.random() < 0.5 ? this.audio.playExplosion() : this.audio.playTypoCrash();
        this.mascot.setState('failure');
        this.particles.emitConfetti(n(60), pal);
        this.shakeScreen(280);
        break;
      case 'crack': // 画面ヒビ → マスコットが覗き込む
        this.audio.playTypoCrash();
        this.mascot.setState('candidate');
        this.shakeScreen(180);
        break;
      case 'eaten': // マスコットが食べる
        this.audio.playTypoCrash();
        this.mascot.setState('eat');
        break;
      case 'trip': // マスコットが派手に転倒（長めのずっこけ）
        this.audio.playTypoCrash();
        this.mascot.setState('failure');
        this.shakeScreen(200);
        break;
      case 'lamp': // 警告ランプ（筐体警告灯＋赤パルス）
        this.audio.playPadlock();
        this.mascot.setState('candidate');
        this.onWarningLamp?.();
        break;
    }

    this.overlay.showTypo(variant, failureCombo);

    // 追撃: 失敗でも小さな遅延バーストを1〜2発（高コンボ時は増加）
    const fuCount = Math.min(3, 1 + (failureCombo >= 3 ? 1 : 0) + (Math.random() < 0.4 ? 1 : 0));
    for (let i = 0; i < fuCount; i++) {
      if (this.activeFollowUps >= this.MAX_FOLLOWUPS) break;
      this.activeFollowUps++;
      setTimeout(() => {
        this.activeFollowUps--;
        if (this.effectLevel === 0) return;
        try {
          if (Math.random() < 0.6) this.particles.emitConfetti(15 + Math.floor(Math.random() * 25), pal);
          else this.particles.emitFireworks(15 + Math.floor(Math.random() * 20), pal);
        } catch {}
      }, 350 + i * (200 + Math.random() * 250));
    }

    // 余韻: くすぶる残光（失敗は暗め・短め。高コンボは増量）
    this.particles.emitEmbers(Math.min(28, 4 + Math.floor(Math.random() * 8) + failureCombo * 2), pal);

    const backMs = variant === 'eaten' ? 1500 : variant === 'trip' ? 1600 : 1300;
    setTimeout(() => {
      this.mascot.setState('idle');
    }, backMs + Math.floor(Math.random() * 300));
  }

  public triggerDisaster(type: DisasterType) {
    try {
      this.mascot.setState('huge_raid');
      this.audio.playExplosion();
      this.background.setDisaster(type);
      this.overlay.showDisaster(type);

      if (this.effectLevel >= 4) {
        this.particles.emitFireworks(80);
      }

      setTimeout(() => {
        this.mascot.setState('idle');
        this.background.reset();
      }, 1600);
    } catch (err) {
      console.warn('[EffectDirector] Error in triggerDisaster:', err);
    }
  }

  private guessCategoryFromExitCode(code: number, outputTail?: string): FailureCategory {
    const text = (outputTail || '').toLowerCase();
    if (code === 127 || text.includes('command not found')) {
      return 'typo';
    }
    if (code === 126 || text.includes('permission denied') || text.includes('operation not permitted')) {
      return 'permission_denied';
    }
    if (text.includes('no such file')) {
      return 'not_found';
    }
    if (text.includes('build failed') || text.includes('compilation failed')) {
      return 'build_failed';
    }
    return 'generic_error';
  }

  public cancelCandidate() {
    this.fxOwnerSessionId = null;
    this.mascot.setState('idle');
    this.overlay.clear();
  }

  /**
   * セッション終了時の演出クリーンアップ。
   * オーバーレイはグローバル共有のため、表示中バナー等の所有者が終了した
   * セッションの場合にだけクリアする。他タブの演出中は何もしない。
   */
  public endSession(sessionId: string) {
    if (this.fxOwnerSessionId !== sessionId) return;
    this.fxOwnerSessionId = null;
    this.mascot.setState('idle');
    this.overlay.clear();
    // 実行開始時の溜めグローは handleFinished で消す設計のため、
    // 終了イベントが届かないまま閉じた場合に残り得る → ここで解除
    try {
      document.body.classList.remove('exec-charge');
    } catch {}
  }

  public clearAll() {
    this.fxOwnerSessionId = null;
    // 熱量・余韻も完全にクリア
    this.heat = 0;
    if (this.heatDecayTimer !== null) {
      clearInterval(this.heatDecayTimer);
      this.heatDecayTimer = null;
    }
    this.applyHeatVisuals();
    try {
      document.body.classList.remove('exec-charge');
    } catch {}
    this.mascot.setState('idle');
    this.particles.clear();
    this.background.reset();
    this.overlay.clear();
  }
}
