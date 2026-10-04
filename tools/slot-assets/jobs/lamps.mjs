import { stage, grab, lights, chrome } from '../lib.mjs';
const S = 256;
function lathe(THREE, pts, mat, seg = 96) {
  return new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg), mat);
}
const TILT = Math.PI / 2 - 0.3;
export const jobs = {
  // クロームのリング（アルファ付き）。中央は抜けていてCSSの発光体が見える
  'dome-ring': async (ctx) => {
    const { THREE, renderer } = ctx;
    const { scene, cam } = stage(ctx, S, S, { fov: 24, pos: [0, 0.3, 9], look: [0, 0.1, 0], exposure: 1.05 });
    lights(THREE, scene);
    const prof = [[1.72, -0.1], [1.72, 0.12], [1.62, 0.28], [1.45, 0.34], [1.28, 0.28], [1.2, 0.12], [1.18, -0.1]];
    const g = new THREE.Group();
    g.add(lathe(THREE, prof, chrome(THREE, { roughness: 0.1 })));
    g.rotation.x = TILT;
    scene.add(g);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, cam);
    return { canvas: grab(ctx, S, S) };
  },
  // ガラスドームの反射だけ（黒背景。CSS で mix-blend-mode: screen）
  'dome-glass': async (ctx) => {
    const { THREE, renderer } = ctx;
    const { scene, cam } = stage(ctx, S, S, { bg: 0x000000, fov: 24, pos: [0, 0.3, 9], look: [0, 0.1, 0], exposure: 1.0, envIntensity: 1.0 });
    lights(THREE, scene, { key: 3, pink: 0.6, cyan: 0.6 });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 96, 64, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.01, envMapIntensity: 1.6, specularIntensity: 1, ior: 1.6 })
    );
    dome.scale.y = 0.75;
    const g = new THREE.Group();
    g.add(dome);
    g.rotation.x = TILT;
    scene.add(g);
    renderer.render(scene, cam);
    return { canvas: grab(ctx, S, S) };
  },
};
