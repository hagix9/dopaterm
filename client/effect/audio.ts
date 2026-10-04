/**
 * Web Audio API 動的シンセサイザー (Dopaterm Audio Engine)
 * 外部音声ファイルゼロ・完全プログラマブル音響合成
 */

export class DopatermAudio {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private activeVoices = 0;
  private readonly MAX_VOICES = 8;

  constructor() {
    // Lazy initialize on first user gesture
    window.addEventListener('keydown', () => this.ensureContext(), { once: true });
    window.addEventListener('click', () => this.ensureContext(), { once: true });
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  private createVoice(): { ctx: AudioContext; gain: GainNode } | null {
    if (this.isMuted) return null;
    const ctx = this.ensureContext();
    if (!ctx) return null;
    if (this.activeVoices >= this.MAX_VOICES) return null;

    this.activeVoices++;
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    setTimeout(() => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    }, 2000);

    return { ctx, gain: masterGain };
  }

  // ---- 追加レイヤー（演出の重なり用。MAX_VOICES とは別枠の軽量ボイス） ----
  private fxActive = 0;
  private lastPopAt = 0;
  private lastChimeAt = 0;
  private chimeStep = 0;

  private lightVoice(): { ctx: AudioContext; gain: GainNode } | null {
    if (this.isMuted) return null;
    const ctx = this.ensureContext();
    if (!ctx || this.fxActive >= 10) return null;
    this.fxActive++;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    setTimeout(() => (this.fxActive = Math.max(0, this.fxActive - 1)), 700);
    return { ctx, gain };
  }

  private noiseBurst(ctx: AudioContext, dest: AudioNode, t: number, dur: number, f0: number, f1: number, vol: number, type: BiquadFilterType = 'bandpass') {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** 低域の衝撃（サブ + ノイズの破裂）。大演出の頭に重ねる */
  public playImpact(strength = 1) {
    const v = this.lightVoice();
    if (!v) return;
    const { ctx, gain } = v;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(g);
    g.connect(gain);
    o.start(t);
    o.stop(t + 0.36);
    this.noiseBurst(ctx, gain, t, 0.22, 2400, 300, 0.22 * strength);
  }

  /** 上昇するノイズ（ライザー）: 盛り上がりの予兆 */
  public playRiser(dur = 0.5) {
    const v = this.lightVoice();
    if (!v) return;
    const { ctx, gain } = v;
    this.noiseBurst(ctx, gain, ctx.currentTime, dur, 300, 5200, 0.16);
  }

  /** 花火の打ち上げ（短い上昇ホイッスル） */
  public playFireworkLaunch() {
    const v = this.lightVoice();
    if (!v) return;
    const { ctx, gain } = v;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1900, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g);
    g.connect(gain);
    o.start(t);
    o.stop(t + 0.34);
  }

  /** 花火の炸裂（破裂 + きらめく高音）。連発でも潰れないよう間引く */
  public playFireworkPop(power = 0.6) {
    const now = performance.now();
    if (now - this.lastPopAt < 90) return;
    this.lastPopAt = now;
    const v = this.lightVoice();
    if (!v) return;
    const { ctx, gain } = v;
    const t = ctx.currentTime;
    this.noiseBurst(ctx, gain, t, 0.18, 3800, 500, 0.2 * (0.6 + power));
    const base = [1318.5, 1567.98, 1760, 2093][Math.floor(Math.random() * 4)];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const tt = t + 0.03 + i * 0.045;
      o.frequency.setValueAtTime(base * (1 + i * 0.25), tt);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.07, tt);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.22);
      o.connect(g);
      g.connect(gain);
      o.start(tt);
      o.stop(tt + 0.24);
    }
  }

  /** きらめきの上昇アルペジオ（成功の余韻・派手な演出の仕上げ） */
  public playSparkle(level = 1) {
    const v = this.lightVoice();
    if (!v) return;
    const { ctx, gain } = v;
    const t = ctx.currentTime;
    const scale = [1046.5, 1318.5, 1567.98, 2093, 2637, 3136];
    const n = Math.min(scale.length, 3 + level);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const tt = t + i * 0.05;
      o.frequency.setValueAtTime(scale[i], tt);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08, tt);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.35);
      o.connect(g);
      g.connect(gain);
      o.start(tt);
      o.stop(tt + 0.38);
    }
  }

  /** キー入力・候補検出音 */
  public playBlip() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.03);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  /** コピー開始ピッチスイープ */
  public playTransferStart() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(960, now + 0.18);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  /** 1〜9回 NORMAL チャイム (C5, E5) */
  public playSuccessChime() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    // 4秒以内に連続すると半音ではなくペンタトニックで段階的に音程が上がる（最大5段）
    const nowMs = performance.now();
    this.chimeStep = nowMs - this.lastChimeAt < 4000 ? Math.min(5, this.chimeStep + 1) : 0;
    this.lastChimeAt = nowMs;
    const steps = [0, 2, 4, 7, 9, 12];
    const mul = Math.pow(2, steps[this.chimeStep] / 12);

    [523.25 * mul, 659.25 * mul].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const t = ctx.currentTime + idx * 0.09;
      osc.frequency.setValueAtTime(freq, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.connect(g);
      g.connect(gain);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  }

  /** 10〜99回 COMBO! アルペジオ (C5, E5, G5, C6) */
  public playComboArpeggio() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const t = ctx.currentTime + idx * 0.07;
      osc.frequency.setValueAtTime(freq, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(g);
      g.connect(gain);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  /** 100〜999回 FEVER!! ブラス風ファンファーレ */
  public playFeverFanfare() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const chords = [
      [523.25, 659.25, 783.99],
      [587.33, 739.99, 880.0],
      [659.25, 830.61, 987.77],
      [1046.5, 1318.5, 1567.98],
    ];

    chords.forEach((chord, cIdx) => {
      const t = ctx.currentTime + cIdx * 0.1;
      chord.forEach((freq) => {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const g = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2400, t);
        filter.frequency.exponentialRampToValueAtTime(800, t + 0.25);

        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

        osc.connect(filter);
        filter.connect(g);
        g.connect(gain);
        osc.start(t);
        osc.stop(t + 0.32);
      });
    });
    this.playImpact(0.7);
    this.playSparkle(2);
  }

  /** 1,000〜9,999回 HYPER DOPA 宇宙サイバーコード */
  public playHyperDopaChord() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const freqs = [130.81, 261.63, 392.0, 523.25, 659.25, 783.99, 1046.5];
    const now = ctx.currentTime;

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);

      g.gain.setValueAtTime(0.08, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

      osc.connect(g);
      g.connect(gain);
      osc.start(now);
      osc.stop(now + 0.85);
    });
    this.playImpact(0.95);
    this.playSparkle(3);
  }

  /** 10,000回+ DOPA SINGULARITY 特異点祝賀曲 */
  public playSingularityJingle() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const sequence = [
      { f: 523.25, d: 0.15 },
      { f: 659.25, d: 0.15 },
      { f: 783.99, d: 0.15 },
      { f: 1046.5, d: 0.3 },
      { f: 880.0, d: 0.15 },
      { f: 1046.5, d: 0.15 },
      { f: 1318.5, d: 0.6 },
    ];

    let t = ctx.currentTime;
    sequence.forEach((note) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.f, t);

      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + note.d * 1.5);

      osc.connect(g);
      g.connect(gain);
      osc.start(t);
      osc.stop(t + note.d * 1.6);
      t += note.d;
    });
    this.playRiser(0.45);
    setTimeout(() => this.playImpact(1.1), 420);
    this.playSparkle(4);
  }

  /** TYPO 激突音 */
  public playTypoCrash() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const now = ctx.currentTime;
    // Low rumble oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.25);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(g);
    g.connect(gain);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  /** 南京錠金属音 */
  public playPadlock() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /** DISASTER 爆発音 */
  public playExplosion() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.5);

    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.6);
    this.playImpact(0.9);
  }

  /** SLOT レバー引き音 */
  public playLeverPull() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const now = ctx.currentTime;
    // ガコン！という機械的クランク音（短い下降スクエア + ノイズ風オクターブ）
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(880, now + 0.05);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.12, now + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(g);
    g.connect(gain);
    osc2.connect(g2);
    g2.connect(gain);
    osc.start(now);
    osc.stop(now + 0.16);
    osc2.start(now + 0.05);
    osc2.stop(now + 0.14);
  }

  /** SLOT リール停止音（ドンッと軽い打撃） */
  public playReelStop() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  /** DISASTER GAME OVER 8bit音 */
  public playGameOver() {
    const v = this.createVoice();
    if (!v) return;
    const { ctx, gain } = v;

    const notes = [440, 415.3, 392, 369.99]; // A, Ab, G, F#
    let t = ctx.currentTime;
    notes.forEach((freq) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t);

      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.connect(g);
      g.connect(gain);
      osc.start(t);
      osc.stop(t + 0.2);
      t += 0.15;
    });
  }
}
