/**
 * ターミナルカラーテーママネージャー (Dopaterm Theme Engine)
 * TOXIC NEON 等のプリセット4種 + 全項目カスタマイズ可能な CUSTOM テーマ
 * コンボ・演出レベル連動の動的ネオン枠発光
 */

import { ITheme } from '@xterm/xterm';
import { ComboRank } from '../types/events.js';

export type ThemeId = 'toxic_neon' | 'radioactive' | 'cyber_candy' | 'dopa_galaxy' | 'custom';
export type CursorStyle = 'block' | 'underline' | 'bar';

/** ANSI 基本16色のキー順（xterm ITheme フィールド名） */
export const ANSI16_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;
export type Ansi16Key = (typeof ANSI16_KEYS)[number];

export interface DopatermThemeDef {
  id: ThemeId;
  nameJa: string;
  descriptionJa: string;
  xtermTheme: ITheme;
  borderGlowColor: string;
  /** zsh zle_highlight 用の入力文字色（ANSI 色名 or 0-255）。未指定なら変更しない */
  inputColor?: string;
  /** プロンプト色（ANSI 256 番号文字列）。PS1 先頭に色コードを注入する */
  promptColor?: string;
  cursorStyle?: CursorStyle;
}

/** ユーザーが個別に変更できるカスタム項目（localStorage 永続化） */
export interface CustomThemeData {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  borderGlowColor: string;
  /** 入力文字色（hex 表示用）。ANSI 変換は getInputColorAnsi で行う */
  inputColorHex: string;
  /** プロンプト色（hex 表示用）。PS1 先頭へ ANSI256 色として注入 */
  promptColorHex: string;
  cursorStyle: CursorStyle;
  ansi16: Record<Ansi16Key, string>;
}

export const DOPATERM_THEMES: Record<Exclude<ThemeId, 'custom'>, DopatermThemeDef> = {
  toxic_neon: {
    id: 'toxic_neon',
    nameJa: 'TOXIC NEON (標準)',
    descriptionJa: '紫がかった黒に蛍光ピンク、エメラルドグリーン、蛍光イエローが炸裂する標準毒々テーマ',
    borderGlowColor: '#00F5D4',
    inputColor: '226', // 蛍光イエローで入力文字
    promptColor: '51', // シアンのプロンプト
    xtermTheme: {
      background: '#170A2E', // 深紫（可読性を保つ濃色だが黒と区別できる色調）
      foreground: '#EDEAF6',
      cursor: '#00F5D4',
      cursorAccent: '#170A2E',
      selectionBackground: 'rgba(255, 27, 141, 0.4)',
      black: '#201541',
      red: '#FF4757',
      green: '#00F5D4',
      yellow: '#FFE600',
      blue: '#3742FA',
      magenta: '#FF1B8D',
      cyan: '#00F0FF',
      white: '#EDEAF6',
      brightBlack: '#57606F',
      brightRed: '#FF6B81',
      brightGreen: '#2ED573',
      brightYellow: '#FFA502',
      brightBlue: '#70A1FF',
      brightMagenta: '#FF78C4',
      brightCyan: '#7BED9F',
      brightWhite: '#FFFFFF',
    },
  },
  radioactive: {
    id: 'radioactive',
    nameJa: 'RADIOACTIVE (放射能)',
    descriptionJa: '深淵の黒と猛毒の蛍光グリーンを中心としたハッカー・サイバーテーマ',
    borderGlowColor: '#39FF14',
    inputColor: '190', // 黄緑で入力文字
    promptColor: '82', // 明るい緑のプロンプト
    xtermTheme: {
      background: '#072007', // 深緑
      foreground: '#E8F5E9',
      cursor: '#39FF14',
      cursorAccent: '#072007',
      selectionBackground: 'rgba(57, 255, 20, 0.35)',
      black: '#0F2D0D',
      red: '#FF3333',
      green: '#39FF14',
      yellow: '#CCFF00',
      blue: '#00E5FF',
      magenta: '#00FF66',
      cyan: '#76FF03',
      white: '#E8F5E9',
      brightBlack: '#2E7D32',
      brightRed: '#FF5252',
      brightGreen: '#69F0AE',
      brightYellow: '#EEFF41',
      brightBlue: '#40C4FF',
      brightMagenta: '#00E676',
      brightCyan: '#B2FF59',
      brightWhite: '#FFFFFF',
    },
  },
  cyber_candy: {
    id: 'cyber_candy',
    nameJa: 'CYBER CANDY (電脳キャンディ)',
    descriptionJa: '蛍光ピンク、ビビッドオレンジ、弾けるイエローの過剰ポップテーマ',
    borderGlowColor: '#FF1B8D',
    inputColor: '220', // ゴールドで入力文字
    promptColor: '207', // ピンクのプロンプト
    xtermTheme: {
      background: '#2A0718', // 深マゼンタ
      foreground: '#FFF0F5',
      cursor: '#FF1B8D',
      cursorAccent: '#2A0718',
      selectionBackground: 'rgba(255, 107, 0, 0.4)',
      black: '#3B0F26',
      red: '#FF1744',
      green: '#00E676',
      yellow: '#FFD600',
      blue: '#FF4081',
      magenta: '#FF1B8D',
      cyan: '#FF6B00',
      white: '#FFF0F5',
      brightBlack: '#6A1B9A',
      brightRed: '#FF5252',
      brightGreen: '#69F0AE',
      brightYellow: '#FFFF00',
      brightBlue: '#FF80AB',
      brightMagenta: '#FF4081',
      brightCyan: '#FF9100',
      brightWhite: '#FFFFFF',
    },
  },
  dopa_galaxy: {
    id: 'dopa_galaxy',
    nameJa: 'DOPA GALAXY (銀河宇宙)',
    descriptionJa: '深宇宙のパープル、シアン、エレクトリックマゼンタが漂う神秘テーマ',
    borderGlowColor: '#E040FB',
    inputColor: '51', // シアンで入力文字
    promptColor: '171', // マゼンタのプロンプト
    xtermTheme: {
      background: '#080F33', // 深藍
      foreground: '#F3E5F5',
      cursor: '#00E5FF',
      cursorAccent: '#080F33',
      selectionBackground: 'rgba(224, 64, 251, 0.35)',
      black: '#121B4A',
      red: '#FF5252',
      green: '#00E5FF',
      yellow: '#FFD700',
      blue: '#7C4DFF',
      magenta: '#E040FB',
      cyan: '#18FFFF',
      white: '#F3E5F5',
      brightBlack: '#4A148C',
      brightRed: '#FF1744',
      brightGreen: '#64FFDA',
      brightYellow: '#FFEE58',
      brightBlue: '#B388FF',
      brightMagenta: '#EA80FC',
      brightCyan: '#84FFFF',
      brightWhite: '#FFFFFF',
    },
  },
};

const CUSTOM_STORAGE_KEY = 'dopaterm_custom_theme_v1';
const THEME_ID_KEY = 'dopaterm_theme_id';

/** プリセットからカスタム編集の初期値を作る */
function defaultsFromPreset(preset: DopatermThemeDef): CustomThemeData {
  const t = preset.xtermTheme;
  const ansi16 = {} as Record<Ansi16Key, string>;
  ANSI16_KEYS.forEach((k) => {
    ansi16[k] = (t[k] as string) || '#FFFFFF';
  });
  return {
    background: (t.background as string) || '#0D0B14',
    foreground: (t.foreground as string) || '#EDEAF6',
    cursor: (t.cursor as string) || '#00F5D4',
    cursorAccent: (t.cursorAccent as string) || '#0D0B14',
    selectionBackground: rgbaToHex((t.selectionBackground as string) || '#FF1B8D'),
    borderGlowColor: preset.borderGlowColor,
    inputColorHex: '#FFE600',
    promptColorHex: '#00F5D4',
    cursorStyle: 'block',
    ansi16,
  };
}

/** rgba() 指定の選択色を <input type="color"> 用の hex へ丸める（αは破棄） */
function rgbaToHex(c: string): string {
  if (c.startsWith('#')) return c;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#FF1B8D';
  const to2 = (n: string) => parseInt(n, 10).toString(16).padStart(2, '0');
  return `#${to2(m[1])}${to2(m[2])}${to2(m[3])}`;
}

/** hex(#RRGGBB) → 最も近い ANSI 256 色番号 */
export function hexToAnsi256(hex: string): number {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  if (r === g && g === b) {
    // グレースケール領域 (232-255)
    if (r < 8) return 16;
    if (r > 238) return 231;
    return Math.round((r - 8) / 10) + 232;
  }
  const to6 = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * to6(r) + 6 * to6(g) + to6(b);
}

export class ThemeManager {
  private currentThemeId: ThemeId = 'toxic_neon';
  private terminalEl: HTMLElement;
  private onThemeChangeCallbacks: ((theme: DopatermThemeDef) => void)[] = [];
  private currentRank: ComboRank = 'normal';
  private effectLevel = 3;
  private custom: CustomThemeData;

  constructor(terminalEl: HTMLElement) {
    this.terminalEl = terminalEl;
    this.custom = this.loadCustom();
    const saved = localStorage.getItem(THEME_ID_KEY) as ThemeId;
    if (saved === 'custom' || (saved && DOPATERM_THEMES[saved as keyof typeof DOPATERM_THEMES])) {
      this.currentThemeId = saved;
    }
    this.applyThemeStyle();
  }

  private loadCustom(): CustomThemeData {
    const base = defaultsFromPreset(DOPATERM_THEMES.toxic_neon);
    try {
      const saved = localStorage.getItem(CUSTOM_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<CustomThemeData>;
        return {
          ...base,
          ...parsed,
          ansi16: { ...base.ansi16, ...(parsed.ansi16 || {}) },
        };
      }
    } catch {}
    return base;
  }

  private saveCustom() {
    try {
      localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(this.custom));
    } catch {}
  }

  public getTheme(): DopatermThemeDef {
    if (this.currentThemeId === 'custom') {
      return this.buildCustomDef();
    }
    return DOPATERM_THEMES[this.currentThemeId];
  }

  public getThemeId(): ThemeId {
    return this.currentThemeId;
  }

  public getCustomData(): CustomThemeData {
    return JSON.parse(JSON.stringify(this.custom));
  }

  /** カスタムテーマ定義を生成する */
  private buildCustomDef(): DopatermThemeDef {
    const c = this.custom;
    const xtermTheme: ITheme = {
      background: c.background,
      foreground: c.foreground,
      cursor: c.cursor,
      cursorAccent: c.cursorAccent,
      selectionBackground: c.selectionBackground,
    };
    ANSI16_KEYS.forEach((k) => {
      (xtermTheme as any)[k] = c.ansi16[k];
    });
    return {
      id: 'custom',
      nameJa: 'CUSTOM (自由色)',
      descriptionJa: '背景・文字・カーソル・ANSI16色を自由に設定したカスタムテーマ',
      xtermTheme,
      borderGlowColor: c.borderGlowColor,
      inputColor: String(hexToAnsi256(c.inputColorHex)),
      promptColor: String(hexToAnsi256(c.promptColorHex)),
      cursorStyle: c.cursorStyle,
    };
  }

  public setTheme(themeId: ThemeId) {
    if (themeId !== 'custom' && !DOPATERM_THEMES[themeId as keyof typeof DOPATERM_THEMES]) return;
    this.currentThemeId = themeId;
    localStorage.setItem(THEME_ID_KEY, themeId);
    this.applyThemeStyle();
    this.fireChange();
  }

  /** プリセットの配色をカスタム編集の土台として読み込む */
  public loadPresetIntoCustom(themeId: Exclude<ThemeId, 'custom'>) {
    this.custom = defaultsFromPreset(DOPATERM_THEMES[themeId]);
    this.saveCustom();
  }

  /**
   * カスタム項目の更新。呼び出すと自動的に custom テーマへ切り替わり、
   * 即時反映・永続化される。
   */
  public setCustomField<K extends keyof CustomThemeData>(field: K, value: CustomThemeData[K]) {
    this.custom[field] = value;
    this.currentThemeId = 'custom';
    localStorage.setItem(THEME_ID_KEY, 'custom');
    this.saveCustom();
    this.applyThemeStyle();
    this.fireChange();
  }

  public setCustomAnsi(key: Ansi16Key, value: string) {
    this.custom.ansi16[key] = value;
    this.currentThemeId = 'custom';
    localStorage.setItem(THEME_ID_KEY, 'custom');
    this.saveCustom();
    this.applyThemeStyle();
    this.fireChange();
  }

  /** シェル起動パラメータに渡す入力文字色（ANSI番号文字列） */
  public getInputColorAnsi(): string | undefined {
    if (this.currentThemeId === 'custom') {
      return String(hexToAnsi256(this.custom.inputColorHex));
    }
    const theme = this.getTheme();
    return theme.inputColor;
  }

  /** シェル起動パラメータに渡すプロンプト色（ANSI番号文字列） */
  public getPromptColorAnsi(): string | undefined {
    if (this.currentThemeId === 'custom') {
      return String(hexToAnsi256(this.custom.promptColorHex));
    }
    const theme = this.getTheme();
    return theme.promptColor;
  }

  public onThemeChange(cb: (theme: DopatermThemeDef) => void) {
    this.onThemeChangeCallbacks.push(cb);
  }

  private fireChange() {
    const theme = this.getTheme();
    this.onThemeChangeCallbacks.forEach((cb) => cb(theme));
  }

  public setEffectState(rank: ComboRank, level: number) {
    this.currentRank = rank;
    this.effectLevel = level;
    this.applyDynamicBorderGlow();
  }

  private applyThemeStyle() {
    const theme = this.getTheme();
    document.documentElement.style.setProperty('--dopa-active-glow', theme.borderGlowColor);
    this.terminalEl.style.backgroundColor = theme.xtermTheme.background as string;
    this.applyDynamicBorderGlow();
  }

  private applyDynamicBorderGlow() {
    // 演出OFFの場合は外枠グローを停止
    if (this.effectLevel === 0) {
      this.terminalEl.classList.remove('glow-normal', 'glow-combo', 'glow-fever', 'glow-hyper', 'glow-singularity');
      this.terminalEl.style.boxShadow = 'none';
      return;
    }

    this.terminalEl.classList.remove('glow-normal', 'glow-combo', 'glow-fever', 'glow-hyper', 'glow-singularity');
    this.terminalEl.style.setProperty('--dopa-active-glow', this.getTheme().borderGlowColor);

    if (this.currentRank === 'singularity') {
      this.terminalEl.classList.add('glow-singularity');
    } else if (this.currentRank === 'hyper_dopa') {
      this.terminalEl.classList.add('glow-hyper');
    } else if (this.currentRank === 'fever') {
      this.terminalEl.classList.add('glow-fever');
    } else if (this.currentRank === 'combo') {
      this.terminalEl.classList.add('glow-combo');
    } else {
      this.terminalEl.classList.add('glow-normal');
    }
  }
}
