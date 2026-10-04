import { stage, grab, lights, chrome } from '../lib.mjs';

/* 操作デッキ（前面に張り出した天面）と、その下に見える前立て面。
 * 実機のデッキは「手前が低く奥が高い」平面ではなく、角の丸い樹脂成形品で、
 * 前端に沿ったクロームの lip（段差）がある。ここでは 3D でその形を作り、
 * 天面／前立て面／継ぎ目の 3 枚の画像として書き出す（CSS のグラデーションで代用しない）。 */

const TOP_W = 1280, TOP_H = 360;   // 天面（約 3.55:1）
const FASCIA_W = 1280, FASCIA_H = 200;
const SEAM_W = 768, SEAM_H = 48;

function roundedRect(THREE, w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** 平たいプレート。x=幅 / y=奥行(+y が奥) / z=高さ(+z が上)。上面を z=0 にそろえる。 */
function slab(THREE, w, d, r, h, mat, bevel = 0.06) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(THREE, w, d, r), {
    depth: h, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: 28,
  });
  // 押し出しは z=0 → z=+h なので、-h だけ下げて「上面が z=0・下面が z=-h」にする。
  geo.translate(0, 0, -h);
  return new THREE.Mesh(geo, mat);
}

/** 角の丸い「縁取り」プレート。中央に四角い穴が空く（実機のような成形リブ）。 */
function slabFrame(THREE, w, d, r, iw, id, ir, h, mat, bevel = 0.05) {
  const shape = roundedRect(THREE, w, d, r);
  shape.holes.push(new THREE.Path(roundedRect(THREE, iw, id, ir).getPoints(36)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 28,
  });
  geo.translate(0, 0, -h);
  return new THREE.Mesh(geo, mat);
}

const paint = (THREE, color, rough, o = {}) => new THREE.MeshPhysicalMaterial({
  color, roughness: rough, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.2, ...o,
});

export const jobs = {
  /* 天面: 手前(y<0)が低い本体 + ヘアライン仕上げのインレイ + 前端のクローム lip + 奥の段差 */
  'deck-top': async (ctx) => {
    const { THREE, renderer } = ctx;
    const { scene } = stage(ctx, TOP_W, TOP_H, { exposure: 1.0 });

    const cam = new THREE.OrthographicCamera(-8.6, 8.6, 2.42, -2.42, 0.1, 60);
    cam.position.set(0, -6.4, 9.4);
    cam.lookAt(0, 0.1, 0.1);
    lights(THREE, scene, { key: 3.1, pink: 1.2, cyan: 1.0 });

    const g = new THREE.Group();

    // 1) 本体: 立ち上がった成形リブ。中央が沈んでいる（実機のデッキと同じ段差）
    g.add(slabFrame(THREE, 16, 5.2, 0.5, 14.3, 3.5, 0.32, 0.62, paint(THREE, 0x3a2c4e, 0.5)));

    // 2) ヘアライン仕上げのアルミニウムインレイ（リブの穴の中に沈めた操作面）
    const inlay = new THREE.MeshPhysicalMaterial({
      color: 0x8d8799, metalness: 0.45, roughness: 0.4, anisotropy: 0.8, anisotropyRotation: 0, envMapIntensity: 1.2,
    });
    const inlayMesh = slab(THREE, 14.5, 3.7, 0.34, 0.5, inlay, 0.04);
    inlayMesh.position.set(0, 0, -0.44);
    g.add(inlayMesh);

    // 3) 前端の lip（クローム）— デッキが「張り出している」ことを示す段差
    const lip = slab(THREE, 15.1, 0.55, 0.22, 0.3, chrome(THREE, { roughness: 0.16, envMapIntensity: 1.5 }));
    lip.position.set(0, -2.32, 0.18);
    g.add(lip);

    // 4) lip の下落到り面（暗部 = 段差の陰影）
    const skirt = slab(THREE, 15.1, 0.34, 0.12, 0.34, paint(THREE, 0x120c1c, 0.7), 0.03);
    skirt.position.set(0, -2.52, 0.02);
    g.add(skirt);

    // 5) 奥の段差（筐体本体との継ぎ目）
    const back = slab(THREE, 15.1, 0.5, 0.16, 0.22, paint(THREE, 0x241a33, 0.6));
    back.position.set(0, 2.2, 0.12);
    g.add(back);

    // 6) 左右の端部トリム（クロームの細い縁）
    for (const sx of [-1, 1]) {
      const cap = slab(THREE, 0.34, 4.2, 0.14, 0.42, chrome(THREE, { roughness: 0.2, envMapIntensity: 1.3 }), 0.04);
      cap.position.set(sx * 7.62, -0.15, 0.16);
      g.add(cap);
    }

    // 全体を寝かせる: ローカル +y(奥) → ワールド -z / ローカル +z(上) → ワールド +y
    g.rotation.x = -Math.PI / 2;

    scene.add(g);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    return { canvas: grab(ctx, TOP_W, TOP_H) };
  },

  /* 前立て面: lip の下に見える垂直面。上端のクロームライン → 下方に向かって暗くなる */
  'deck-fascia': async (ctx) => {
    const { THREE, renderer } = ctx;
    const { scene } = stage(ctx, FASCIA_W, FASCIA_H, { exposure: 1.0 });
    const cam = new THREE.OrthographicCamera(-8, 8, 1.25, -1.25, 0.1, 60);
    cam.position.set(0, -12, 0.2);
    cam.lookAt(0, 0, 0);
    lights(THREE, scene, { key: 2.2, pink: 0.9, cyan: 0.7 });

    const g = new THREE.Group();
    // 垂直面（板を z 軸から x 軸へ立てて向く）
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 1.7, 1, 1),
      paint(THREE, 0x1b1329, 0.5)
    );
    g.add(face);
    // 上端のクロームトリム
    const trim = new THREE.Mesh(new THREE.BoxGeometry(16, 0.16, 0.16), chrome(THREE, { roughness: 0.18, envMapIntensity: 1.4 }));
    trim.position.set(0, 0.78, 0.1);
    g.add(trim);
    // 水平の意匠ライン（ moor 溝）
    const groove = new THREE.Mesh(new THREE.BoxGeometry(16, 0.07, 0.07), paint(THREE, 0x0a0612, 0.8));
    groove.position.set(0, -0.34, 0.06);
    g.add(groove);

    scene.add(g);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    return { canvas: grab(ctx, FASCIA_W, FASCIA_H) };
  },

  /* パネル継ぎ目: 筐体の上下パネルの間に挟む細いクロームの段差 */
  'seam-chrome': async (ctx) => {
    const { THREE, renderer } = ctx;
    const { scene } = stage(ctx, SEAM_W, SEAM_H, { exposure: 1.0 });
    const cam = new THREE.OrthographicCamera(-8, 8, 0.5, -0.5, 0.1, 60);
    cam.position.set(0, -12, 0);
    cam.lookAt(0, 0, 0);
    lights(THREE, scene, { key: 2.6, pink: 0.8, cyan: 0.7 });

    const g = new THREE.Group();
    // 上から下へ: ハイライトの丸み → 影の溝 → 下の面の落ち込み
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 16, 48, 1, false, 0, Math.PI), chrome(THREE, { roughness: 0.14, envMapIntensity: 1.6 }));
    upper.rotation.z = Math.PI / 2; upper.rotation.y = Math.PI / 2;
    upper.position.set(0, 0.16, 0);
    g.add(upper);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(16, 0.26, 0.1), paint(THREE, 0x0d0817, 0.75));
    lower.position.set(0, -0.16, 0);
    g.add(lower);

    scene.add(g);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    return { canvas: grab(ctx, SEAM_W, SEAM_H) };
  },

  /* 小型ランプのレンズ: 指示灯（INSERT/START/WIN 等）とマーキーの電飾を
   * 実際の金具（クロームの座＋樹脂レンズ）として描画する。点灯側は emissive。 */
  'lamp-lens-off': async (ctx) => { return lamp(ctx, false); },
  'lamp-lens-on': async (ctx) => { return lamp(ctx, true); },
};

function lamp(ctx, lit) {
  const { THREE, renderer } = ctx;
  const S = 128;
  const { scene } = stage(ctx, S, S, { exposure: lit ? 0.9 : 1.0 });
  const cam = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 40);
  cam.position.set(0, -1.2, 4.2);
  cam.lookAt(0, 0, 0);
  lights(THREE, scene, { key: 2.4, pink: lit ? 1.2 : 0.7, cyan: 0.6 });

  const g = new THREE.Group();
  // 座（クロームのリング）
  const seat = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.17, 24, 72),
    chrome(THREE, { roughness: 0.13, envMapIntensity: 1.5 })
  );
  g.add(seat);
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.12, 1.02, 0.22, 64),
    chrome(THREE, { roughness: 0.18, envMapIntensity: 1.3 })
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.z = -0.16;
  g.add(collar);
  // レンズ（樹脂ドーム）
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.86, 64, 40, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({
      color: lit ? 0xff3a72 : 0x5a0a20,
      roughness: 0.35, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.02,
      emissive: lit ? 0xff1a5c : 0x20020a,
      emissiveIntensity: lit ? 0.9 : 0.35,
      envMapIntensity: 0.2,
    })
  );
  lens.scale.z = 0.55;
  lens.position.z = 0.02;
  g.add(lens);

  scene.add(g);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  return { canvas: grab(ctx, S, S) };
}
