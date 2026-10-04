/**
 * 演出デモ＆設定パネル (Dopaterm Showcase & Settings Rig)
 * 完全日本語化UI・テーマ切り替え・カスタムカラー・コンボテスト・SLOT切替・安全なモック演出
 */

import { EffectDirector } from '../effect/effect-director.js';
import { MascotEngine, MascotState } from '../effect/mascot.js';
import {
  ThemeManager,
  ThemeId,
  DOPATERM_THEMES,
  ANSI16_KEYS,
  CustomThemeData,
} from '../terminal/theme-manager.js';
import { ScoreManager } from '../effect/score-manager.js';
import { SlotMachine } from '../slot/slot-machine.js';
import { FailureCategory, DisasterType } from '../types/events.js';

const ANSI16_LABELS: Record<string, string> = {
  black: '黒',
  red: '赤',
  green: '緑',
  yellow: '黄',
  blue: '青',
  magenta: 'マゼンタ',
  cyan: 'シアン',
  white: '白',
  brightBlack: '明黒',
  brightRed: '明赤',
  brightGreen: '明緑',
  brightYellow: '明黄',
  brightBlue: '明青',
  brightMagenta: '明マゼンタ',
  brightCyan: '明シアン',
  brightWhite: '明白',
};

export class DemoRig {
  private container: HTMLElement;
  private director: EffectDirector;
  private mascot: MascotEngine;
  private themeManager?: ThemeManager;
  private scoreManager?: ScoreManager;
  private slotMachine?: SlotMachine;
  private isOpen = false;

  constructor(
    container: HTMLElement,
    director: EffectDirector,
    mascot: MascotEngine,
    themeManager?: ThemeManager,
    scoreManager?: ScoreManager,
    slotMachine?: SlotMachine
  ) {
    this.container = container;
    this.director = director;
    this.mascot = mascot;
    this.themeManager = themeManager;
    this.scoreManager = scoreManager;
    this.slotMachine = slotMachine;

    this.render();
    this.bindEvents();
  }

  private render() {
    const currentTheme = this.themeManager ? this.themeManager.getTheme().id : 'toxic_neon';
    const c = this.themeManager ? this.themeManager.getCustomData() : null;
    const reducedFlash = document.body.classList.contains('reduced-flash');

    this.container.innerHTML = `
      <div id="demo-rig-panel" class="demo-rig-panel closed">
        <button id="demo-rig-toggle" class="demo-toggle-btn" title="演出デモと設定を開く">
          🛠 演出デモ・設定
        </button>

        <div class="demo-rig-content">
          <div class="demo-header">
            <h3>✨ DOPATERM 演出デモ & 設定 ✨</h3>
            <span class="demo-sub">実際のシェルコマンドを実行せずに安全にお試しいただけます</span>
          </div>

          <!-- 0. カラーテーマ設定 -->
          <div class="demo-section">
            <label class="demo-label">
              <span>🎨 ターミナルカラーテーマ:</span>
            </label>
            <select id="theme-select" class="demo-select">
              ${Object.values(DOPATERM_THEMES)
                .map(
                  (t) => `
                <option value="${t.id}" ${t.id === currentTheme ? 'selected' : ''}>
                  ${t.nameJa}
                </option>
              `
                )
                .join('')}
              <option value="custom" ${currentTheme === 'custom' ? 'selected' : ''}>CUSTOM (自由色)</option>
            </select>
            <div id="theme-desc" class="demo-hint-text">
              ${this.themeManager ? this.themeManager.getTheme().descriptionJa : ''}
            </div>
          </div>

          <!-- 0.5 カスタムカラー -->
          <div class="demo-section">
            <label class="demo-label"><span>🌈 カスタムカラー（自由設定）:</span></label>
            <div class="demo-hint-text">
              変更すると CUSTOM テーマに自動切替・保存されます。<br>
              ※プロンプト色・入力文字色はシェル連携で次回プロンプト表示から反映されます。
            </div>
            <div class="color-grid">
              <label>背景色 <input type="color" data-cfield="background" /></label>
              <label>文字色 <input type="color" data-cfield="foreground" /></label>
              <label>入力文字色 <input type="color" data-cfield="inputColorHex" /></label>
              <label>プロンプト色 <input type="color" data-cfield="promptColorHex" /></label>
              <label>カーソル色 <input type="color" data-cfield="cursor" /></label>
              <label>選択範囲 <input type="color" data-cfield="selectionBackground" /></label>
              <label>枠の発光色 <input type="color" data-cfield="borderGlowColor" /></label>
            </div>
            <label class="demo-label" style="margin-top:8px;">
              <span>カーソル形状:</span>
              <select id="cursor-style-select" class="demo-select" style="width:55%;">
                <option value="block">■ ブロック</option>
                <option value="underline">＿ 下線</option>
                <option value="bar">｜ バー</option>
              </select>
            </label>
            <div class="demo-label"><span>ANSI 基本16色:</span></div>
            <div class="ansi-grid" id="ansi-grid">
              ${ANSI16_KEYS.map(
                (k) => `
                <label class="ansi-cell" title="${k}">
                  <input type="color" data-ansi="${k}" />
                  <span>${ANSI16_LABELS[k] || k}</span>
                </label>
              `
              ).join('')}
            </div>
            <button id="btn-copy-preset" class="demo-btn-sm" style="margin-top:6px;">
              📋 現在のプリセット配色を土台にコピー
            </button>
          </div>

          <!-- 0.7 表示モード・配慮設定 -->
          <div class="demo-section">
            <div class="demo-label"><span>🖥 表示モード・配慮設定:</span></div>
            <div class="demo-button-grid">
              <button id="btn-slot-toggle" class="demo-action-btn slot-btn" style="grid-column: span 2;">
                🎰 DOPA SLOT MODE 切替
              </button>
            </div>
            <label class="demo-check">
              <input type="checkbox" id="chk-reduced-flash" ${reducedFlash ? 'checked' : ''} />
              ⚡ 激しい点滅を抑える（光過敏配慮）
            </label>
          </div>

          <!-- 1. 演出の派手さ (Effect Level) -->
          <div class="demo-section">
            <label class="demo-label">
              <span>⚡ 演出の派手さ (0:OFF 〜 5:GPU負荷全開):</span>
              <strong id="demo-level-val" style="color: #FFE600;">3</strong>
            </label>
            <input type="range" id="demo-level-slider" min="0" max="5" step="1" value="3" class="demo-slider" />
            <div class="demo-level-desc" id="demo-level-desc">Level 3: DOPAMINE (コンボ・音響・画面揺れ)</div>
          </div>

          <!-- 2. コンボ数のテスト (Combo Simulator) -->
          <div class="demo-section">
            <label class="demo-label">
              <span>🎯 コンボ数のテスト (段階変化):</span>
              <strong id="demo-combo-val" style="color: #00F5D4;">1</strong>
            </label>
            <input type="range" id="demo-combo-slider" min="1" max="10000" step="1" value="1" class="demo-slider" />
            <div class="demo-button-row">
              <button class="demo-btn-sm" data-combo="1">x1 (通常)</button>
              <button class="demo-btn-sm" data-combo="10">x10 (COMBO!)</button>
              <button class="demo-btn-sm" data-combo="100">x100 (FEVER!!)</button>
              <button class="demo-btn-sm" data-combo="1000">x1,000 (HYPER)</button>
              <button class="demo-btn-sm" data-combo="10000" style="color: #FF1B8D; font-weight: bold;">x10,000 (特異点)</button>
            </div>
          </div>

          <!-- 3. 成功・お祝い演出テスト -->
          <div class="demo-section">
            <div class="demo-label"><span>🎉 成功・お祝い演出の再生:</span></div>
            <div class="demo-button-grid">
              <button id="btn-demo-success" class="demo-action-btn success-btn">
                ✨ cp 成功演出を再生 (+XP)
              </button>
              <button id="btn-demo-singularity" class="demo-action-btn singularity-btn">
                🌌 10,000回特異点演出 (エンドロール)
              </button>
            </div>
            <div class="demo-hint-text">※デモ再生は実際のスコアには加算されません</div>
          </div>

          <!-- 4. 失敗・タイプミス演出テスト -->
          <div class="demo-section">
            <div class="demo-label"><span>💥 失敗・タイプミス演出の再生:</span></div>
            <div class="demo-button-grid">
              <button class="demo-action-btn fail-btn" data-fail="typo">
                💥 TYPO!! 激突
              </button>
              <button class="demo-action-btn fail-btn" data-fail="permission_denied">
                🔒 南京錠 (権限なし)
              </button>
              <button class="demo-action-btn fail-btn" data-fail="not_found">
                🪦 墓石と幽霊 (ファイル不在)
              </button>
              <button class="demo-action-btn fail-btn" data-fail="build_failed">
                🌋 火山噴火 (ビルド失敗)
              </button>
            </div>
          </div>

          <!-- 5. 大惨事モード (DISASTER MODE) -->
          <div class="demo-section">
            <div class="demo-label"><span>🚨 大惨事モード (DISASTER MODE):</span></div>
            <div class="demo-button-grid">
              <button class="demo-action-btn disaster-btn" data-disaster="file_explosion">
                💣 ファイル大爆発 (rm)
              </button>
              <button class="demo-action-btn disaster-btn" data-disaster="meteor_collapse">
                ☄️ ビル倒壊・巨大隕石
              </button>
              <button class="demo-action-btn disaster-btn" data-disaster="waterlogging">
                🌊 画面水没 (容量不足)
              </button>
              <button class="demo-action-btn disaster-btn" data-disaster="oom_monster">
                🦖 怪獣丸呑み (OOM)
              </button>
              <button class="demo-action-btn disaster-btn" data-disaster="game_over" style="grid-column: span 2;">
                👾 GAME OVER 画面 (プロセス停止)
              </button>
            </div>
          </div>

          <!-- 6. ターミにゃん ポーズ確認 -->
          <div class="demo-section">
            <div class="demo-label"><span>🐱 ターミにゃんのアクション確認:</span></div>
            <div class="demo-button-row">
              <button class="demo-btn-sm mascot-pose" data-pose="idle">通常浮遊</button>
              <button class="demo-btn-sm mascot-pose" data-pose="candidate">構え</button>
              <button class="demo-btn-sm mascot-pose" data-pose="transfer">高速トス</button>
              <button class="demo-btn-sm mascot-pose" data-pose="success">勝利ダンス</button>
              <button class="demo-btn-sm mascot-pose" data-pose="failure">転ぶ(コケる)</button>
              <button class="demo-btn-sm mascot-pose" data-pose="singularity">巨大乱入</button>
            </div>
          </div>

          <!-- 7. スコア管理 -->
          <div class="demo-section" style="border-bottom: none;">
            <div class="demo-label"><span>📊 スコア記録:</span></div>
            <button id="btn-reset-score" class="demo-btn-reset">
              🔄 累積スコアをリセット
            </button>
          </div>
        </div>
      </div>
    `;

    this.syncColorInputs();
  }

  /** カスタムカラー入力欄を現在値に同期 */
  private syncColorInputs() {
    if (!this.themeManager) return;
    const c: CustomThemeData = this.themeManager.getCustomData();

    this.container.querySelectorAll('[data-cfield]').forEach((el) => {
      const input = el as HTMLInputElement;
      const field = input.dataset.cfield as keyof CustomThemeData;
      const val = c[field];
      if (typeof val === 'string') input.value = val;
    });

    const cursorSel = this.container.querySelector('#cursor-style-select') as HTMLSelectElement;
    if (cursorSel) cursorSel.value = c.cursorStyle;

    this.container.querySelectorAll('[data-ansi]').forEach((el) => {
      const input = el as HTMLInputElement;
      const key = input.dataset.ansi as keyof CustomThemeData['ansi16'];
      input.value = c.ansi16[key] || '#FFFFFF';
    });
  }

  private bindEvents() {
    const toggleBtn = this.container.querySelector('#demo-rig-toggle') as HTMLElement;
    const panel = this.container.querySelector('#demo-rig-panel') as HTMLElement;
    const comboSlider = this.container.querySelector('#demo-combo-slider') as HTMLInputElement;
    const comboVal = this.container.querySelector('#demo-combo-val') as HTMLElement;
    const levelSlider = this.container.querySelector('#demo-level-slider') as HTMLInputElement;
    const levelVal = this.container.querySelector('#demo-level-val') as HTMLElement;
    const levelDesc = this.container.querySelector('#demo-level-desc') as HTMLElement;
    const themeSelect = this.container.querySelector('#theme-select') as HTMLSelectElement;
    const themeDesc = this.container.querySelector('#theme-desc') as HTMLElement;

    // 開閉トグル
    toggleBtn.addEventListener('click', () => {
      this.isOpen = !this.isOpen;
      panel.classList.toggle('closed', !this.isOpen);
    });

    // テーマ選択
    themeSelect.addEventListener('change', () => {
      const selectedId = themeSelect.value as ThemeId;
      if (this.themeManager) {
        this.themeManager.setTheme(selectedId);
        themeDesc.textContent = this.themeManager.getTheme().descriptionJa;
      }
    });

    // カスタムカラー: 基本フィールド
    this.container.querySelectorAll('[data-cfield]').forEach((el) => {
      el.addEventListener('input', () => {
        if (!this.themeManager) return;
        const input = el as HTMLInputElement;
        const field = input.dataset.cfield as keyof CustomThemeData;
        this.themeManager.setCustomField(field, input.value as never);
        this.syncThemeSelect();
      });
    });

    // カーソル形状
    this.container.querySelector('#cursor-style-select')?.addEventListener('change', (e) => {
      if (!this.themeManager) return;
      this.themeManager.setCustomField('cursorStyle', (e.target as HTMLSelectElement).value as never);
      this.syncThemeSelect();
    });

    // ANSI 16色
    this.container.querySelectorAll('[data-ansi]').forEach((el) => {
      el.addEventListener('input', () => {
        if (!this.themeManager) return;
        const input = el as HTMLInputElement;
        this.themeManager.setCustomAnsi(input.dataset.ansi as never, input.value);
        this.syncThemeSelect();
      });
    });

    // プリセット配色をカスタム土台にコピー
    this.container.querySelector('#btn-copy-preset')?.addEventListener('click', () => {
      if (!this.themeManager) return;
      const id = this.themeManager.getThemeId();
      const base = id === 'custom' ? 'toxic_neon' : id;
      this.themeManager.loadPresetIntoCustom(base);
      this.syncColorInputs();
      this.syncThemeSelect();
    });

    // SLOT MODE 切替
    this.container.querySelector('#btn-slot-toggle')?.addEventListener('click', () => {
      this.slotMachine?.toggle();
    });

    // 点滅抑制
    this.container.querySelector('#chk-reduced-flash')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      document.body.classList.toggle('reduced-flash', on);
      localStorage.setItem('dopaterm_reduced_flash', on ? '1' : '0');
    });

    // 演出レベルスライダー
    const levelDescs = [
      'Level 0: OFF (素のターミナル・演出完全停止)',
      'Level 1: LOW (控えめな動き・軽量)',
      'Level 2: HIGH (多色・パーティクル・ポップアップ)',
      'Level 3: DOPAMINE (標準: コンボ・音響・シェイク)',
      'Level 4: ABSURD (狂気の祝賀会・花火・レーザー)',
      'Level 5: GPU ABUSE (画面埋め尽くし・最大火力)',
    ];

    levelSlider.addEventListener('input', () => {
      const val = parseInt(levelSlider.value, 10);
      levelVal.textContent = val.toString();
      levelDesc.textContent = levelDescs[val] || '';
      this.director.setEffectLevel(val);
    });

    // コンボシミュレータ
    comboSlider.addEventListener('input', () => {
      const val = parseInt(comboSlider.value, 10);
      comboVal.textContent = val.toLocaleString();
      this.director.setSimulatedCombo(val);
    });

    // プリセットコンボボタン
    this.container.querySelectorAll('[data-combo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseInt((btn as HTMLElement).dataset.combo || '1', 10);
        comboSlider.value = val.toString();
        comboVal.textContent = val.toLocaleString();
        this.director.setSimulatedCombo(val);
      });
    });

    // 成功デモ (isDemo = true で実スコア・実コンボの汚染防止)
    this.container.querySelector('#btn-demo-success')?.addEventListener('click', () => {
      const currentCombo = parseInt(comboSlider.value, 10);
      this.director.setSimulatedCombo(currentCombo);
      this.director.handleFinished(
        {
          type: 'command_finished',
          command: 'cp',
          executionId: 'demo-' + Date.now(),
          exitCode: 0,
          durationMs: 150,
          timestamp: Date.now(),
          sessionId: 'demo-session',
        },
        true // isDemo!
      );
      const next = currentCombo + 1;
      comboSlider.value = next.toString();
      comboVal.textContent = next.toLocaleString();
    });

    // 特異点デモ
    this.container.querySelector('#btn-demo-singularity')?.addEventListener('click', () => {
      comboSlider.value = '10000';
      comboVal.textContent = '10,000';
      this.director.setSimulatedCombo(10000);
      this.director.handleFinished(
        {
          type: 'command_finished',
          command: 'cp',
          executionId: 'demo-singularity',
          exitCode: 0,
          durationMs: 150,
          timestamp: Date.now(),
          sessionId: 'demo-session',
        },
        true // isDemo!
      );
    });

    // 失敗デモ
    this.container.querySelectorAll('.fail-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const failCat = (btn as HTMLElement).dataset.fail as FailureCategory;
        this.director.handleFinished(
          {
            type: 'command_finished',
            command: 'unknown',
            executionId: 'demo-fail',
            exitCode: failCat === 'typo' ? 127 : failCat === 'permission_denied' ? 126 : 1,
            failureCategory: failCat,
            durationMs: 80,
            timestamp: Date.now(),
            sessionId: 'demo-session',
          },
          true // isDemo!
        );
      });
    });

    // 大惨事デモ
    this.container.querySelectorAll('.disaster-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const disType = (btn as HTMLElement).dataset.disaster as DisasterType;
        this.director.triggerDisaster(disType);
      });
    });

    // ターミにゃんポーズ
    this.container.querySelectorAll('.mascot-pose').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pose = (btn as HTMLElement).dataset.pose as MascotState;
        this.mascot.setState(pose);
      });
    });

    // スコアリセット
    this.container.querySelector('#btn-reset-score')?.addEventListener('click', () => {
      if (confirm('累積スコアをリセットしますか？')) {
        this.scoreManager?.resetScore();
      }
    });
  }

  /** カスタム編集後にテーマセレクトを CUSTOM へ同期 */
  private syncThemeSelect() {
    if (!this.themeManager) return;
    const themeSelect = this.container.querySelector('#theme-select') as HTMLSelectElement;
    const themeDesc = this.container.querySelector('#theme-desc') as HTMLElement;
    const id = this.themeManager.getThemeId();
    if (themeSelect && themeSelect.value !== id) {
      themeSelect.value = id;
    }
    if (themeDesc) themeDesc.textContent = this.themeManager.getTheme().descriptionJa;
  }
}
