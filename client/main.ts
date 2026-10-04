/**
 * Dopaterm フロントエンドエントリポイント (Client Main)
 * スコア管理・テーマ管理・エフェクトディレクター統合
 * マルチセッション: ローカル / SSH をタブで管理（SessionManager + Launcher）
 */

import { ThemeManager } from './terminal/theme-manager.js';
import { MascotEngine } from './effect/mascot.js';
import { ParticleEngine } from './effect/particles.js';
import { BackgroundEngine } from './effect/background.js';
import { DopatermAudio } from './effect/audio.js';
import { UiOverlayEngine } from './effect/ui-overlay.js';
import { ScoreManager } from './effect/score-manager.js';
import { EffectDirector } from './effect/effect-director.js';
import { DemoRig } from './demo/demo-rig.js';
import { SlotMachine } from './slot/slot-machine.js';
import { SessionManager } from './session/session-manager.js';
import { Launcher } from './session/launcher.js';

function initDopaterm() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token') || '';

  // DOM Elements
  const termContainer = document.getElementById('terminal-container') as HTMLElement;
  const tabBar = document.getElementById('session-tabs') as HTMLElement;
  const bgCanvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
  const bgFallback = document.getElementById('bg-css-fallback') as HTMLElement;
  const fxCanvas = document.getElementById('fx-canvas') as HTMLCanvasElement;
  const mascotContainer = document.getElementById('mascot-container') as HTMLElement;
  const uiCardContainer = document.getElementById('ui-card-container') as HTMLElement;
  const scoreHudContainer = document.getElementById('score-hud-container') as HTMLElement;
  const demoContainer = document.getElementById('demo-container') as HTMLElement;
  const slotContainer = document.getElementById('slot-container') as HTMLElement;
  const topBarRight = document.getElementById('top-bar-right') as HTMLElement;

  // 0. 光過敏配慮（保存済み設定 or OS設定を復元）
  const reducedFlashStored = localStorage.getItem('dopaterm_reduced_flash');
  const reducedFlash =
    reducedFlashStored === '1' ||
    (reducedFlashStored === null && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  document.body.classList.toggle('reduced-flash', reducedFlash);

  // 1. Initialize Score & Theme
  const scoreManager = new ScoreManager(scoreHudContainer);
  const themeManager = new ThemeManager(termContainer);

  // 2. Initialize Effect Engines
  const audio = new DopatermAudio();
  const particles = new ParticleEngine(fxCanvas);
  const background = new BackgroundEngine(bgCanvas, bgFallback);
  const mascot = new MascotEngine(mascotContainer);
  // 花火の打ち上げ・炸裂を音と連動（演出のみ・出力経路は変更しない）
  particles.onLaunch = () => audio.playFireworkLaunch();
  particles.onBurst = (power) => audio.playFireworkPop(power);
  const overlay = new UiOverlayEngine(uiCardContainer);

  // 3. Initialize Effect Director
  const director = new EffectDirector({
    mascot,
    particles,
    background,
    audio,
    overlay,
    scoreManager,
    themeManager,
  });

  // 4. Session Manager（ローカル/SSH タブ）— ランチャーは後で初期化
  const sessionManager = new SessionManager({
    token,
    viewsHost: termContainer,
    tabBar,
    director,
    themeManager,
    onAllClosed: () => launcher.show(),
  });
  const launcher = new Launcher({ sessionManager, token });

  // 5. Initialize Slot Machine (DOPA SLOT MODE) & Demo Rig
  const slotMachine = new SlotMachine({
    container: slotContainer,
    terminalEl: termContainer,
    director,
    mascot,
    particles,
    audio,
    overlay,
    scoreManager,
    onLayoutChanged: () => sessionManager.fitActive(),
  });
  director.onRealResult = (result) => slotMachine.notifyRealResult(result);
  director.onHeatChange = (heat) => slotMachine.setHeat(heat);
  director.onWarningLamp = () => slotMachine.warningFlash();

  // トップバーの SLOT トグルボタン
  const slotToggleBtn = document.createElement('button');
  slotToggleBtn.id = 'btn-slot-mode';
  slotToggleBtn.className = 'topbar-slot-btn';
  slotToggleBtn.textContent = '🎰 SLOT';
  slotToggleBtn.title = 'DOPA SLOT MODE（娯楽演出モード）切替';
  slotToggleBtn.addEventListener('click', () => slotMachine.toggle());
  topBarRight.appendChild(slotToggleBtn);

  // 筐体の見た目的切替: 写真筐体（dopa-real/dopa.jpeg を正本とする） ⇄ 従来の CSS 筐体。
  // 旧筐体の CSS/描画コードは残したまま、見た目だけを切り替える。
  const app = document.getElementById('app');
  const CABINET_KEY = 'dopaterm_cabinet_style';
  const cabBtn = document.createElement('button');
  cabBtn.id = 'btn-cabinet-style';
  cabBtn.className = 'topbar-slot-btn';
  cabBtn.title = '筐体の見た目切替（画像筐体 / 従来CSS筐体）';
  const applyCabinet = (photo: boolean) => {
    app?.classList.toggle('cab-photo', photo);
    cabBtn.classList.toggle('is-on', photo);
    cabBtn.textContent = photo ? '🖼 筐体' : '🎨 筐体';
    try { localStorage.setItem(CABINET_KEY, photo ? 'photo' : 'css'); } catch { /* localStorage 不可は無視 */ }
  };
  cabBtn.addEventListener('click', () => {
    applyCabinet(!app?.classList.contains('cab-photo'));
  });
  topBarRight.appendChild(cabBtn);
  // 既定は写真筐体。SLOT モードの切替とは独立（選択を localStorage に保持する）。
  let savedCabinet: string | null = null;
  try { savedCabinet = localStorage.getItem(CABINET_KEY); } catch { /* localStorage 不可は無視 */ }
  applyCabinet(savedCabinet !== 'css');

  new DemoRig(demoContainer, director, mascot, themeManager, scoreManager, slotMachine);

  // 6. Theme → 全セッション反映（xterm オプション + シェル配色ファイル + 即時再描画）
  themeManager.onThemeChange(() => {
    sessionManager.applyThemeToAll();
    // zsh の dopaterm_theme_refresh ウィジェット (^X^R) でプロンプトをその場再描画。
    // 実行中セッションには送らない（入力がプログラムに流れるため）。
    sessionManager.refreshLocalPrompts();
  });
  // 初期テーマの xterm 適用は各セッション作成時に行われる（ここでは不要）

  // 7. 起動時はランチャーを表示（セッションは未作成）
  launcher.show();

  // デバッグ用フック（DevTools からの状態確認用。外部APIではない）
  (window as any).__dopaterm = { sessionManager, director, themeManager, launcher };

  console.log('✨ Dopaterm Client Initialized (multi-session) ✨');
}

window.addEventListener('DOMContentLoaded', initDopaterm);
