import { stage, grab, lights, chrome } from '../lib.mjs';
const S = 512;

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
function frame(THREE, outer, inner, ro, ri, depth, bevel, mat) {
  const shape = roundedRect(THREE, outer, outer, ro);
  const hole = roundedRect(THREE, inner, inner, ri);
  shape.holes.push(new THREE.Path(hole.getPoints(40)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 14, curveSegments: 40 });
  geo.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geo, mat);
}
function render(ctx, mesh, view = 5.1, tiltX = 0, exposure = 1.0) {
  const { THREE, renderer } = ctx;
  const { scene } = stage(ctx, S, S, { exposure });
  const cam = new THREE.OrthographicCamera(-view, view, view, -view, 0.1, 50);
  cam.position.set(0, 0, 12);
  lights(THREE, scene, { key: 2.6, pink: 1.0, cyan: 0.8 });
  mesh.rotation.x = tiltX;
  scene.add(mesh);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  return { canvas: grab(ctx, S, S) };
}
export const jobs = {
  // メッキ細枠（液晶/リール窓のベゼル）: 断面が丸いクローム。9-slice 用
  'bezel-chrome': async (ctx) => {
    const { THREE } = ctx;
    return render(ctx, frame(THREE, 7.7, 7.5, 1.55, 1.85, 0.2, 0.85, chrome(THREE, { roughness: 0.09, envMapIntensity: 1.5 })));
  },
  // 塗装樹脂の筐体外枠: 断面が丸いクリアコート塗装（深いバイオレット）。9-slice 用
  'body-frame': async (ctx) => {
    const { THREE } = ctx;
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x14072a, roughness: 0.6, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.16 });
    return render(ctx, frame(THREE, 8.1, 7.0, 2.2, 1.9, 0.2, 0.75, paint), 5.1, 0, 0.75);
  },
};
