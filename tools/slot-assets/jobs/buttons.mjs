import { stage, grab, lights, chrome } from '../lib.mjs';

const SIZE = 320;
const TILT = Math.PI / 2 - 0.42; // 操作面が手前上向きに傾いた見え方

function lathe(THREE, pts, mat, seg = 96) {
  const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg);
  return new THREE.Mesh(g, mat);
}
function buttonScene(ctx, part, lit) {
  const { THREE, renderer } = ctx;
  const { scene, cam } = stage(ctx, SIZE, SIZE, { fov: 24, pos: [0, 0.4, 9], look: [0, 0.2, 0], exposure: part === 'lens' ? 0.8 : 1.05 });
  lights(THREE, scene, { key: 2.4, pink: lit ? 0.8 : 1.5 });
  const grp = new THREE.Group();
  if (part === 'ring') {
    // 外側ベゼル（クロム）: 立ち上がった縁 + 内側のスロープ
    const ring = [[1.62, -0.1], [1.62, 0.1], [1.56, 0.2], [1.46, 0.24], [1.3, 0.2], [1.18, 0.1], [1.12, -0.05], [1.12, -0.2]];
    grp.add(lathe(THREE, ring, chrome(THREE, { roughness: 0.1 })));
    // 内側のゴムブーツ（黒）
    const boot = [[1.14, -0.2], [1.14, -0.05], [1.0, 0.02], [0.0, 0.02]];
    grp.add(lathe(THREE, boot, new THREE.MeshPhysicalMaterial({ color: 0x0a0710, roughness: 0.7, metalness: 0.1 })));
  } else {
    // レンズ: 樹脂ドーム（オフ=深紅、オン=内部発光）
    const dome = [[0, 0.95], [0.2, 0.93], [0.4, 0.88], [0.6, 0.78], [0.78, 0.63], [0.92, 0.42], [1.02, 0.18], [1.06, -0.02], [1.06, -0.12], [0.0, -0.12]];
    const mat = new THREE.MeshPhysicalMaterial({
      color: lit ? 0xd0083f : 0x8a0a1e,
      roughness: 0.5,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      emissive: lit ? 0xff0848 : 0x180004,
      emissiveIntensity: lit ? 0.62 : 0.5,
      envMapIntensity: 0.14,
    });
    grp.add(lathe(THREE, dome.slice().reverse(), mat));
  }
  grp.rotation.x = TILT;
  scene.add(grp);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);
  return { canvas: grab(ctx, SIZE, SIZE) };
}
export const jobs = {
  'stop-ring': async (c) => buttonScene(c, 'ring', false),
  'stop-lens-off': async (c) => buttonScene(c, 'lens', false),
  'stop-lens-on': async (c) => buttonScene(c, 'lens', true),
};
