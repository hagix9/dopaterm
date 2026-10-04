/**
 * UIオーバーレイ演出エンジン (Dopaterm UI Overlay Engine)
 * ポップアップカード、コンボ表示、TYPO激突、DISASTER、特異点エンドロール
 */

import { ComboRank, FailureCategory, DisasterType } from '../types/events.js';

/** TYPO演出バリアント（演出ディレクターが履歴管理で抽選する） */
export type TypoVariant = 'fall' | 'slam' | 'shatter' | 'crack' | 'eaten' | 'trip' | 'lamp';
export const TYPO_VARIANTS: TypoVariant[] = ['fall', 'slam', 'shatter', 'crack', 'eaten', 'trip', 'lamp'];

export class UiOverlayEngine {
  private container: HTMLElement;
  private activeCardTimeout: any = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 画面全体の色の波（ウォッシュ）。中心から広がり、ゆっくり消える非点滅の残光。
   * clear() の対象外（演出カードが消えても余韻として残る）。pointer-events なし。
   */
  public wash(kind: 'success' | 'failure' | 'gold' | 'rainbow', strength = 1) {
    const host = this.container.parentElement ?? document.body;
    const el = document.createElement('div');
    el.className = `fx-wash fx-wash-${kind}`;
    el.style.setProperty('--wash-s', String(Math.max(0.25, Math.min(1.4, strength))));
    host.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  public showCandidateBanner(cmd: string) {
    this.clear();
    const banner = document.createElement('div');
    banner.className = 'dopa-card dopa-candidate-badge bounce-in';
    banner.innerHTML = `
      <span class="dopa-icon">⚡</span>
      <span class="dopa-text">TARGET: <strong style="color: #FFE600;">${cmd.toUpperCase()}</strong> READY?</span>
    `;
    this.container.appendChild(banner);
  }

  public showTransferChallenge(cmd: string, attempt: number) {
    this.clear();
    const banner = document.createElement('div');
    banner.className = 'dopa-card dopa-challenge-banner pulse-glow';
    banner.innerHTML = `
      <div class="dopa-title">✨ FILE TRANSFER CHALLENGE ✨</div>
      <div class="dopa-transfer-row">
        <span>src/</span>
        <span class="dopa-arrow">━━━━━━━━▶</span>
        <span>backup/</span>
      </div>
      <div class="dopa-sub">ATTEMPT #${attempt}</div>
    `;
    this.container.appendChild(banner);
  }

  private readonly SUCCESS_TITLES = [
    '✨ PERFECT COPY ✨',
    '🎉 BRILLIANT!! 🎉',
    '⚡ SUPERB EXECUTION ⚡',
    '🌟 STELLAR!! 🌟',
    '💎 FLAWLESS!! 💎',
    '🚀 COPY MASTER!! 🚀',
  ];
  private lastTitleIdx = -1;

  public showSuccessCelebration(
    combo: number,
    rank: ComboRank,
    award?: { points: number; multiplier: number; lucky: boolean } | null
  ) {
    this.clear();
    const card = document.createElement('div');
    card.className = `dopa-card dopa-success-card rank-${rank} pop-scale-up`;

    // 直前と同じタイトルは避けて抽選
    let t = Math.floor(Math.random() * this.SUCCESS_TITLES.length);
    while (t === this.lastTitleIdx) t = Math.floor(Math.random() * this.SUCCESS_TITLES.length);
    this.lastTitleIdx = t;
    const title = this.SUCCESS_TITLES[t];

    let rankBadge = 'NORMAL';
    if (rank === 'combo') rankBadge = 'COMBO!';
    else if (rank === 'fever') rankBadge = 'FEVER!!';
    else if (rank === 'hyper_dopa') rankBadge = 'HYPER DOPA!!';

    // 実際に確定した獲得ポイントを表示（デモは award なし → ランク表示のみ）
    const xpText = award
      ? `+${award.points.toLocaleString()} XP${award.multiplier > 1.15 ? ` (x${award.multiplier.toFixed(1)})` : ''}${award.lucky ? ' LUCKY!!' : ''}`
      : `${rankBadge} BONUS!`;

    card.innerHTML = `
      <div class="dopa-crown">👑</div>
      <div class="dopa-perfect-title">${title}</div>
      <div class="dopa-xp-badge">${xpText}</div>
      <div class="dopa-combo-counter">🔥 COPY COMBO x${combo} [${rankBadge}] 🔥</div>
    `;
    this.container.appendChild(card);
    this.wash(rank === 'normal' ? 'success' : rank === 'combo' ? 'success' : 'rainbow',
      rank === 'normal' ? 0.45 : rank === 'combo' ? 0.7 : 1.1);

    // Auto dismiss after 0.8s ~ 1.2s
    const dismissDuration = rank === 'fever' || rank === 'hyper_dopa' ? 1200 : 800;
    this.activeCardTimeout = setTimeout(() => {
      card.classList.add('fade-out');
      setTimeout(() => card.remove(), 250);
    }, dismissDuration);
  }

  public showFailure(category: FailureCategory, failureCombo: number) {
    this.clear();
    const el = document.createElement('div');

    if (category === 'typo') {
      el.className = 'dopa-typo-block slam-down';
      el.innerHTML = `
        <div class="typo-huge">💥 TYPO!! 💥</div>
        <div class="typo-sub">COMMAND NOT FOUND!</div>
        ${failureCombo > 1 ? `<div class="failure-combo">💀 FAILURE COMBO x${failureCombo} 💀</div>` : ''}
      `;
      // Screen shake
      document.body.classList.add('screen-shake');
      setTimeout(() => document.body.classList.remove('screen-shake'), 300);
    } else if (category === 'permission_denied') {
      el.className = 'dopa-padlock-card slam-down';
      el.innerHTML = `
        <div class="padlock-icon">🔒</div>
        <div class="padlock-title">PERMISSION DENIED!</div>
        <div class="padlock-sub">LOCKED BY SYSTEM!</div>
      `;
    } else if (category === 'not_found') {
      el.className = 'dopa-ghost-card float-up';
      el.innerHTML = `
        <div class="ghost-row">🪦 👻</div>
        <div class="ghost-title">FILE NOT FOUND (R.I.P)</div>
      `;
    } else if (category === 'build_failed') {
      el.className = 'dopa-volcano-card pop-scale-up';
      el.innerHTML = `
        <div class="volcano-icon">🌋</div>
        <div class="volcano-title">BUILD ERUPTION! (FAILED)</div>
      `;
    } else {
      el.className = 'dopa-generic-err-card pop-scale-up';
      el.innerHTML = `
        <div class="err-title">⚠️ EXECUTION FAILED ⚠️</div>
      `;
    }

    this.container.appendChild(el);
    this.wash('failure', category === 'typo' ? 1 : 0.7);

    this.activeCardTimeout = setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 250);
    }, 1000);
  }

  /**
   * TYPO専用の演出バリアント。
   * combo が増えるほど文字・エフェクトが大きくなる（FAILURE COMBO 連動）。
   */
  public showTypo(variant: TypoVariant, failureCombo: number) {
    this.clear();
    const el = document.createElement('div');
    const scale = Math.min(1.9, 1 + Math.max(0, failureCombo - 1) * 0.12);
    const comboBadge =
      failureCombo > 1 ? `<div class="failure-combo">💀 FAILURE COMBO x${failureCombo} 💀</div>` : '';

    switch (variant) {
      case 'fall': // 巨大TYPOが上から落下
        el.className = 'typo-fx typo-fall';
        el.innerHTML = `<div class="typo-fall-text" style="--typo-scale:${scale}">TYPO!</div>
          <div class="typo-sub">COMMAND NOT FOUND</div>${comboBadge}`;
        break;
      case 'slam': {
        // 横から飛んで激突（方向ランダム）
        const dir = Math.random() < 0.5 ? -1 : 1;
        el.className = 'typo-fx typo-slam';
        el.innerHTML = `<div class="typo-slam-text" style="--slam-dir:${dir};--typo-scale:${scale}">TYPO!</div>
          <div class="typo-sub">COMMAND NOT FOUND</div>${comboBadge}`;
        break;
      }
      case 'shatter': {
        // 文字が粉々に砕けて飛散（破片スパンをランダム射出）
        const shards = ['T', 'Y', 'P', 'O', '!', '?', '#', '%', '&', '✕'];
        let shardHtml = '';
        for (let i = 0; i < 10 + failureCombo * 2; i++) {
          const dx = (Math.random() - 0.5) * 70;
          const dy = (Math.random() - 0.5) * 55;
          const rot = (Math.random() - 0.5) * 720;
          const ch = shards[Math.floor(Math.random() * shards.length)];
          const delay = Math.random() * 0.08;
          shardHtml += `<span class="typo-shard" style="--dx:${dx}vw;--dy:${dy}vh;--rot:${rot}deg;animation-delay:${delay}s">${ch}</span>`;
        }
        el.className = 'typo-fx typo-shatter';
        el.innerHTML = `<div class="typo-shatter-core" style="--typo-scale:${scale}">TYPO!</div>${shardHtml}${comboBadge}`;
        break;
      }
      case 'crack': {
        // 画面にヒビ（ランダムな放射状ポリライン）
        const cx = 30 + Math.random() * 40;
        const cy = 30 + Math.random() * 40;
        let lines = '';
        const branches = 5 + Math.floor(Math.random() * 3) + Math.min(4, failureCombo);
        for (let i = 0; i < branches; i++) {
          const ang = (Math.PI * 2 * i) / branches + Math.random() * 0.7;
          const len = 12 + Math.random() * 28;
          const mid1 = len * 0.45 + Math.random() * 6;
          const jag1 = (Math.random() - 0.5) * 14;
          const jag2 = (Math.random() - 0.5) * 18;
          const x1 = cx + Math.cos(ang) * mid1 + jag1 * 0.1;
          const y1 = cy + Math.sin(ang) * mid1 - jag1 * 0.1;
          const x2 = cx + Math.cos(ang + jag1 * 0.03) * len;
          const y2 = cy + Math.sin(ang + jag2 * 0.03) * len;
          lines += `<polyline points="${cx},${cy} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" />`;
        }
        el.className = 'typo-fx typo-crack';
        el.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
          <div class="typo-crack-label">*CRACK*</div>${comboBadge}`;
        break;
      }
      case 'eaten': // マスコットが文字を食べる（文字は右上のマスコットへ飛んでいく）
        el.className = 'typo-fx typo-eaten';
        el.innerHTML = `<div class="typo-eaten-text" style="--typo-scale:${scale}">TYPO!</div>${comboBadge}`;
        break;
      case 'trip': // マスコットが転倒（転倒自体は mascot 状態で表現）
        el.className = 'typo-fx typo-trip';
        el.innerHTML = `<div class="typo-trip-text">oops…</div>
          <div class="typo-sub">COMMAND NOT FOUND</div>${comboBadge}`;
        break;
      case 'lamp': // 警告ランプ（カードは控えめ・筐体/縁の警告灯が主役）
        el.className = 'typo-fx typo-lamp';
        el.innerHTML = `<div class="typo-lamp-card">⚠ TYPING ERROR ⚠</div>${comboBadge}`;
        break;
    }

    this.container.appendChild(el);
    const hold = variant === 'crack' ? 1500 : variant === 'eaten' ? 1300 : 1100;
    this.activeCardTimeout = setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 250);
    }, hold);
  }

  /** 低確率: 失敗なのに大当たり風演出（実績は失敗のまま・表示のみ逆転） */
  public showTypoJackpot(failureCombo: number) {
    this.clear();
    const el = document.createElement('div');
    el.className = 'typo-fx typo-jackpot pop-scale-up';
    el.innerHTML = `
      <div class="jackpot-symbols">7️⃣7️⃣7️⃣</div>
      <div class="jackpot-title">JACKPOT!?</div>
      <div class="jackpot-sub">…あれ、コマンド失敗してます</div>
      ${failureCombo > 1 ? `<div class="failure-combo">💀 FAILURE COMBO x${failureCombo} 💀</div>` : ''}
    `;
    this.container.appendChild(el);
    this.wash('gold', 1.2);
    this.activeCardTimeout = setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 300);
    }, 1800);
  }

  public showDisaster(type: DisasterType) {
    this.clear();
    const el = document.createElement('div');
    el.className = 'dopa-disaster-overlay';

    if (type === 'file_explosion') {
      el.innerHTML = `
        <div class="disaster-explosion boom-anim">💣💥 KAPOW!! FILE PURGED! 💥💣</div>
      `;
    } else if (type === 'meteor_collapse') {
      el.innerHTML = `
        <div class="disaster-meteor">☄️ METEOR APOCALYPSE!! MASS DELETION! 🏢🔥</div>
      `;
      document.body.classList.add('screen-shake');
      setTimeout(() => document.body.classList.remove('screen-shake'), 600);
    } else if (type === 'oom_monster') {
      el.innerHTML = `
        <div class="disaster-monster">🦖 NOM NOM! OOM-KILLER DEVOURED YOUR PROCESS!</div>
      `;
    } else if (type === 'game_over') {
      el.innerHTML = `
        <div class="disaster-gameover blink">GAME OVER</div>
        <div class="disaster-staffroll">PROCESS TERMINATED • CREDITS: 00</div>
      `;
    }

    this.container.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 300);
    }, 1400);
  }

  public showSingularityCredits(totalCopies: number) {
    this.clear();
    const el = document.createElement('div');
    el.className = 'dopa-singularity-screen';
    el.innerHTML = `
      <div class="singularity-flash"></div>
      <div class="singularity-why rotating-neon">
        WHY ARE YOU STILL COPYING?
      </div>
      <div class="singularity-counter">★ RECORD COPIES: ${totalCopies.toLocaleString()} ★</div>
      <div class="singularity-credits-roll">
        <div class="credits-content">
          <p>★ DOPATERM SPECIAL THANKS ★</p>
          <p>DIRECTOR: ANTIGRAVITY</p>
          <p>MASCOT: TERMI-NYAN</p>
          <p>DOPAMINE LEVEL: OVER 9000</p>
          <p>TERMINAL: STILL OPERATIONAL</p>
          <p>THANK YOU FOR YOUR INSANE DEDICATION!</p>
        </div>
      </div>
    `;
    this.container.appendChild(el);

    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 1000);
    }, 4500);
  }

  /** SLOT 図柄ボーナス演出（娯楽専用・実績とは無関係） */
  public showSlotBonus(symbols: string, title: string) {
    this.clear();
    const el = document.createElement('div');
    el.className = 'dopa-card dopa-slot-bonus pop-scale-up';
    el.innerHTML = `
      <div class="slot-bonus-symbols">${symbols}</div>
      <div class="slot-bonus-title">🎰 ${title} 🎰</div>
      <div class="dopa-sub">SLOT ENTERTAINMENT — 実績スコアには影響しません</div>
    `;
    this.container.appendChild(el);
    this.wash(title.includes('JACKPOT') ? 'rainbow' : 'gold', title.includes('JACKPOT') ? 1.3 : 0.9);

    this.activeCardTimeout = setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  public clear() {
    if (this.activeCardTimeout) {
      clearTimeout(this.activeCardTimeout);
      this.activeCardTimeout = null;
    }
    this.container.innerHTML = '';
  }
}
