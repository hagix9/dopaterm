/**
 * WebGL 背景演出エンジン (Dopaterm Background Engine)
 * サイバーネオントンネル、宇宙ワープ、CSSフォールバック
 */

import { ComboRank, DisasterType } from '../types/events.js';

export class BackgroundEngine {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private timeUniformLoc: WebGLUniformLocation | null = null;
  private resolutionUniformLoc: WebGLUniformLocation | null = null;
  private modeUniformLoc: WebGLUniformLocation | null = null;

  private currentMode = 0; // 0: Normal, 1: Combo, 2: Fever, 3: HyperDopa, 4: Waterlog
  private isRunning = false;
  private startTime = performance.now();
  private fallbackEl: HTMLElement | null = null;

  constructor(canvas: HTMLCanvasElement, fallbackEl: HTMLElement | null = null) {
    this.canvas = canvas;
    this.fallbackEl = fallbackEl;

    this.initGL();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Context lost protection
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('⚠️ WebGL context lost! Falling back to CSS.');
      this.gl = null;
      if (this.fallbackEl) {
        this.fallbackEl.style.display = 'block';
      }
    });

    this.start();
  }

  private initGL() {
    this.gl = this.canvas.getContext('webgl', { alpha: true, antialias: false });
    if (!this.gl) {
      if (this.fallbackEl) this.fallbackEl.style.display = 'block';
      return;
    }

    const vsSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Dynamic fragment shader for Tunnel, Warp, and Subtle Grids
    const fsSource = `
      precision mediump float;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform int u_mode;

      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;

        if (u_mode == 0) {
          // Normal: Subtle deep grid pulse
          vec2 grid = abs(fract(uv * 10.0 - 0.5) - 0.5) / fwidth(uv * 10.0);
          float line = min(grid.x, grid.y);
          float c = 1.0 - min(line, 1.0);
          gl_FragColor = vec4(0.05, 0.04, 0.09, 1.0) + vec4(0.08, 0.05, 0.15, 1.0) * c * 0.15;
        } else if (u_mode == 1) {
          // Combo: Golden pulse
          float dist = length(uv);
          float ring = sin(dist * 20.0 - u_time * 4.0);
          vec3 col = mix(vec3(0.06, 0.05, 0.12), vec3(0.3, 0.25, 0.05), smoothstep(0.8, 1.0, ring) * 0.3);
          gl_FragColor = vec4(col, 1.0);
        } else if (u_mode == 2) {
          // Fever: Cyber Neon Rainbow Tunnel
          float dist = length(uv);
          float angle = atan(uv.y, uv.x);
          float speed = u_time * 2.5;
          float tunnel = sin(1.0 / dist * 6.0 + speed);
          vec3 col = 0.5 + 0.5 * cos(angle * 3.0 + speed + vec3(0.0, 2.0, 4.0));
          col *= smoothstep(0.05, 0.5, dist) * (0.4 + 0.6 * tunnel);
          gl_FragColor = vec4(col * 0.35 + vec3(0.05, 0.04, 0.09), 1.0);
        } else if (u_mode == 3) {
          // Hyper Dopa: Deep space star-warp
          float dist = length(uv);
          float angle = atan(uv.y, uv.x);
          float warp = sin(angle * 12.0 + u_time * 8.0) * 0.5 + 0.5;
          vec3 col = vec3(0.02, 0.05, 0.15) + vec3(0.2, 0.1, 0.4) * (1.0 / (dist * 4.0 + 0.1)) * warp * 0.2;
          gl_FragColor = vec4(col, 1.0);
        } else if (u_mode == 4) {
          // Waterlogging (Disaster)
          float wave = sin(uv.x * 12.0 + u_time * 3.0) * 0.05;
          if (uv.y < 0.2 + wave) {
            gl_FragColor = vec4(0.0, 0.3, 0.6, 0.7);
          } else {
            gl_FragColor = vec4(0.05, 0.04, 0.09, 1.0);
          }
        } else {
          gl_FragColor = vec4(0.05, 0.04, 0.09, 1.0);
        }
      }
    `;

    const vs = this.createShader(this.gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    this.program = this.gl.createProgram();
    if (!this.program) return;
    this.gl.attachShader(this.program, vs);
    this.gl.attachShader(this.program, fs);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      console.error(this.gl.getProgramInfoLog(this.program));
      return;
    }

    this.timeUniformLoc = this.gl.getUniformLocation(this.program, 'u_time');
    this.resolutionUniformLoc = this.gl.getUniformLocation(this.program, 'u_resolution');
    this.modeUniformLoc = this.gl.getUniformLocation(this.program, 'u_mode');

    // Full screen quad
    this.positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      this.gl.STATIC_DRAW
    );
  }

  private createShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error(this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  public setRank(rank: ComboRank) {
    if (rank === 'normal') this.currentMode = 0;
    else if (rank === 'combo') this.currentMode = 1;
    else if (rank === 'fever') this.currentMode = 2;
    else if (rank === 'hyper_dopa' || rank === 'singularity') this.currentMode = 3;
  }

  public setDisaster(type: DisasterType) {
    if (type === 'waterlogging') {
      this.currentMode = 4;
    }
  }

  public reset() {
    this.currentMode = 0;
  }

  private start() {
    this.isRunning = true;
    const render = () => {
      if (!this.isRunning) return;
      if (this.gl && this.program) {
        this.gl.useProgram(this.program);

        const currentTime = (performance.now() - this.startTime) / 1000;
        if (this.timeUniformLoc) this.gl.uniform1f(this.timeUniformLoc, currentTime);
        if (this.resolutionUniformLoc) {
          this.gl.uniform2f(this.resolutionUniformLoc, this.canvas.width, this.canvas.height);
        }
        if (this.modeUniformLoc) this.gl.uniform1i(this.modeUniformLoc, this.currentMode);

        const posAttr = this.gl.getAttribLocation(this.program, 'a_position');
        this.gl.enableVertexAttribArray(posAttr);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.vertexAttribPointer(posAttr, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }
}
