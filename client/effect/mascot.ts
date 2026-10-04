/**
 * オリジナルマスコット「ターミにゃん (Termi-Nyan)」強化版
 * インラインSVG + Spring物理エンジン (stiffness, damping)
 * アイドル浮遊、実行中トス、成功ダンス、失敗転倒、巨大化メガ演出
 */

export type MascotState =
  | 'idle'
  | 'candidate'
  | 'transfer'
  | 'success'
  | 'failure'
  | 'singularity'
  | 'huge_raid'
  | 'eat';

export class MascotEngine {
  private container: HTMLElement;
  private svgEl!: SVGSVGElement;
  private eyesText!: SVGTextElement;
  private leftEar!: SVGPolygonElement;
  private rightEar!: SVGPolygonElement;
  private leftHand!: SVGCircleElement;
  private rightHand!: SVGCircleElement;
  private crownEl!: SVGElement;
  private antennaGlow!: SVGCircleElement;
  private wrapperEl!: HTMLElement;

  // Spring physics
  private y = 0;
  private targetY = 0;
  private vy = 0;

  private x = 0;
  private targetX = 0;
  private vx = 0;

  private scale = 1;
  private targetScale = 1;
  private vScale = 0;

  private rotation = 0;
  private targetRotation = 0;
  private vRot = 0;

  private stiffness = 220;
  private damping = 15;
  private state: MascotState = 'idle';
  private animTimer = 0;
  /** 興奮状態（熱量が高い間はアイドルでも激しく揺れる） */
  private excited = false;

  public setExcited(on: boolean) {
    this.excited = on;
    this.wrapperEl?.classList.toggle('termi-excited', on);
  }

  /** 一度きりの飾り要素（衝撃リング・汗など）。CSS アニメーションで消える */
  private puff(cls: string, ms: number, count = 1) {
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = cls;
      el.style.setProperty('--i', String(i));
      this.wrapperEl.appendChild(el);
      setTimeout(() => el.remove(), ms + i * 120);
    }
  }

  constructor(container: HTMLElement) {
    this.container = container;
    this.createMascotSvg();
    this.startPhysicsLoop();
  }

  private createMascotSvg() {
    this.container.innerHTML = `
      <div id="termi-wrapper" class="termi-wrapper">
        <svg id="termi-nyan-svg" viewBox="0 0 140 140" width="130" height="130" style="overflow: visible; filter: drop-shadow(0 8px 20px rgba(0, 245, 212, 0.45));">
          <defs>
            <linearGradient id="visorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#00F0FF" />
              <stop offset="50%" stop-color="#FFE600" />
              <stop offset="100%" stop-color="#FF1B8D" />
            </linearGradient>
            <radialGradient id="helmetGrad" cx="35%" cy="35%" r="65%">
              <stop offset="0%" stop-color="#FFFFFF" />
              <stop offset="70%" stop-color="#E2DCF7" />
              <stop offset="100%" stop-color="#9FA8DA" />
            </radialGradient>
          </defs>

          <!-- Golden Crown (for high combos) -->
          <g id="termi-crown" style="display: none;">
            <polygon points="55,18 63,5 70,14 77,5 85,18" fill="#FFE600" stroke="#FF6B00" stroke-width="2" />
            <circle cx="63" cy="5" r="2.5" fill="#FF1B8D" />
            <circle cx="77" cy="5" r="2.5" fill="#00F5D4" />
          </g>

          <!-- Ears -->
          <polygon id="termi-left-ear" points="38,40 22,12 55,26" fill="#FF1B8D" stroke="#171524" stroke-width="2" />
          <polygon id="termi-right-ear" points="102,40 118,12 85,26" fill="#00F5D4" stroke="#171524" stroke-width="2" />

          <!-- Tail in Back -->
          <path d="M 70 100 Q 95 125 105 110" fill="none" stroke="#00F5D4" stroke-width="4" stroke-linecap="round" />

          <!-- Helmet Body -->
          <ellipse cx="70" cy="68" rx="46" ry="42" fill="url(#helmetGrad)" stroke="#171524" stroke-width="3" />

          <!-- Visor Face -->
          <rect x="34" y="46" width="72" height="42" rx="21" fill="#13111C" stroke="url(#visorGrad)" stroke-width="3" />

          <!-- LED Eyes -->
          <text id="termi-eyes" x="70" y="73" fill="#00F5D4" font-family="'JetBrains Mono', monospace" font-size="22" font-weight="900" text-anchor="middle">^ ^</text>

          <!-- Floating Pod Hands -->
          <circle id="termi-left-hand" cx="24" cy="84" r="10" fill="#FFFFFF" stroke="#00F5D4" stroke-width="2.5" />
          <circle id="termi-right-hand" cx="116" cy="84" r="10" fill="#FFFFFF" stroke="#FF1B8D" stroke-width="2.5" />

          <!-- Antenna -->
          <path d="M 70 26 Q 70 8 84 4" fill="none" stroke="#FFE600" stroke-width="3.5" stroke-linecap="round" />
          <circle id="termi-antenna-glow" cx="84" cy="4" r="5" fill="#FFE600" stroke="#FF6B00" stroke-width="1.5" />
        </svg>

        <!-- Megasized Shadow/Aura in Background for Singularity / Hyper -->
        <div id="mega-termi-shadow" class="mega-termi-backdrop"></div>
      </div>
    `;

    this.svgEl = this.container.querySelector('#termi-nyan-svg') as SVGSVGElement;
    this.eyesText = this.container.querySelector('#termi-eyes') as SVGTextElement;
    this.leftEar = this.container.querySelector('#termi-left-ear') as SVGPolygonElement;
    this.rightEar = this.container.querySelector('#termi-right-ear') as SVGPolygonElement;
    this.leftHand = this.container.querySelector('#termi-left-hand') as SVGCircleElement;
    this.rightHand = this.container.querySelector('#termi-right-hand') as SVGCircleElement;
    this.crownEl = this.container.querySelector('#termi-crown') as SVGElement;
    this.antennaGlow = this.container.querySelector('#termi-antenna-glow') as SVGCircleElement;
    this.wrapperEl = this.container.querySelector('#termi-wrapper') as HTMLElement;
  }

  public setComboRank(rank: string) {
    if (rank === 'fever' || rank === 'hyper_dopa' || rank === 'singularity') {
      if (this.crownEl) this.crownEl.style.display = 'block';
    } else {
      if (this.crownEl) this.crownEl.style.display = 'none';
    }
  }

  public setState(state: MascotState) {
    const prev = this.state;
    this.state = state;
    if (this.wrapperEl) {
      this.wrapperEl.dataset.state = state;
      if (state !== prev) {
        if (state === 'success') this.puff('termi-ring', 900, 2);
        else if (state === 'singularity' || state === 'huge_raid') this.puff('termi-ring termi-ring-big', 1300, 3);
        else if (state === 'failure') this.puff('termi-sweat', 1300, 2);
        else if (state === 'transfer') this.puff('termi-spark', 700, 3);
      }
    }

    if (state === 'idle') {
      this.eyesText.textContent = '^ ^';
      this.eyesText.setAttribute('fill', '#00F5D4');
      this.targetScale = 1;
      this.targetY = 0;
      this.targetX = 0;
      this.targetRotation = 0;
      this.antennaGlow.setAttribute('fill', '#FFE600');
    } else if (state === 'candidate') {
      // 耳ピクピク・身を乗り出す
      this.eyesText.textContent = '• •';
      this.eyesText.setAttribute('fill', '#FFE600');
      this.targetScale = 1.15;
      this.targetY = -12;
      this.targetRotation = -5;
      this.antennaGlow.setAttribute('fill', '#00F0FF');
    } else if (state === 'transfer') {
      // 激しくトス・バイザー光る
      this.eyesText.textContent = '> <';
      this.eyesText.setAttribute('fill', '#FF1B8D');
      this.targetScale = 1.25;
      this.targetY = -22;
      this.targetRotation = 5;
      this.antennaGlow.setAttribute('fill', '#FF007F');
    } else if (state === 'success') {
      // 宙返り大勝利ジャンプ！
      this.eyesText.textContent = '★ ★';
      this.eyesText.setAttribute('fill', '#FFE600');
      this.targetScale = 1.4;
      this.targetY = -55; // Big jump!
      this.targetRotation = 360; // Full 360 flip!
      this.antennaGlow.setAttribute('fill', '#00FFA3');
    } else if (state === 'failure') {
      // スリップして転倒！頭に星が回る（@ @）
      this.eyesText.textContent = '@ @';
      this.eyesText.setAttribute('fill', '#FF4757');
      this.targetScale = 0.85;
      this.targetY = 30; // Slump onto ground
      this.targetRotation = -45; // Tilted fall over
      this.antennaGlow.setAttribute('fill', '#555');
    } else if (state === 'eat') {
      // TYPO文字を食べる: 中央へ身を乗り出して大きく口を開ける（o o）
      this.eyesText.textContent = 'o o';
      this.eyesText.setAttribute('fill', '#FF1B8D');
      this.targetScale = 1.5;
      this.targetY = -45;
      this.targetX = -70;
      this.targetRotation = 18;
      this.antennaGlow.setAttribute('fill', '#FFE600');
    } else if (state === 'singularity' || state === 'huge_raid') {
      // 巨大化メガ乱入
      this.eyesText.textContent = '♥ ♥';
      this.eyesText.setAttribute('fill', '#00F0FF');
      this.targetScale = 2.4;
      this.targetY = -80;
      this.targetX = -60;
      this.targetRotation = 0;
      this.antennaGlow.setAttribute('fill', '#FF1B8D');
    }
  }

  private startPhysicsLoop() {
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.animTimer += dt;

      // Idle float (Sine wave)
      let curTargetY = this.targetY;
      let curTargetX = this.targetX;
      let curRot = this.targetRotation;

      if (this.state === 'idle') {
        if (this.excited) {
          // 興奮アイドル: 速い浮遊・大きめの揺れ・わずかな鼓動スケール
          curTargetY += Math.sin(this.animTimer * 5.2) * 13;
          curRot += Math.cos(this.animTimer * 3.4) * 6;
        } else {
          curTargetY += Math.sin(this.animTimer * 2.8) * 8;
          curRot += Math.cos(this.animTimer * 1.5) * 3;
        }
      } else if (this.state === 'transfer') {
        curTargetY += Math.sin(this.animTimer * 14) * 10;
        curRot += Math.sin(this.animTimer * 10) * 8;
      } else if (this.state === 'success') {
        curTargetX += Math.sin(this.animTimer * 16) * 12; // Happy dance shake
      }

      // Spring calculation for Y
      const forceY = -this.stiffness * (this.y - curTargetY) - this.damping * this.vy;
      this.vy += forceY * dt;
      this.y += this.vy * dt;

      // Spring calculation for X
      const forceX = -this.stiffness * (this.x - curTargetX) - this.damping * this.vx;
      this.vx += forceX * dt;
      this.x += this.vx * dt;

      // Spring calculation for Scale
      const forceScale = -this.stiffness * (this.scale - this.targetScale) - this.damping * this.vScale;
      this.vScale += forceScale * dt;
      this.scale += this.vScale * dt;

      // Spring calculation for Rotation
      const forceRot = -(this.stiffness * 0.8) * (this.rotation - curRot) - this.damping * this.vRot;
      this.vRot += forceRot * dt;
      this.rotation += this.vRot * dt;

      // Apply transforms
      if (this.svgEl) {
        this.svgEl.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.scale}) rotate(${this.rotation}deg)`;
      }

      // Interactive Hands movement
      if (this.state === 'transfer') {
        const tossOffset = Math.sin(this.animTimer * 18) * 14;
        if (this.leftHand) this.leftHand.setAttribute('cy', `${84 - tossOffset}`);
        if (this.rightHand) this.rightHand.setAttribute('cy', `${84 + tossOffset}`);
      } else if (this.state === 'success') {
        // High five arms up
        if (this.leftHand) this.leftHand.setAttribute('cy', '60');
        if (this.rightHand) this.rightHand.setAttribute('cy', '60');
      } else if (this.state === 'failure') {
        // Limp hands
        if (this.leftHand) this.leftHand.setAttribute('cy', '100');
        if (this.rightHand) this.rightHand.setAttribute('cy', '100');
      } else {
        if (this.leftHand) this.leftHand.setAttribute('cy', '84');
        if (this.rightHand) this.rightHand.setAttribute('cy', '84');
      }

      requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
  }
}
