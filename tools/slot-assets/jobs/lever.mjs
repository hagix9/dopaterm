import { stage, grab, lights, chrome } from '../lib.mjs';

const FW = 240, FH = 400, FRAMES = 8;

function lathe(THREE, pts, mat, seg = 64) {
  return new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg), mat);
}

function buildLever(THREE, angle) {
  const g = new THREE.Group();
  // 台座（クロームの円盤 + 化粧ネジ）
  const baseProfile = [[0, 0.0], [1.15, 0.0], [1.22, 0.06], [1.22, 0.2], [1.12, 0.3], [0.9, 0.34], [0, 0.34]];
  g.add(lathe(THREE, baseProfile.slice().reverse(), chrome(THREE, { roughness: 0.14 })));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 20), chrome(THREE, { color: 0xb8b8c4, roughness: 0.3 }));
    screw.position.set(Math.cos(a) * 1.0, 0.36, Math.sin(a) * 1.0);
    g.add(screw);
  }
  // 可動部（根元でピボット）
  const arm = new THREE.Group();
  arm.position.set(0, 0.34, 0);
  // ゴムブーツ
  const boot = [[0.42, 0], [0.4, 0.2], [0.28, 0.55], [0.17, 0.9], [0.14, 1.0]];
  arm.add(lathe(THREE, boot.slice().reverse(), new THREE.MeshPhysicalMaterial({ color: 0x0c0912, roughness: 0.65, metalness: 0.1 })));
  // シャフト
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.1, 40), chrome(THREE, { roughness: 0.08 }));
  shaft.position.y = 1.55;
  arm.add(shaft);
  // 球グリップ
  const grip = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 72, 48),
    new THREE.MeshPhysicalMaterial({ color: 0xb0082c, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.18, emissive: 0x2a0008, emissiveIntensity: 0.6 })
  );
  grip.position.y = 2.95;
  arm.add(grip);
  // グリップ根元の金属リング
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 20, 48), chrome(THREE));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 2.42;
  arm.add(collar);
  arm.rotation.x = angle; // 手前(+z)へ倒す
  g.add(arm);
  return g;
}

export const jobs = {
  'lever-sheet': async (ctx) => {
    const { THREE, renderer } = ctx;
    const sheet = document.createElement('canvas');
    sheet.width = FW * FRAMES; sheet.height = FH;
    const sg = sheet.getContext('2d');
    for (let f = 0; f < FRAMES; f++) {
      const t = f / (FRAMES - 1);
      const angle = t * 0.95; // 0〜約54度
      const { scene, cam } = stage(ctx, FW, FH, { fov: 26, pos: [0, 3.2, 11.5], look: [0, 1.75, 0], exposure: 0.95 });
      lights(THREE, scene, { key: 2.2, pink: 1.2, cyan: 1.0 });
      scene.add(buildLever(THREE, angle));
      renderer.setClearColor(0x000000, 0);
      renderer.render(scene, cam);
      sg.drawImage(renderer.domElement, f * FW, 0, FW, FH);
    }
    return { canvas: sheet };
  },
};
