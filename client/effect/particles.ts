/**
 * Canvas 2D パーティクルシステム 強化版 (Dopaterm Particle Engine)
 * 紙吹雪、飛ぶファイル、金貨、星、花火、レーザー光線、光の波
 * 最大800個クランプ & 動的FPSスロットリング
 */

export type ParticleType =
  | 'flying_doc'
  | 'confetti'
  | 'coin'
  | 'star'
  | 'firework_spark'
  | 'laser_beam'
  | 'light_wave'
  | 'ember'
  | 'shell'
  | 'ring'
  | 'streamer';

export interface Particle {
  active: boolean;
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  vRot: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  targetX?: number;
  targetY?: number;
  progress?: number;
  wobble?: number;
  wobbleSpeed?: number;
  /** 打ち上げ花火: 炸裂時の火花数・発射遅延（フレーム） */
  burstCount?: number;
  delay?: number;
  /** ストリーマの軌跡 */
  trail?: { x: number; y: number }[];
}

export class ParticleEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pool: Particle[] = [];
  private readonly MAX_PARTICLES = 800;
  private activeCount = 0;
  private isRunning = false;
  private lastTime = 0;
  private currentFps = 60;
  private qualityScale = 1.0;
  /** 花火の打ち上げ・炸裂のタイミング通知（音との連動用。演出のみ） */
  public onLaunch?: () => void;
  public onBurst?: (power: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;

    // Initialize object pool
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.pool.push({
        active: false,
        type: 'confetti',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        rotation: 0,
        vRot: 0,
        size: 10,
        color: '#FFF',
        alpha: 1,
        life: 0,
        maxLife: 100,
      });
    }

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.start();
  }

  private resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  private obtain(): Particle | null {
    if (this.activeCount >= this.MAX_PARTICLES) return null;
    for (const p of this.pool) {
      if (!p.active) {
        p.active = true;
        this.activeCount++;
        return p;
      }
    }
    return null;
  }

  private release(p: Particle) {
    if (p.active) {
      p.active = false;
      this.activeCount--;
    }
  }

  public emitFlyingDocs(count = 6) {
    const adjustedCount = Math.floor(count * this.qualityScale);
    const startX = this.canvas.width * 0.15;
    const startY = this.canvas.height * 0.45;
    const endX = this.canvas.width * 0.85;
    const endY = this.canvas.height * 0.45;

    for (let i = 0; i < adjustedCount; i++) {
      const p = this.obtain();
      if (!p) break;

      p.type = 'flying_doc';
      p.x = startX;
      p.y = startY + (Math.random() - 0.5) * 50;
      p.targetX = endX;
      p.targetY = endY + (Math.random() - 0.5) * 50;
      p.progress = 0;
      p.vx = 0.018 + Math.random() * 0.012;
      p.rotation = 0;
      p.vRot = (Math.random() - 0.5) * 0.25;
      p.size = 28;
      p.color = '#FFF';
      p.alpha = 1;
      p.life = 0;
      p.maxLife = 120;
    }
  }

  public emitConfetti(count = 250, palette?: string[]) {
    if (count >= 120) this.emitStreamers(Math.min(8, Math.round(count / 70)), palette);
    const adjustedCount = Math.min(Math.floor(count * this.qualityScale), this.MAX_PARTICLES - this.activeCount);
    const colors = palette && palette.length > 0
      ? palette
      : ['#FF1B8D', '#00F5D4', '#FFE600', '#7928CA', '#FF6B00', '#FFFFFF', '#00F0FF', '#39FF14'];

    for (let i = 0; i < adjustedCount; i++) {
      const p = this.obtain();
      if (!p) break;

      p.type = 'confetti';
      p.x = Math.random() * this.canvas.width;
      p.y = this.canvas.height * 0.25 + (Math.random() - 0.5) * 100;
      p.vx = (Math.random() - 0.5) * 20;
      p.vy = -Math.random() * 16 - 6;
      p.rotation = Math.random() * Math.PI * 2;
      p.vRot = (Math.random() - 0.5) * 0.25;
      p.wobble = Math.random() * Math.PI * 2;
      p.wobbleSpeed = 0.06 + Math.random() * 0.12;
      p.size = 8 + Math.random() * 10;
      p.color = colors[Math.floor(Math.random() * colors.length)];
      p.alpha = 1;
      p.life = 0;
      p.maxLife = 90 + Math.random() * 45;
    }
  }

  public emitCoins(count = 40) {
    const adjustedCount = Math.floor(count * this.qualityScale);
    for (let i = 0; i < adjustedCount; i++) {
      const p = this.obtain();
      if (!p) break;

      p.type = 'coin';
      p.x = this.canvas.width * 0.5 + (Math.random() - 0.5) * 300;
      p.y = this.canvas.height * 0.45;
      p.vx = (Math.random() - 0.5) * 16;
      p.vy = -Math.random() * 14 - 7;
      p.rotation = Math.random() * Math.PI * 2;
      p.vRot = 0.12 + Math.random() * 0.25;
      p.size = 20;
      p.color = '#FFE600';
      p.alpha = 1;
      p.life = 0;
      p.maxLife = 75;
    }
  }

  /**
   * 段階式の花火: 画面下から打ち上げ → 目標点で炸裂 → 衝撃リング + 尾を引く火花。
   * count は火花の総数（従来互換）。複数発を少しずつ遅らせて重ねる。
   */
  public emitFireworks(count = 100, palette?: string[]) {
    const adjustedCount = Math.floor(count * this.qualityScale);
    if (adjustedCount < 1) return;
    const colors = palette && palette.length > 0
      ? palette
      : ['#FF007F', '#00F0FF', '#FFE600', '#00FFA3', '#FF6B00', '#E040FB'];
    const shells = Math.max(1, Math.min(4, Math.round(adjustedCount / 45)));
    const perShell = Math.max(10, Math.round(adjustedCount / shells));

    for (let i = 0; i < shells; i++) {
      const p = this.obtain();
      if (!p) break;
      p.type = 'shell';
      p.targetX = this.canvas.width * (0.12 + Math.random() * 0.76);
      p.targetY = this.canvas.height * (0.12 + Math.random() * 0.34);
      p.x = p.targetX + (Math.random() - 0.5) * 60;
      p.y = this.canvas.height + 10;
      p.vy = p.y; // 打ち上げ開始高度を保持
      p.vx = 0;
      p.rotation = 0;
      p.vRot = 0;
      p.size = 3;
      p.color = colors[Math.floor(Math.random() * colors.length)];
      p.alpha = 1;
      p.burstCount = perShell;
      p.delay = i * (7 + Math.floor(Math.random() * 6));
      p.life = 0;
      p.maxLife = p.delay + 80;
      p.trail = [];
    }
    this.onLaunch?.();
  }

  /** 紙テープ（ストリーマ）: 左右の縁から弧を描いて飛び、尾を引いて舞い落ちる */
  public emitStreamers(count = 6, palette?: string[]) {
    const colors = palette && palette.length > 0
      ? palette
      : ['#FF1B8D', '#00F5D4', '#FFE600', '#7928CA', '#FF6B00', '#FFFFFF'];
    const n = Math.floor(count * this.qualityScale);
    for (let i = 0; i < n; i++) {
      const p = this.obtain();
      if (!p) break;
      const left = i % 2 === 0;
      const speed = 13 + Math.random() * 7;
      const angle = -(0.45 + Math.random() * 0.65);
      p.type = 'streamer';
      p.x = left ? -6 : this.canvas.width + 6;
      p.y = this.canvas.height * (0.08 + Math.random() * 0.4);
      p.vx = (left ? 1 : -1) * Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.rotation = 0;
      p.vRot = 0;
      p.size = 5 + Math.random() * 4;
      p.color = colors[Math.floor(Math.random() * colors.length)];
      p.alpha = 1;
      p.wobble = Math.random() * Math.PI * 2;
      p.life = 0;
      p.maxLife = 110 + Math.random() * 50;
      p.trail = [];
    }
  }

  private emitRing(x: number, y: number, color: string, reach = 150) {
    const p = this.obtain();
    if (!p) return;
    p.type = 'ring';
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.rotation = 0;
    p.vRot = 0;
    p.size = 8;
    p.targetX = reach;
    p.color = color;
    p.alpha = 1;
    p.life = 0;
    p.maxLife = 28;
  }

  private burstShell(shell: Particle) {
    const x = shell.x;
    const y = shell.targetY ?? shell.y;
    const n = shell.burstCount ?? 40;
    const color = shell.color;
    this.emitRing(x, y, color, 120 + Math.random() * 60);
    for (let i = 0; i < n; i++) {
      const sp = this.obtain();
      if (!sp) break;
      const layer = i % 3;
      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
      const speed = (layer === 0 ? 9.5 : layer === 1 ? 6.5 : 3.8) * (0.9 + Math.random() * 0.2);
      sp.type = 'firework_spark';
      sp.x = x;
      sp.y = y;
      sp.vx = Math.cos(angle) * speed;
      sp.vy = Math.sin(angle) * speed;
      sp.rotation = 0;
      sp.vRot = 0;
      sp.size = layer === 0 ? 2.6 : 3.4;
      sp.color = i % 4 === 0 ? '#FFFFFF' : color;
      sp.alpha = 1;
      sp.life = 0;
      sp.maxLife = 52 + Math.random() * 28;
    }
    this.onBurst?.(Math.min(1, n / 80));
  }

  public emitLaserBeams(count = 8, palette?: string[]) {
    const colors = palette && palette.length > 0
      ? palette
      : ['#FF1B8D', '#00F5D4', '#FFE600', '#00F0FF'];
    for (let i = 0; i < count; i++) {
      const p = this.obtain();
      if (!p) break;

      p.type = 'laser_beam';
      p.x = i % 2 === 0 ? 0 : this.canvas.width;
      p.y = Math.random() * this.canvas.height;
      p.vx = (i % 2 === 0 ? 1 : -1) * (20 + Math.random() * 15);
      p.vy = (Math.random() - 0.5) * 6;
      p.size = 6 + Math.random() * 6;
      p.color = colors[i % colors.length];
      p.alpha = 0.9;
      p.life = 0;
      p.maxLife = 40;
    }
  }

  /**
   * 余韻パーティクル「残光エンバー」。
   * 画面下部付近からゆっくり上昇して滲むように消える長寿命ドット。
   * メイン演出が終わった後も盛り上がりが続く感覚を作る。
   */
  public emitEmbers(count = 12, palette?: string[]) {
    const colors = palette && palette.length > 0
      ? palette
      : ['#FF9F68', '#FFE600', '#FF1B8D', '#00F5D4'];

    for (let i = 0; i < count; i++) {
      const p = this.obtain();
      if (!p) break;

      p.type = 'ember';
      p.x = Math.random() * this.canvas.width;
      p.y = this.canvas.height * (0.55 + Math.random() * 0.4);
      p.vx = (Math.random() - 0.5) * 0.7;
      p.vy = -(0.35 + Math.random() * 0.9); // ゆっくり上昇
      p.rotation = 0;
      p.vRot = 0;
      p.wobble = Math.random() * Math.PI * 2;
      p.wobbleSpeed = 0.01 + Math.random() * 0.03;
      p.size = 1.8 + Math.random() * 3.2;
      p.color = colors[Math.floor(Math.random() * colors.length)];
      p.alpha = 0.5 + Math.random() * 0.5;
      p.life = 0;
      p.maxLife = 180 + Math.random() * 220; // 3〜6.5秒程度の長寿命
    }
  }

  public clear() {
    for (const p of this.pool) {
      p.active = false;
    }
    this.activeCount = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private start() {
    this.isRunning = true;
    this.lastTime = performance.now();

    const loop = (timestamp: number) => {
      if (!this.isRunning) return;
      const delta = timestamp - this.lastTime;
      this.lastTime = timestamp;

      // FPS monitoring
      if (delta > 0) {
        const instantFps = 1000 / delta;
        this.currentFps = this.currentFps * 0.9 + instantFps * 0.1;
        if (this.currentFps < 45) {
          this.qualityScale = Math.max(0.4, this.qualityScale - 0.05);
        } else if (this.currentFps > 55 && this.qualityScale < 1.0) {
          this.qualityScale = Math.min(1.0, this.qualityScale + 0.02);
        }
      }

      this.updateAndDraw();
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  private updateAndDraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const p of this.pool) {
      if (!p.active) continue;

      p.life++;
      if (p.life >= p.maxLife) {
        this.release(p);
        continue;
      }

      const progressRatio = p.life / p.maxLife;

      if (p.type === 'flying_doc') {
        p.progress = (p.progress || 0) + (p.vx || 0.02);
        if (p.progress >= 1) {
          this.release(p);
          continue;
        }

        const startX = this.canvas.width * 0.15;
        const endX = p.targetX || this.canvas.width * 0.85;
        const startY = this.canvas.height * 0.45;
        const endY = p.targetY || this.canvas.height * 0.45;

        p.x = startX + (endX - startX) * p.progress;
        const arcHeight = 140 * Math.sin(p.progress * Math.PI);
        p.y = startY + (endY - startY) * p.progress - arcHeight;
        p.rotation += p.vRot;

        this.drawFlyingDoc(p);
      } else if (p.type === 'confetti') {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.38; // gravity
        p.vx *= 0.98;
        p.rotation += p.vRot;
        if (p.wobble !== undefined && p.wobbleSpeed !== undefined) {
          p.wobble += p.wobbleSpeed;
        }
        p.alpha = Math.max(0, 1 - progressRatio * 0.8);

        this.drawConfetti(p);
      } else if (p.type === 'coin') {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.42;
        p.rotation += p.vRot;
        p.alpha = Math.max(0, 1 - progressRatio);

        this.drawCoin(p);
      } else if (p.type === 'firework_spark') {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.alpha = Math.max(0, 1 - progressRatio);

        this.drawSpark(p);
      } else if (p.type === 'laser_beam') {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha = Math.max(0, 1 - progressRatio);

        this.drawLaser(p);
      } else if (p.type === 'shell') {
        const delay = p.delay ?? 0;
        if (p.life <= delay) continue;
        const t = Math.min(1, (p.life - delay) / 34);
        const ease = 1 - Math.pow(1 - t, 3);
        const startY = p.vy;
        const ty = p.targetY ?? startY;
        p.y = startY + (ty - startY) * ease;
        p.x += Math.sin(p.life * 0.5) * 0.4;
        if (p.trail) {
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 12) p.trail.shift();
        }
        this.drawShell(p);
        if (t >= 1) {
          this.burstShell(p);
          this.release(p);
        }
      } else if (p.type === 'ring') {
        const ease = 1 - Math.pow(1 - progressRatio, 3);
        this.drawRing(p, ease, progressRatio);
      } else if (p.type === 'streamer') {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.26;
        p.vx *= 0.986;
        p.wobble = (p.wobble || 0) + 0.28;
        p.alpha = Math.max(0, 1 - Math.pow(progressRatio, 2.2));
        if (p.trail) {
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 20) p.trail.shift();
        }
        this.drawStreamer(p);
      } else if (p.type === 'ember') {
        // ゆらぎ上昇＋呼吸点滅（ストロボではなく緩やかな明滅）
        if (p.wobble !== undefined && p.wobbleSpeed !== undefined) {
          p.wobble += p.wobbleSpeed;
        }
        p.x += p.vx + Math.sin(p.wobble || 0) * 0.35;
        p.y += p.vy;
        const breathe = 0.75 + Math.sin((p.wobble || 0) * 2.2) * 0.25;
        p.alpha = Math.max(0, (1 - progressRatio) * breathe);

        this.drawEmber(p);
      }
    }
  }

  private drawFlyingDoc(p: Particle) {
    this.ctx.save();
    this.ctx.translate(p.x, p.y);
    this.ctx.rotate(p.rotation);
    this.ctx.globalAlpha = p.alpha;

    // Glowing shadow
    this.ctx.shadowColor = '#00F5D4';
    this.ctx.shadowBlur = 12;

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.strokeStyle = '#FF1B8D';
    this.ctx.lineWidth = 2.5;
    this.ctx.beginPath();
    this.ctx.roundRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.35, 5);
    this.ctx.fill();
    this.ctx.stroke();

    // Document lines
    this.ctx.fillStyle = '#00F5D4';
    this.ctx.fillRect(-p.size / 3, -p.size / 4, p.size * 0.65, 2.5);
    this.ctx.fillRect(-p.size / 3, 2, p.size * 0.65, 2.5);
    this.ctx.fillRect(-p.size / 3, 8, p.size * 0.45, 2.5);

    this.ctx.restore();
  }

  private drawConfetti(p: Particle) {
    this.ctx.save();
    this.ctx.translate(p.x, p.y);
    this.ctx.rotate(p.rotation);
    this.ctx.globalAlpha = p.alpha;
    this.ctx.fillStyle = p.color;

    const scaleX = Math.cos(p.wobble || 0);
    this.ctx.scale(scaleX, 1);
    this.ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);

    this.ctx.restore();
  }

  private drawCoin(p: Particle) {
    this.ctx.save();
    this.ctx.translate(p.x, p.y);
    this.ctx.rotate(p.rotation);
    this.ctx.globalAlpha = p.alpha;

    this.ctx.shadowColor = '#FFE600';
    this.ctx.shadowBlur = 10;
    this.ctx.fillStyle = '#FFE600';
    this.ctx.strokeStyle = '#FF6B00';
    this.ctx.lineWidth = 2.5;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.fillStyle = '#FF6B00';
    this.ctx.font = `bold ${p.size * 0.65}px monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('★', 0, 1);

    this.ctx.restore();
  }

  private drawShell(p: Particle) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const tr = p.trail || [];
    if (tr.length > 1) {
      ctx.beginPath();
      ctx.moveTo(tr[0].x, tr[0].y);
      for (const q of tr) ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawRing(p: Particle, ease: number, prog: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - prog) * 0.9;
    ctx.strokeStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 1 + 5 * (1 - prog);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size + (p.targetX ?? 140) * ease, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawStreamer(p: Particle) {
    const tr = p.trail || [];
    if (tr.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.strokeStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const k = i / tr.length;
      ctx.lineWidth = p.size * k;
      const w = Math.sin((p.wobble || 0) + i * 0.7) * 3 * k;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x + w, tr[i - 1].y);
      ctx.lineTo(tr[i].x + w, tr[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSpark(p: Particle) {
    const ctx0 = this.ctx;
    // 尾（直前の移動方向に短い光跡）
    ctx0.save();
    ctx0.globalAlpha = p.alpha * 0.55;
    ctx0.strokeStyle = p.color;
    ctx0.lineWidth = Math.max(1, p.size * 0.6);
    ctx0.lineCap = 'round';
    ctx0.beginPath();
    ctx0.moveTo(p.x, p.y);
    ctx0.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4);
    ctx0.stroke();
    ctx0.restore();

    this.ctx.save();
    this.ctx.translate(p.x, p.y);
    this.ctx.globalAlpha = p.alpha;
    this.ctx.fillStyle = p.color;
    this.ctx.shadowColor = p.color;
    this.ctx.shadowBlur = 8;

    this.ctx.beginPath();
    this.ctx.arc(0, 0, p.size, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  private drawLaser(p: Particle) {
    this.ctx.save();
    this.ctx.globalAlpha = p.alpha;
    this.ctx.strokeStyle = p.color;
    this.ctx.shadowColor = p.color;
    this.ctx.shadowBlur = 14;
    this.ctx.lineWidth = p.size;
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
    this.ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawEmber(p: Particle) {
    this.ctx.save();
    this.ctx.translate(p.x, p.y);
    this.ctx.globalAlpha = p.alpha;
    this.ctx.fillStyle = p.color;
    this.ctx.shadowColor = p.color;
    this.ctx.shadowBlur = 9;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, p.size, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }
}
