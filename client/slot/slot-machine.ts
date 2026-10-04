/**
 * DOPA SLOT MODE - パチスロ筐体モード (Rev.2: 実機筐体型レイアウト)
 *
 * 実際のパチスロ筐体（縦型前扉）をブラウザ内に再現:
 *   上部マーキー+ランプ → 中央リール窓(=xterm.jsターミナル) →
 *   情報パネル(7seg風) → 下部操作パネル(3停止ボタン+右側レバー) → 底部スピーカー
 *
 * 娯楽専用の演出モード。レバー/停止ボタンは実コマンド・
 * ファイル・実績スコアに一切影響しない。
 */

import { EffectDirector } from '../effect/effect-director.js';
import { MascotEngine } from '../effect/mascot.js';
import { ParticleEngine } from '../effect/particles.js';
import { DopatermAudio } from '../effect/audio.js';
import { UiOverlayEngine } from '../effect/ui-overlay.js';
import { ScoreManager } from '../effect/score-manager.js';

export interface SlotMachineOptions {
  container: HTMLElement; // #slot-container
  terminalEl: HTMLElement; // #terminal-container（移動対象）
  director: EffectDirector;
  mascot: MascotEngine;
  particles: ParticleEngine;
  audio: DopatermAudio;
  overlay: UiOverlayEngine;
  scoreManager: ScoreManager;
  /** ターミナル再配置後に呼ぶリサイズ処理 */
  onLayoutChanged: () => void;
}

type ReelSymbol = '7' | '★' | '♪' | '◆' | '⚡' | '☢' | '♥' | '☠';
const SYMBOLS: ReelSymbol[] = ['7', '★', '♪', '◆', '⚡', '☢', '♥', '☠'];
const LAMP_COUNT = 10;
const SIDE_LAMP_COUNT = 6;

export class SlotMachine {
  private opts: SlotMachineOptions;
  private cabinet!: HTMLElement;
  private screenSlot!: HTMLElement;
  private leverEl!: HTMLElement;
  private stopBtns: HTMLElement[] = [];
  private reelCells: HTMLElement[] = [];
  private reelWins: HTMLElement[] = [];
  private marqueeLamps: HTMLElement[] = [];
  private statEls: { xp?: HTMLElement; fp?: HTMLElement; combo?: HTMLElement; level?: HTMLElement } = {};
  /** 写真筐体モード（元画像右側）の 7 セグ表示。既存の 7seg 筐体とは別。 */
  private segEls: { credit?: HTMLElement; win?: HTMLElement; count?: HTMLElement } = {};

  private active = false;
  private spinning: boolean[] = [false, false, false];
  private spinTimers: number[] = [0, 0, 0];
  private reelResults: (ReelSymbol | null)[] = [null, null, null];
  private statsTimer: number | null = null;
  private lampChaseTimer: number | null = null;

  // #terminal-container の元の親/位置（通常モード復帰用）
  private originalParent: HTMLElement | null = null;
  private originalNextSibling: Node | null = null;

  constructor(opts: SlotMachineOptions) {
    this.opts = opts;
    this.build();
  }

  private build() {
    const marqueeLamps = Array.from({ length: LAMP_COUNT }, (_, i) =>
      `<span class="m-lamp" data-lamp="${i}"></span>`
    ).join('');
    const sideLamps = (side: string) =>
      `<div class="side-lamps side-lamps-${side}">` +
      Array.from({ length: SIDE_LAMP_COUNT }, (_, i) =>
        `<span class="s-lamp" data-side="${side}" data-idx="${i}"></span>`
      ).join('') +
      `</div>`;

    const reelStrip = (i: number) =>
      Array.from({ length: SYMBOLS.length * 2 }, (_, k) => {
        const idx = (k + i * 3) % SYMBOLS.length;
        return `<span class="reel-sym" data-s="${idx}">${SYMBOLS[idx]}</span>`;
      }).join('');
    const nb = (idx: number, dir: string) =>
      `<span class="reel-nb reel-${dir}" data-s="${idx}">${SYMBOLS[idx]}</span>`;
    const reelWin = (i: number) => `
            <div class="reel-win" data-reel-win="${i}">
              <div class="reel-strip" style="--roll:${0.34 + i * 0.04}s">${reelStrip(i)}</div>
              <div class="reel-col">
                ${nb((i * 3 + 1) % SYMBOLS.length, 'up')}
                <div class="reel-cell" data-reel="${i}" data-s="${i}">${SYMBOLS[i]}</div>
                ${nb((i * 3 + 4) % SYMBOLS.length, 'down')}
              </div>
              <div class="reel-glass"></div>
            </div>`;

    this.opts.container.innerHTML = `
      <div id="slot-cabinet" class="slot-cabinet" aria-hidden="true">
        <!-- 台上: 左右のドームランプ + 上パネル（ロゴ・電飾） -->
        <div class="cab-marquee">
          <div class="dome-lamp dome-left"><i class="dl-glow"></i><i class="dl-ring"></i><i class="dl-glass"></i></div>
          <div class="marquee-frame">
            <div class="marquee-lamps marquee-lamps-top">${marqueeLamps}</div>
            <div class="marquee-inner">
              <div class="marquee-logo">DOPA SLOT</div>
              <div class="marquee-sub">AMUSEMENT TERMINAL MACHINE</div>
            </div>
            <div class="marquee-lamps marquee-lamps-bottom">${marqueeLamps}</div>
          </div>
          <div class="dome-lamp dome-right"><i class="dl-glow"></i><i class="dl-ring"></i><i class="dl-glass"></i></div>
        </div>

        <!-- 上部液晶（=ターミナル）: メッキの太枠＋サイドランプ -->
        <div class="cab-window-row">
          ${sideLamps('left')}
          <div class="reel-window-frame">
            <div class="reel-window-bezel">
              <div class="win-line win-line-1"></div>
              <div class="win-line win-line-2"></div>
              <div class="win-line win-line-3"></div>
              <div id="slot-screen" class="slot-screen"></div>
            </div>
          </div>
          ${sideLamps('right')}
        </div>

        <!-- 中パネル: 左（クレジット類）| 3連の縦回転リール窓 | 右（ボーナス類）+ 告知ランプ -->
        <div class="cab-reels">
          <div class="reel-flank flank-left">
            <div class="info-seg info-xp"><span class="info-label">XP</span><span id="cab-xp" class="seg-digits">0</span></div>
            <div class="info-seg info-fp"><span class="info-label">FP</span><span id="cab-fp" class="seg-digits">0</span></div>
            <div class="ind-row"><span class="ind-lamp ind-insert">INSERT</span><span class="ind-lamp ind-start">START</span></div>
          </div>

          <div class="reel-center">
            <div class="reel-bank">
              <svg class="paylines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <line class="pl pl-top" x1="0" y1="16.6" x2="100" y2="16.6"/>
                <line class="pl pl-mid" x1="0" y1="50" x2="100" y2="50"/>
                <line class="pl pl-bot" x1="0" y1="83.4" x2="100" y2="83.4"/>
                <line class="pl pl-d1" x1="0" y1="16.6" x2="100" y2="83.4"/>
                <line class="pl pl-d2" x1="0" y1="83.4" x2="100" y2="16.6"/>
              </svg>
              <span class="payline-mark payline-l">▶</span>
              ${[0, 1, 2].map(reelWin).join('')}
              <span class="payline-mark payline-r">◀</span>
            </div>
            <!-- 告知ランプ: Termi-Nyan のドーム。勝利/揃いで点灯 -->
            <div class="notice-lamp"><span class="nl-ear nl-ear-l"></span><span class="nl-ear nl-ear-r"></span><span class="nl-face">^ ^</span><span class="nl-cap">NYAN LAMP</span></div>
          </div>

          <div class="reel-flank flank-right">
            <div class="info-seg info-combo"><span class="info-label">COMBO</span><span id="cab-combo" class="seg-digits">0</span></div>
            <div class="info-seg info-level"><span class="info-label">LV</span><span id="cab-level" class="seg-digits">3</span></div>
            <div class="ind-row"><span class="ind-lamp ind-replay">REPLAY</span><span class="ind-lamp ind-win">WIN</span></div>
          </div>
        </div>

        <!-- 下パネル（操作デッキ）: 左レバー | BET | 中央に横並び3停止ボタン | 投入口/精算 -->
        <div class="cab-panel">
          <div class="lever-mount">
            <div id="slot-lever" class="slot-lever" role="button" tabindex="0" aria-label="スタートレバー">
              <div class="lever-shaft"></div>
              <div class="lever-ball"></div>
            </div>
            <div class="lever-base"></div>
            <div class="lever-label">START</div>
          </div>

          <div class="bet-plate">
            <div class="bet-lamps"><i></i><i></i><i></i></div>
            <div class="bet-btn">MAX BET</div>
          </div>

          <div class="stop-cluster">
            <button class="stop-btn" data-reel="0" disabled><span class="btn-cap"></span><span class="btn-text">L</span></button>
            <button class="stop-btn" data-reel="1" disabled><span class="btn-cap"></span><span class="btn-text">C</span></button>
            <button class="stop-btn" data-reel="2" disabled><span class="btn-cap"></span><span class="btn-text">R</span></button>
          </div>

          <div class="coin-plate">
            <div class="coin-slot"><span></span></div>
            <div class="settle-btn">精算</div>
          </div>
        </div>

        <!-- 最下部: メダル受け皿（クロームの縁） -->
        <div class="medal-tray"><span></span></div>

        <!-- 写真筐体モード用: 元画像の右側にある 7 セグ表示の桁部分。
             CSS 筐体モードでは隠される（既存デザインには現れない）。 -->
        <div class="cab-seg seg-credit" data-seg="credit">0</div>
        <div class="cab-seg seg-win" data-seg="win">0</div>
        <div class="cab-seg seg-count" data-seg="count">0</div>
      </div>
    `;

    this.cabinet = this.opts.container.querySelector('#slot-cabinet') as HTMLElement;
    this.screenSlot = this.opts.container.querySelector('#slot-screen') as HTMLElement;
    this.leverEl = this.opts.container.querySelector('#slot-lever') as HTMLElement;
    this.stopBtns = Array.from(this.opts.container.querySelectorAll('.stop-btn')) as HTMLElement[];
    this.reelCells = Array.from(this.opts.container.querySelectorAll('.reel-cell')) as HTMLElement[];
    this.reelWins = Array.from(this.opts.container.querySelectorAll('.reel-win')) as HTMLElement[];
    this.marqueeLamps = Array.from(this.opts.container.querySelectorAll('.m-lamp, .s-lamp')) as HTMLElement[];
    this.statEls = {
      xp: this.opts.container.querySelector('#cab-xp') as HTMLElement,
      fp: this.opts.container.querySelector('#cab-fp') as HTMLElement,
      combo: this.opts.container.querySelector('#cab-combo') as HTMLElement,
      level: this.opts.container.querySelector('#cab-level') as HTMLElement,
    };
    this.segEls = {
      credit: this.opts.container.querySelector('[data-seg="credit"]') as HTMLElement,
      win: this.opts.container.querySelector('[data-seg="win"]') as HTMLElement,
      count: this.opts.container.querySelector('[data-seg="count"]') as HTMLElement,
    };

    this.leverEl.addEventListener('click', () => this.pullLever());
    this.leverEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this.pullLever();
    });
    this.stopBtns.forEach((btn, i) => {
      btn.addEventListener('click', () => this.stopReel(i));
    });
  }

  /** モード切替。xterm.js インスタンスは DOM ごと移動するため維持される */
  public toggle(active?: boolean) {
    const next = active ?? !this.active;
    if (next === this.active) return;
    this.active = next;

    const app = document.getElementById('app');
    const term = this.opts.terminalEl;

    if (this.active) {
      this.originalParent = term.parentElement;
      this.originalNextSibling = term.nextSibling;
      this.screenSlot.appendChild(term);
      app?.classList.add('slot-mode');
      this.refreshStats();
      this.statsTimer = window.setInterval(() => this.refreshStats(), 500);
      this.startLampChase();
    } else {
      app?.classList.remove('slot-mode');
      this.stopAllSpinning(true);
      this.stopLampChase();
      if (this.statsTimer !== null) {
        clearInterval(this.statsTimer);
        this.statsTimer = null;
      }
      if (this.originalParent) {
        this.originalParent.insertBefore(term, this.originalNextSibling);
      }
    }

    // レイアウト変化後に xterm.js を再フィット
    requestAnimationFrame(() => this.opts.onLayoutChanged());
  }

  public isActive() {
    return this.active;
  }

  /** 電飾チェイス（回転中以外も常時ゆるやかに巡回） */
  private startLampChase() {
    if (this.lampChaseTimer !== null) return;
    let phase = 0;
    this.lampChaseTimer = window.setInterval(() => {
      if (document.body.classList.contains('reduced-flash')) return;
      phase++;
      this.marqueeLamps.forEach((lamp) => {
        const idx = Number(lamp.dataset.lamp ?? lamp.dataset.idx ?? 0);
        lamp.classList.toggle('lamp-on', (idx + phase) % 3 === 0);
      });
    }, 220);
  }

  private stopLampChase() {
    if (this.lampChaseTimer !== null) {
      clearInterval(this.lampChaseTimer);
      this.lampChaseTimer = null;
    }
    this.marqueeLamps.forEach((l) => l.classList.remove('lamp-on'));
  }

  /** 筐体ステータス表示の更新（実績は参照のみ・変更しない） */
  private refreshStats() {
    if (!this.active) return;
    const s = this.opts.scoreManager.getState();
    const c = this.opts.director.getComboStats();
    if (this.statEls.xp) this.statEls.xp.textContent = s.successPoints.toLocaleString();
    if (this.statEls.fp) this.statEls.fp.textContent = s.failurePoints.toLocaleString();
    if (this.statEls.combo) this.statEls.combo.textContent = String(c.successCombo);
    if (this.statEls.level) this.statEls.level.textContent = String(this.opts.director.getEffectLevel());
    // 写真筐体の 7 セグ: CREDIT=XP / WIN=FP / COUNT=LV（桁は 2 桁に収める）
    const two = (n: number) => String(Math.floor(n) % 100).padStart(2, '0');
    if (this.segEls.credit) this.segEls.credit.textContent = two(s.successPoints);
    if (this.segEls.win) this.segEls.win.textContent = two(s.failurePoints);
    if (this.segEls.count) this.segEls.count.textContent = two(this.opts.director.getEffectLevel());
    const hot = this.cabinet.classList.contains('cab-win') || this.cabinet.classList.contains('cab-jackpot');
    this.segEls.win?.classList.toggle('is-hot', hot);
    this.cabinet.classList.toggle('cab-singularity', c.rank === 'singularity');
    this.cabinet.classList.toggle('cab-hyper', c.rank === 'hyper_dopa');
    this.cabinet.classList.toggle('cab-fever', c.rank === 'fever');
  }

  /** TYPO警告ランプ: マーキーが短時間赤く点灯（非点滅のため光過敏に安全） */
  public warningFlash(ms = 900) {
    if (!this.active) return;
    this.cabinet.classList.add('cab-warning');
    setTimeout(() => this.cabinet.classList.remove('cab-warning'), ms);
  }

  /** 熱量に連動した筐体の発光（0-1）。演出レベルや操作状態で段階的に変化 */
  public setHeat(heat: number) {
    if (!this.active) return;
    this.cabinet.classList.toggle('cab-heated', heat > 0.35);
    this.cabinet.classList.toggle('cab-blazing', heat > 0.7);
  }

  /** 実コマンドの成否に連動した筐体リアクション（結果は変更しない） */
  public notifyRealResult(result: 'success' | 'failure') {
    if (!this.active) return;
    this.cabinet.classList.remove('cab-win', 'cab-lose');
    void this.cabinet.offsetWidth; // reflow
    this.cabinet.classList.add(result === 'success' ? 'cab-win' : 'cab-lose');
    setTimeout(() => this.cabinet.classList.remove('cab-win', 'cab-lose'), 700);
    this.refreshStats();
  }

  /** レバー: 演出のみ。シェルへは何も送信しない */
  private pullLever() {
    if (this.spinning.some((s) => s)) return; // 回転中は無視

    // レバー倒し→自動復帰アニメーション
    this.leverEl.classList.add('pulled');
    this.cabinet.classList.add('cab-flash');
    setTimeout(() => {
      this.leverEl.classList.remove('pulled');
      this.cabinet.classList.remove('cab-flash');
    }, 550);

    try {
      this.opts.audio.playLeverPull();
      this.opts.mascot.setState('transfer');
      setTimeout(() => this.opts.mascot.setState('idle'), 900);
      this.opts.particles.emitLaserBeams(4);
    } catch {}

    this.reelResults = [null, null, null];
    for (let i = 0; i < 3; i++) {
      this.spinning[i] = true;
      this.reelCells[i].classList.add('spinning');
      this.reelCells[i].classList.remove('landed');
      this.reelWins[i]?.classList.add('spinning');
      this.reelWins[i]?.classList.remove('landed', 'hit');
      this.stopBtns[i].removeAttribute('disabled');
      this.spinTimers[i] = window.setInterval(() => {
        this.setSym(this.reelCells[i], this.randSymbol());
        this.shuffleNeighbours(i);
      }, 45 + i * 10);
    }
  }

  private stopReel(i: number) {
    if (!this.spinning[i]) return;
    clearInterval(this.spinTimers[i]);
    this.spinning[i] = false;
    this.stopBtns[i].setAttribute('disabled', '');

    // 押し込み演出（ボタンが物理的に沈む）
    this.stopBtns[i].classList.add('btn-pressed');
    setTimeout(() => this.stopBtns[i].classList.remove('btn-pressed'), 220);

    // 図柄決定: 1列目が止まった後は一定確率で揃いやすくする（娯楽演出のみ）
    const first = this.reelResults[0];
    let symbol: ReelSymbol;
    if (first && i > 0 && Math.random() < 0.22) {
      symbol = first;
    } else {
      const weights = SYMBOLS.flatMap((s) => Array(s === '7' ? 2 : 10).fill(s));
      symbol = weights[Math.floor(Math.random() * weights.length)];
    }
    this.reelResults[i] = symbol;

    const el = this.reelCells[i];
    el.classList.remove('spinning');
    this.setSym(el, symbol);
    el.classList.add('landed');
    this.reelWins[i]?.classList.remove('spinning');
    this.reelWins[i]?.classList.add('landed');
    this.shuffleNeighbours(i);

    try {
      this.opts.audio.playReelStop();
      this.cabinet.classList.add('cab-shock');
      setTimeout(() => this.cabinet.classList.remove('cab-shock'), 300);
    } catch {}

    if (!this.spinning.some((s) => s)) {
      this.evaluate();
    }
  }

  private stopAllSpinning(silent = false) {
    for (let i = 0; i < 3; i++) {
      if (this.spinning[i]) {
        clearInterval(this.spinTimers[i]);
        this.spinning[i] = false;
        this.reelCells[i].classList.remove('spinning');
        this.reelWins[i]?.classList.remove('spinning');
        this.stopBtns[i].setAttribute('disabled', '');
      }
    }
    if (!silent) this.evaluate();
  }

  private randSymbol(): ReelSymbol {
    return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  }

  /** 図柄の表示更新（textContent は判定に使う値。data-s は色分け用の装飾属性） */
  private setSym(el: Element, sym: ReelSymbol) {
    el.textContent = sym;
    (el as HTMLElement).dataset.s = String(SYMBOLS.indexOf(sym));
  }

  /** リール窓の上下の隣接図柄（装飾のみ。判定には一切使わない） */
  private shuffleNeighbours(i: number) {
    this.reelWins[i]?.querySelectorAll('.reel-nb').forEach((el) => {
      this.setSym(el, this.randSymbol());
    });
  }

  /** 図柄評価。結果は画面上の演出のみで、実績スコアには反映しない */
  private evaluate() {
    const [a, b, c] = this.reelResults;
    if (!a || !b || !c) return;

    if (a === b && b === c) {
      this.reelWins.forEach((w) => w.classList.add('hit'));
      this.cabinet.classList.add('cab-triple');
      setTimeout(() => {
        this.reelWins.forEach((w) => w.classList.remove('hit'));
        this.cabinet.classList.remove('cab-triple');
      }, 2600);
    }

    try {
      if (a === '7' && b === '7' && c === '7') {
        // 777 JACKPOT
        this.opts.audio.playSingularityJingle();
        this.opts.overlay.showSlotBonus('777', 'DOPA JACKPOT!!');
        this.opts.particles.emitConfetti(320);
        this.opts.particles.emitFireworks(120);
        this.opts.particles.emitCoins(50);
        this.opts.mascot.setState('success');
        this.cabinet.classList.add('cab-jackpot');
        setTimeout(() => {
          this.opts.mascot.setState('idle');
          this.cabinet.classList.remove('cab-jackpot');
        }, 2500);
      } else if (a === b && b === c) {
        // 三揃い BONUS
        this.opts.audio.playFeverFanfare();
        this.opts.overlay.showSlotBonus(`${a}${b}${c}`, 'TRIPLE BONUS!');
        this.opts.particles.emitConfetti(160);
        this.opts.particles.emitCoins(25);
        this.opts.mascot.setState('success');
        setTimeout(() => this.opts.mascot.setState('idle'), 1500);
      } else {
        this.opts.audio.playBlip();
      }
    } catch {}
  }
}
