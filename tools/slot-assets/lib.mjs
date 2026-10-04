/* shared helpers for asset jobs */
export function stage(ctx, w, h, { bg = null, fov = 28, pos = [0, 0, 10], look = [0, 0, 0], exposure = 1.0, envIntensity = 1.0 } = {}) {
  const { THREE, renderer, env } = ctx;
  renderer.setSize(w, h, false);
  renderer.toneMappingExposure = exposure;
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = envIntensity;
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.1, 100);
  cam.position.set(...pos);
  cam.lookAt(...look);
  if (bg !== null) scene.background = new THREE.Color(bg);
  return { scene, cam };
}
/** 出力: canvas を 2D にコピー（alpha 保持）して返す */
export function grab(ctx, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(ctx.renderer.domElement, 0, 0, w, h);
  return c;
}
export function lights(THREE, scene, { key = 2.2, pink = 1.6, cyan = 1.4 } = {}) {
  const k = new THREE.DirectionalLight(0xfff3e6, key); k.position.set(-4, 7, 8); scene.add(k);
  const p = new THREE.PointLight(0xff2d8a, pink * 60, 30, 2); p.position.set(5, -1, 5); scene.add(p);
  const c = new THREE.PointLight(0x00f5d4, cyan * 60, 30, 2); c.position.set(-5, 2, 4); scene.add(c);
}
export const chrome = (THREE, o = {}) => new THREE.MeshPhysicalMaterial({ color: 0xf4f4fa, metalness: 1, roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.05, envMapIntensity: 1.3, ...o });
