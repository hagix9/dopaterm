/* 2D で生成する素材: 図柄 / リールの陰影・反射 / ガラス反射 / 質感タイル / 金属ロゴ */
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const loadSvg = (svg) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
});

/* ---------------- 図柄（リールの印刷フィルム） ---------------- */
const SYM = [
  { id: 'seven', c: ['#ff6a7a', '#e1103a', '#7a0018'], text: '7' },
  { id: 'star', c: ['#fff1a0', '#ffb300', '#b25a00'], d: 'M50 6 L61.8 36.5 L94.6 38.3 L69 58.8 L77.5 90.5 L50 72.8 L22.5 90.5 L31 58.8 L5.4 38.3 L38.2 36.5 Z' },
  { id: 'note', c: ['#8fe9ff', '#0a8fd0', '#033e66'], d: 'M40 10 L80 20 L80 66 C80 78 70 84 60 84 C50 84 44 78 44 70 C44 62 52 56 62 58 L62 32 L48 28 L48 74 C48 86 38 92 28 92 C18 92 12 86 12 78 C12 70 20 64 30 66 L40 68 Z' },
  { id: 'diamond', c: ['#ff9bf0', '#c01bb0', '#4a0a56'], d: 'M30 10 L70 10 L94 38 L50 94 L6 38 Z' },
  { id: 'bolt', c: ['#fff6a0', '#f2b400', '#9a5a00'], d: 'M60 4 L16 56 L44 56 L34 96 L84 38 L56 38 Z' },
  { id: 'radiation', c: ['#a8ff9a', '#12923a', '#05401a'], radiation: true },
  { id: 'heart', c: ['#ffa8c8', '#ff2d78', '#8a0a3a'], d: 'M50 92 C10 60 4 32 22 18 C34 9 46 16 50 28 C54 16 66 9 78 18 C96 32 90 60 50 92 Z' },
  { id: 'skull', c: ['#d9b8ff', '#6a2bb8', '#25084a'], skull: true },
];
function symbolSvg(s) {
  const grad = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.c[0]}"/><stop offset="0.5" stop-color="${s.c[1]}"/><stop offset="1" stop-color="${s.c[2]}"/></linearGradient>`;
  let shape;
  if (s.text) shape = `<text x="50" y="84" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="104" text-anchor="middle" fill="url(#g)" stroke="#12061c" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${s.text}</text>`;
  else if (s.radiation) {
    const wedge = (rot) => `<path transform="rotate(${rot} 50 50)" d="M50 50 L${50 + 44 * Math.sin(-Math.PI / 6)} ${50 - 44 * Math.cos(-Math.PI / 6)} A44 44 0 0 1 ${50 + 44 * Math.sin(Math.PI / 6)} ${50 - 44 * Math.cos(Math.PI / 6)} Z" fill="url(#g)" stroke="#12061c" stroke-width="4" stroke-linejoin="round"/>`;
    shape = `<g>${wedge(0)}${wedge(120)}${wedge(240)}<circle cx="50" cy="50" r="10" fill="#12061c"/><circle cx="50" cy="50" r="6" fill="${s.c[0]}"/></g>`;
  } else if (s.skull) {
    shape = `<g stroke="#12061c" stroke-width="4" stroke-linejoin="round"><path d="M50 8 C24 8 12 26 12 46 C12 58 18 66 26 70 L26 86 L74 86 L74 70 C82 66 88 58 88 46 C88 26 76 8 50 8 Z" fill="url(#g)"/>
      <ellipse cx="34" cy="48" rx="9.5" ry="11" fill="#12061c"/><ellipse cx="66" cy="48" rx="9.5" ry="11" fill="#12061c"/><path d="M50 56 L44 70 L56 70 Z" fill="#12061c"/>
      <path d="M38 86 L38 74 M50 86 L50 74 M62 86 L62 74" fill="none" stroke-width="3.5"/></g>`;
  } else shape = `<path d="${s.d}" fill="url(#g)" stroke="#12061c" stroke-width="5" stroke-linejoin="round"/>`;
  // 光沢（上半分の白いハイライトを図形でクリップ）
  const clipShape = s.text
    ? `<text x="50" y="84" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="104" text-anchor="middle">${s.text}</text>`
    : s.radiation ? `<circle cx="50" cy="50" r="44"/>` : s.skull ? `<path d="M50 8 C24 8 12 26 12 46 C12 58 18 66 26 70 L26 86 L74 86 L74 70 C82 66 88 58 88 46 C88 26 76 8 50 8 Z"/>` : `<path d="${s.d}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256"><defs>${grad}
    <linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="cp">${clipShape}</clipPath>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.2" stdDeviation="1.6" flood-color="#000" flood-opacity="0.45"/></filter></defs>
    <g filter="url(#sh)">${shape}</g>
    <g clip-path="url(#cp)"><rect x="0" y="0" width="100" height="52" fill="url(#gl)"/><ellipse cx="34" cy="26" rx="18" ry="7" fill="#fff" opacity="0.45" transform="rotate(-22 34 26)"/></g></svg>`;
}
const symbolJobs = {};
SYM.forEach((s, i) => {
  symbolJobs['sym-' + i] = async () => {
    const img = await loadSvg(symbolSvg(s));
    const c = cv(256, 256);
    c.getContext('2d').drawImage(img, 0, 0, 256, 256);
    return { canvas: c };
  };
});

/* ---------------- ユーティリティ ---------------- */
function perPixel(w, h, fn) {
  const c = cv(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const [r, gg, b, a] = fn(x / (w - 1), y / (h - 1), x, y);
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return c;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------------- リール: 円筒の陰影 (multiply 用) / 反射 (screen 用) ---------------- */
const reelJobs = {
  // 黒のアルファ陰影。上下の曲面の落ち込み + 窓枠による影 + 左右の壁の影
  'reel-shade': async () => ({
    canvas: perPixel(160, 480, (u, v) => {
      const cy = Math.abs(v * 2 - 1);                       // 0=中央 1=上下端
      const curve = Math.pow(cy, 2.6) * 0.82;               // 円筒の傾斜による減光
      const frameTop = 0.55 * (1 - smooth(0.0, 0.07, v)) + 0.55 * (1 - smooth(0.0, 0.07, 1 - v)); // 窓枠の影
      const cx = Math.abs(u * 2 - 1);
      const wall = Math.pow(cx, 5) * 0.4;                   // 左右の隣接リール/壁の影
      const a = clamp01(curve + frameTop + wall);
      return [6, 2, 16, Math.round(a * 255)];
    }),
  }),
  // 黒背景の反射（CSS: mix-blend-mode: screen）。縦の細長いソフトボックスの映り込み
  'reel-glare': async () => ({
    canvas: perPixel(160, 480, (u, v) => {
      const band = (c, w) => Math.exp(-Math.pow((u - c) / w, 2));
      const vfade = smooth(0.04, 0.22, v) * (1 - smooth(0.74, 0.96, v));
      const l = (0.5 * band(0.2, 0.05) + 0.2 * band(0.2, 0.16) + 0.18 * band(0.82, 0.03) + 0.08 * band(0.5, 0.35)) * vfade;
      const hot = 0.1 * Math.exp(-Math.pow((v - 0.3) / 0.05, 2)) * (0.4 + 0.6 * band(0.5, 0.45));
      const k = clamp01(l + hot);
      return [255, 252, 245, 255].map((c, i) => (i === 3 ? 255 : Math.round(c * k)));
    }),
  }),
  // 液晶/リール窓のガラス: 斜めの映り込み（黒背景 screen）
  'glass-glare': async () => ({
    canvas: perPixel(512, 512, (u, v) => {
      const d = (u * 0.62 + v * 0.38);
      const b1 = Math.exp(-Math.pow((d - 0.28) / 0.07, 2)) * 0.55;
      const b2 = Math.exp(-Math.pow((d - 0.42) / 0.015, 2)) * 0.55;
      const sweep = smooth(0.0, 0.5, 1 - v) * 0.1 * smooth(0, 1, 1 - d);
      const k = clamp01((b1 + b2) * (1 - 0.5 * v) + sweep);
      const c = Math.round(255 * k);
      return [c, c, Math.min(255, Math.round(c * 1.04)), 255];
    }),
  }),
};

/* ---------------- 質感タイル ---------------- */
const textureJobs = {
  // 塗装のゆず肌（タイル可能・グレー: overlay 用）
  'paint-grain': async () => {
    const S = 256, rnd = mulberry(7);
    const waves = Array.from({ length: 60 }, () => ({ kx: (Math.floor(rnd() * 40) - 20) || 3, ky: (Math.floor(rnd() * 40) - 20) || 5, p: rnd() * 6.28, a: 0.3 + rnd() * 0.7 }));
    return { canvas: perPixel(S, S, (u, v) => {
      let s = 0;
      for (const w of waves) s += w.a * Math.sin((u * w.kx + v * w.ky) * 2 * Math.PI + w.p);
      const n = 0.5 + s / (waves.length * 2.4);
      const c = Math.round(clamp01(n) * 255);
      return [c, c, c, 255];
    }) };
  },
  // ヘアライン仕上げ（横方向の筋・タイル可能）
  'brushed': async () => {
    const W = 512, H = 128, rnd = mulberry(11);
    const rows = Array.from({ length: H }, () => 0.35 + rnd() * 0.65);
    const phases = Array.from({ length: H }, () => rnd() * 6.28);
    return { canvas: perPixel(W, H, (u, v, x, y) => {
      const n = rows[y] * (0.8 + 0.2 * Math.sin(u * 2 * Math.PI * (3 + (y % 7)) + phases[y]));
      const c = Math.round(clamp01(n) * 255);
      return [c, c, c, 255];
    }) };
  },
  // スピーカーの打ち抜き孔（タイル）
  'perforated': async () => {
    const S = 24, scale = 4;
    const c = cv(S * scale, S * scale), g = c.getContext('2d');
    g.fillStyle = '#26202e'; g.fillRect(0, 0, c.width, c.height);
    const hole = (cx, cy) => {
      const r = 6 * scale / 2.3;
      let gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r * 1.2);
      gr.addColorStop(0, '#000'); gr.addColorStop(1, '#050408');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r + 1, 0.2, 2.6); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(cx, cy, r + 1, 3.4, 5.7); g.stroke();
    };
    hole(c.width * 0.25, c.height * 0.25); hole(c.width * 0.75, c.height * 0.75);
    return { canvas: c };
  },
};

/* ---------------- 金属ロゴ（高さマップ → 法線 → ゴールドのマットキャップ） ---------------- */
function blur(src, r) {
  const w = src.width, h = src.height;
  const c = cv(w, h), g = c.getContext('2d');
  g.filter = `blur(${r}px)`;
  g.drawImage(src, 0, 0);
  return g.getImageData(0, 0, w, h);
}
function goldMatcap(nx, ny, nz) {
  // 反射ベクトルの縦成分で空/地平/地面の帯を引く（クロームの映り込み方）
  const t = clamp01(0.5 + ny * 0.62 + nx * 0.14);
  const stops = [[0, [62, 34, 0]], [0.18, [196, 130, 12]], [0.36, [255, 238, 168]], [0.47, [255, 214, 92]], [0.52, [140, 84, 6]], [0.6, [70, 38, 0]], [0.78, [232, 170, 40]], [1, [255, 246, 190]]];
  let i = 0; while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
  const k = clamp01((t - t0) / (t1 - t0));
  const col = c0.map((v, j) => v + (c1[j] - v) * k);
  const spec = Math.pow(clamp01(nx * -0.35 + ny * -0.55 + nz * 0.76), 36) * 255;
  return col.map((v) => Math.min(255, v + spec));
}
const logoJobs = {
  'logo-dopaslot': async () => {
    const W = 1400, H = 220;
    const mask = cv(W, H), mg = mask.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, W, H);
    mg.fillStyle = '#fff'; mg.textAlign = 'center'; mg.textBaseline = 'middle';
    mg.font = '900 168px "Arial Black", Impact, sans-serif';
    if ('letterSpacing' in mg) mg.letterSpacing = '14px';
    mg.fillText('DOPA SLOT', W / 2, H / 2 + 6);
    // 高さ = 複数半径のぼかしの合成（面取りの丸み）
    const b1 = blur(mask, 3), b2 = blur(mask, 8), b3 = blur(mask, 16), m = mg.getImageData(0, 0, W, H);
    const hgt = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      hgt[i] = (b1.data[o] * 0.5 + b2.data[o] * 0.35 + b3.data[o] * 0.15) / 255 * 9;
    }
    const out = cv(W, H), g = out.getContext('2d'), img = g.createImageData(W, H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, o = i * 4;
      const dx = (hgt[i + 1] - hgt[i - 1]) * 0.5, dy = (hgt[i + W] - hgt[i - W]) * 0.5;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const [r, gg, b] = goldMatcap(-dx * inv, dy * inv, inv);
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b;
      img.data[o + 3] = Math.round(clamp01((b1.data[o] - 90) / 100) * 255);
    }
    g.putImageData(img, 0, 0);
    return { canvas: out };
  },
};

export const jobs = { ...symbolJobs, ...reelJobs, ...textureJobs, ...logoJobs };
