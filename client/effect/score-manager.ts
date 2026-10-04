/**
 * 成功・失敗 累積スコアマネージャー (Dopaterm Score Manager)
 * 減点方式なし・コンボと独立管理・常時HUD表示・飛翔アニメーション
 */

export interface ScoreState {
  successPoints: number;
  failurePoints: number;
  totalSuccessCount: number;
  totalFailureCount: number;
}

/** 1イベント分の確定獲得ポイント（抽選はイベントごとに1度だけ行う） */
export interface PointAward {
  points: number;
  multiplier: number;
  /** レア演出ボーナス（低確率の高倍率） */
  lucky: boolean;
}

const STORAGE_KEY = 'dopaterm_cumulative_score_v1';

// ---- 獲得ポイントの抽選範囲 ----
// 通常成功: 80〜140 XP / 通常失敗: 30〜90 FP
// コンボ: 既存の倍率式 + ±10% ジッター
// レア: 4% で x3 (LUCKY XP) / 5% で x2 (BIG FP)
const XP_BASE_MIN = 80;
const XP_BASE_MAX = 140;
const FP_BASE_MIN = 30;
const FP_BASE_MAX = 90;
const LUCKY_XP_CHANCE = 0.04;
const LUCKY_XP_MULT = 3;
const LUCKY_FP_CHANCE = 0.05;
const LUCKY_FP_MULT = 2;

function rollInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export class ScoreManager {
  private container: HTMLElement;
  private state: ScoreState = {
    successPoints: 0,
    failurePoints: 0,
    totalSuccessCount: 0,
    totalFailureCount: 0,
  };

  private successPointsEl!: HTMLElement;
  private failurePointsEl!: HTMLElement;
  private successCountEl!: HTMLElement;
  private failureCountEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.loadFromStorage();
    this.render();
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.state = {
          successPoints: Number(parsed.successPoints) || 0,
          failurePoints: Number(parsed.failurePoints) || 0,
          totalSuccessCount: Number(parsed.totalSuccessCount) || 0,
          totalFailureCount: Number(parsed.totalFailureCount) || 0,
        };
      }
    } catch {}
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {}
  }

  private render() {
    this.container.innerHTML = `
      <div id="score-hud" class="score-hud-bar">
        <div class="score-item success-score" title="累積成功スコア (加算方式)">
          <span class="score-label">✨ SUCCESS XP:</span>
          <span id="hud-success-points" class="score-number success-glow">0</span>
          <span class="score-sub">(<span id="hud-success-count">0</span> wins)</span>
        </div>
        <div class="score-divider">|</div>
        <div class="score-item failure-score" title="累積失敗スコア (ミスも勲章！)">
          <span class="score-label">💀 FAILURE FP:</span>
          <span id="hud-failure-points" class="score-number failure-glow">0</span>
          <span class="score-sub">(<span id="hud-failure-count">0</span> typos)</span>
        </div>
      </div>
    `;

    this.successPointsEl = this.container.querySelector('#hud-success-points') as HTMLElement;
    this.failurePointsEl = this.container.querySelector('#hud-failure-points') as HTMLElement;
    this.successCountEl = this.container.querySelector('#hud-success-count') as HTMLElement;
    this.failureCountEl = this.container.querySelector('#hud-failure-count') as HTMLElement;

    this.updateDisplay(false);
  }

  /**
   * 実際のコマンド成功時のスコア加算。
   * 獲得量はイベントごとに一度だけ抽選され、呼び出し側に PointAward を返す。
   */
  public recordSuccess(combo: number, isDemo = false): PointAward | null {
    if (isDemo) return null; // デモイベントは実スコアに反映しない

    this.state.totalSuccessCount++;
    // コンボ倍率によるボーナス + ±10% ジッター
    const baseMult = 1 + Math.min(Math.floor(combo / 10) * 0.2, 5.0);
    const jitter = 0.9 + Math.random() * 0.2;
    const lucky = Math.random() < LUCKY_XP_CHANCE;
    const multiplier = baseMult * jitter * (lucky ? LUCKY_XP_MULT : 1);
    const addedPoints = Math.round(rollInt(XP_BASE_MIN, XP_BASE_MAX) * multiplier);
    this.state.successPoints += addedPoints;

    this.saveToStorage();
    this.updateDisplay(true, 'success', addedPoints, multiplier, lucky);
    return { points: addedPoints, multiplier, lucky };
  }

  /**
   * 実際のコマンド失敗時のスコア加算 (減点ではなく失敗ポイント加算)
   */
  public recordFailure(isDemo = false): PointAward | null {
    if (isDemo) return null; // デモイベントは実スコアに反映しない

    this.state.totalFailureCount++;
    const lucky = Math.random() < LUCKY_FP_CHANCE;
    const multiplier = lucky ? LUCKY_FP_MULT : 1;
    const addedPoints = rollInt(FP_BASE_MIN, FP_BASE_MAX) * multiplier;
    this.state.failurePoints += addedPoints;

    this.saveToStorage();
    this.updateDisplay(true, 'failure', addedPoints, multiplier, lucky);
    return { points: addedPoints, multiplier, lucky };
  }

  private updateDisplay(animate = false, type?: 'success' | 'failure', added = 0, mult = 1, lucky = false) {
    if (!this.successPointsEl) return;

    this.successPointsEl.textContent = this.state.successPoints.toLocaleString();
    this.failurePointsEl.textContent = this.state.failurePoints.toLocaleString();
    this.successCountEl.textContent = this.state.totalSuccessCount.toLocaleString();
    this.failureCountEl.textContent = this.state.totalFailureCount.toLocaleString();

    if (animate && type) {
      const targetEl = type === 'success' ? this.successPointsEl : this.failurePointsEl;
      targetEl.classList.remove('score-bump');
      void targetEl.offsetWidth; // trigger reflow
      targetEl.classList.add('score-bump');

      // 飛翔フローティングバッジ (+XXX XP / +XX FP)
      this.spawnFloatingBadge(type, added, mult, lucky);
    }
  }

  private spawnFloatingBadge(type: 'success' | 'failure', points: number, multiplier = 1, lucky = false) {
    const badge = document.createElement('div');
    badge.className = `score-flying-badge badge-${type}${lucky ? ' badge-lucky' : ''}`;
    const multText = multiplier > 1.15 ? ` (x${multiplier.toFixed(1)})` : '';
    const luckyText = lucky ? ' LUCKY!!' : '';
    badge.textContent = type === 'success' ? `+${points} XP${multText}${luckyText}` : `+${points} FP${multText}${luckyText}`;

    const hudBar = this.container.querySelector('#score-hud');
    if (hudBar) {
      hudBar.appendChild(badge);
      setTimeout(() => badge.remove(), 1200);
    }
  }

  public resetScore() {
    this.state = {
      successPoints: 0,
      failurePoints: 0,
      totalSuccessCount: 0,
      totalFailureCount: 0,
    };
    this.saveToStorage();
    this.updateDisplay(false);
  }

  public getState(): ScoreState {
    return { ...this.state };
  }
}
