// Renderer, camera, the ruined arena, torches, answer circles and blood decals.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__capture });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('stage').appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030203);
scene.fog = new THREE.Fog(0x030203, 14, 34);

export const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
export const cam = { pos: new THREE.Vector3(0, 8.5, 15.5), look: new THREE.Vector3(0, 2.2, -1), shake: 0, fovBase: 42 };
camera.position.copy(cam.pos);
// screens narrower than 16:9 (4:3 projectors, 16:10 laptops) widen the vertical FOV so the
// arena keeps the same horizontal framing: no circle or hero is cut off at the sides
function fitView() {
  const aspect = innerWidth / innerHeight, ref = 16 / 9;
  camera.aspect = aspect;
  camera.fov = aspect >= ref ? cam.fovBase : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fovBase / 2)) * ref / aspect));
  camera.updateProjectionMatrix();
}
fitView();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); fitView(); });

// light rig: almost nothing until the torches ignite
export const ambient = new THREE.HemisphereLight(0x6a5a78, 0x120808, 0.0);
scene.add(ambient);
export const moon = new THREE.DirectionalLight(0x8090c0, 0.0); moon.position.set(-4, 10, 8); scene.add(moon);

// ---------- arena ----------
const loader = new GLTFLoader();
const pieces = {};
export async function loadArena() {
  const g = await loader.loadAsync('/assets/arena/ruins.glb');
  const root = g.scene.children[0];
  for (const n of [...root.children]) { pieces[n.name] = n; }
  g.scene.traverse(o => { if (o.isMesh) { const m = o.material; m.roughness = Math.max(.85, m.roughness ?? 1); m.metalness = 0; m.color.multiplyScalar(.62); const hsl = {}; m.color.getHSL(hsl); m.color.setHSL(hsl.h, hsl.s * .55, hsl.l); } });
  build();
}
function place(name, x, z, { rotY = 0, s = 1, y = 0 } = {}) {
  const src = pieces[name]; if (!src) return null;
  const wrap = new THREE.Group(); const o = src.clone(true);
  wrap.add(o); wrap.position.set(x, y, z); wrap.rotation.y = rotY; wrap.scale.setScalar(s);
  scene.add(wrap); return wrap;
}
export const torches = [];
function build() {
  // stone floor: 2 m tiles, a little irregular toward the edges
  for (let ix = -6; ix <= 6; ix++) for (let iz = -6; iz <= 4; iz++) {
    const x = ix * 2, z = iz * 2, edge = Math.max(Math.abs(ix) / 6, Math.abs(iz + 1) / 5);
    if (edge > .85 && Math.random() < .35) continue;
    const kind = Math.random() < .25 ? 'Floor_Squares' : 'Floor_Standard';
    place(kind, x, z, { rotY: (Math.random() * 4 | 0) * Math.PI / 2, y: -0.02 });
  }
  // back colonnade where the beholder lives
  for (const [x, z, r] of [[-9, -8, 0.15], [-4.5, -10, 0.05], [4.5, -10, -0.05], [9, -8, -0.15]]) place('Arch_Gothic_RoundColumn', x, z, { rotY: r, s: 1.6 });
  for (const [x, z] of [[-12, -4], [12, -4], [-12.5, 1], [12.5, 1]]) place('Column_Round', x, z, { s: 1.4, rotY: Math.random() * 6 });
  place('Wall_Broken', -11, -6, { rotY: .6, s: 1.5 }); place('Wall_Broken', 11, -6, { rotY: -.6, s: 1.5 });
  place('Wall_Double_Broken', -13, 4, { rotY: 1.4, s: 1.4 }); place('Wall_Double_Broken', 13, 4, { rotY: -1.4, s: 1.4 });
  place('DeadTree_3', -15, -2, { s: 1.6, rotY: 1 }); place('DeadTree_2', 14.5, -1, { s: 1.8, rotY: 2 }); place('DeadTree_1', -14, 6, { s: 1.6 });
  place('Statue_Stag', 0, -15, { s: 1.4 });
  // clutter along the edges: skulls, candles, broken pots, bricks
  const clutter = [['Skull', -7.5, 5.5], ['Skull', 8.2, 4.8], ['Skull', -9.5, -1.5], ['Skull', 7.2, -3.2], ['Candles_1', -8.5, 3], ['Candles_2', 9, 1.5], ['Candles_1', -6.5, -4.5], ['Candles_2', 6.4, -4.8],
    ['Pot1_Broken', -10, 2.5], ['Pot3_Broken', 10.5, -2], ['Pot2', -9.6, -3.8], ['Bricks', 9.5, 5.5], ['Bricks', -10.5, -5], ['Brick', -7, 6.4], ['Brick', 7.6, 6.2], ['Chest_Base', 10.8, 3.2], ['Barrel', -11.2, 0.4], ['Crate', 11.6, -0.4]];
  for (const [n, x, z] of clutter) place(n, x, z, { rotY: Math.random() * 6.28 });
  // two torches at the back (lit during the intro)
  for (const x of [-6.2, 6.2]) {
    const z = -4.4;
    place('Column_Round_Short', x, z, { s: 1.15 });
    const t = place('Torch', x, z + .05, { y: 2.05, s: 1.4 });
    const light = new THREE.PointLight(0xff8a3c, 0, 20, 1.7); light.position.set(x, 3.5, z + .35); scene.add(light);
    const fire = makeFire(); fire.position.set(x, 3.35, z + .1); fire.visible = false; scene.add(fire);
    torches.push({ light, fire, lit: false, base: 30 });
  }
  // a cold fill from the sides so the edges of the floor read in the dark
  sideFill = new THREE.PointLight(0x5560a0, 0, 30, 1.6); sideFill.position.set(0, 7, 9); scene.add(sideFill);
}
let sideFill;

// flickering fire made of a few additive sprites
const fireTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 40, 2, 32, 36, 30); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(.3, 'rgba(255,150,40,.8)'); gr.addColorStop(1, 'rgba(255,40,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
})();
function makeFire() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.userData.ph = Math.random() * 6; s.scale.setScalar(.6); g.add(s);
  }
  return g;
}
export function lightTorch(i) { const t = torches[i]; if (!t) return; t.lit = true; t.fire.visible = true; t.light.intensity = t.base * 2.2; }
export function torchesLit(on) { torches.forEach((t, i) => { if (on) lightTorch(i); else { t.lit = false; t.fire.visible = false; t.light.intensity = 0; } }); }

// ---------- answer circles ----------
function circleTexture(letter, color) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.translate(128, 128);
  g.strokeStyle = color; g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 16; g.lineWidth = 7;
  g.beginPath(); g.arc(0, 0, 112, 0, 7); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 94, 0, 7); g.stroke();
  for (let i = 0; i < 12; i++) { g.save(); g.rotate(i / 12 * Math.PI * 2); g.fillRect(-3, -110, 6, 14); g.restore(); }
  g.globalAlpha = .18; g.beginPath(); g.arc(0, 0, 94, 0, 7); g.fill(); g.globalAlpha = 1;
  g.shadowBlur = 20; g.font = '900 120px "Grenze Gotisch", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff6e6';
  g.fillText(letter, 0, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); pillarGeo.translate(0, .5, 0);
export const circles = [];
export function showCircles(list) {
  clearCircles();
  list.forEach((c, i) => {
    const grp = new THREE.Group(); grp.position.set(c.x, 0.04, c.z);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(c.r * 2.3, c.r * 2.3), new THREE.MeshBasicMaterial({ map: circleTexture(c.letter, c.color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    disc.rotation.x = -Math.PI / 2; grp.add(disc);
    const pil = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    pil.scale.set(c.r, 2.2, c.r); grp.add(pil);
    scene.add(grp);
    circles.push({ ...c, grp, disc, pil, born: performance.now() + i * 120, state: 'on' });
  });
}
export function resolveCircles(correct) { circles.forEach((c, i) => { c.state = i === correct ? 'win' : 'lose'; c.t0 = performance.now(); }); }
export function clearCircles() { for (const c of circles) { scene.remove(c.grp); c.disc.material.map.dispose(); c.disc.material.dispose(); c.pil.material.dispose(); } circles.length = 0; }

// ---------- blood on the floor ----------
const bloodTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.translate(128, 128);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * 6.28, d = Math.random() * 80 * (i < 6 ? .3 : 1), r = 10 + Math.random() * (i < 6 ? 60 : 22);
    g.fillStyle = `rgba(${90 + Math.random() * 40 | 0},0,${Math.random() * 8 | 0},${.75 + Math.random() * .25})`;
    g.beginPath(); g.ellipse(Math.cos(a) * d, Math.sin(a) * d, r, r * (.6 + Math.random() * .5), a, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const decals = [];
export function bloodPool(x, z, size = 1.6, grow = 1.2) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: bloodTex, transparent: true, depthWrite: false, roughness: .15, metalness: .1, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6.28; m.position.set(x, 0.03 + decals.length * 0.0004, z); m.scale.setScalar(0.01);
  scene.add(m); decals.push({ m, size, grow, t: 0 });
}
export function clearBlood() { for (const d of decals) { scene.remove(d.m); d.m.material.dispose(); d.m.geometry.dispose(); } decals.length = 0; }

// ---------- per-frame ----------
const _v = new THREE.Vector3();
export function update(dt, t) {
  for (const tr of torches) {
    if (!tr.lit) continue;
    tr.light.intensity += ((tr.base * (0.85 + 0.15 * Math.sin(t * 17 + tr.base) * Math.sin(t * 7.3))) - tr.light.intensity) * Math.min(1, dt * 4);
    tr.fire.children.forEach((s, i) => { const ph = s.userData.ph + t * (6 + i); s.position.set(Math.sin(ph) * .05, .08 + ((t * 1.6 + i / 6) % 1) * .45, Math.cos(ph) * .05); const k = 1 - ((t * 1.6 + i / 6) % 1); s.scale.setScalar(.25 + .45 * k); s.material.opacity = k; });
  }
  if (sideFill) sideFill.intensity += ((torches.some(t => t.lit) ? 3.2 : 0) - sideFill.intensity) * Math.min(1, dt * 1.5);
  const now = performance.now();
  for (const c of circles) {
    const age = (now - c.born) / 1000; if (age < 0) continue;
    let a = Math.min(1, age * 2.5), pil = .22, li = 6;
    if (c.state === 'win') { const k = (now - c.t0) / 1000; a = 1; pil = .5 + .3 * Math.sin(k * 12); li = 14; c.disc.scale.setScalar(1 + .08 * Math.sin(k * 10)); }
    if (c.state === 'lose') { const k = Math.min(1, (now - c.t0) / 600); a = 1 - k * .85; pil = .22 * (1 - k); li = 6 * (1 - k); }
    c.disc.material.opacity = a; c.disc.rotation.z += dt * (c.state === 'win' ? 1.6 : .35);
    c.pil.material.opacity = pil * a * (.8 + .2 * Math.sin(t * 4 + c.x));
  }
  for (const d of decals) { if (d.t < 1) { d.t = Math.min(1, d.t + dt / d.grow); const s = d.size * (1 - Math.pow(1 - d.t, 3)); d.m.scale.set(s, s, s); } }
  // camera with shake
  cam.shake = Math.max(0, cam.shake - dt * 1.4);
  const s = cam.shake * cam.shake;
  camera.position.copy(cam.pos).add(_v.set((Math.random() - .5) * s, (Math.random() - .5) * s, 0));
  camera.lookAt(cam.look);
}
export function shake(a) { cam.shake = Math.max(cam.shake, a); }
