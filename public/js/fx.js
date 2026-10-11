// Gore and magic particles: blood sprays, flying chunks, ash, embers, dust.
import * as THREE from 'three';
import { scene, bloodPool } from './scene.js';

const dot = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
})();

// ---------- point particle bursts ----------
const bursts = [];
function burst({ pos, n = 60, color = 0x8a0008, speed = 4, up = 3, size = .09, life = 1.4, gravity = 9.8, additive = false, drag = .6, floorStick = false, spread = 1, dir = null }) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) {
    p.set([pos.x, pos.y, pos.z], i * 3);
    const a = Math.random() * Math.PI * 2, s = speed * (.3 + Math.random() * .7);
    const vv = new THREE.Vector3(Math.cos(a) * s * spread, up * (.4 + Math.random()), Math.sin(a) * s * spread);
    if (dir) vv.addScaledVector(dir, speed * .8 * Math.random());
    v.push(vv);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: dot, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }));
  m.frustumCulled = false; scene.add(m);
  bursts.push({ m, v, life, t: 0, gravity, drag, floorStick, landed: new Uint8Array(n) });
}
export function bloodSpray(pos, { amount = 1, dir = null } = {}) {
  burst({ pos, n: Math.round(90 * amount), color: 0x7a0006, speed: 4.5 * amount, up: 3.2, size: .11, life: 1.8, floorStick: true, dir });
  burst({ pos, n: Math.round(40 * amount), color: 0xb0000c, speed: 2.2, up: 4.5, size: .2, life: 1.2, dir });
}
export function ashRise(pos) {
  burst({ pos, n: 70, color: 0x2a2a2a, speed: .8, up: 1.6, size: .12, life: 2.6, gravity: -0.6, drag: .3 });
  burst({ pos, n: 50, color: 0xff6a1a, speed: 1.2, up: 2.2, size: .07, life: 1.6, gravity: -1.2, additive: true, drag: .2 });
}
export function sparks(pos, color = 0xffd36b) { burst({ pos, n: 36, color, speed: 5, up: 3, size: .07, life: .7, additive: true }); }
export function ghostWisps(pos) { burst({ pos, n: 40, color: 0x9fb6ff, speed: .6, up: 1.4, size: .14, life: 1.8, gravity: -0.8, additive: true, drag: .2 }); }
export function dust(pos, n = 40) { burst({ pos, n, color: 0x6b5f55, speed: 2.5, up: .8, size: .3, life: 1.6, gravity: .5, drag: 1.2 }); }

// ---------- flying chunks (gibs, stone shards) ----------
const chunks = [];
const chunkGeos = [new THREE.BoxGeometry(.18, .14, .16), new THREE.DodecahedronGeometry(.11, 0), new THREE.BoxGeometry(.26, .1, .12), new THREE.TetrahedronGeometry(.14, 0)];
export function chunkBurst(pos, { n = 14, colors = [0x7a0a0a, 0xc98f6b, 0x5a0505], stone = false, power = 1 } = {}) {
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: stone ? 1 : .35, metalness: 0 });
    const m = new THREE.Mesh(chunkGeos[i % chunkGeos.length], mat);
    m.position.copy(pos).add(new THREE.Vector3((Math.random() - .5) * .4, Math.random() * .6, (Math.random() - .5) * .4));
    const s = (stone ? 1.2 : 1) * (.6 + Math.random() * .9); m.scale.setScalar(s);
    scene.add(m);
    const a = Math.random() * 6.28, sp = (2 + Math.random() * 4) * power;
    chunks.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, 2.5 + Math.random() * 4 * power, Math.sin(a) * sp), w: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10), bleed: !stone && Math.random() < .5, t: 0 });
  }
}
export function clearFx() {
  for (const c of chunks) { scene.remove(c.m); c.m.material.dispose(); } chunks.length = 0;
  for (const b of bursts) { scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); } bursts.length = 0;
}

export function update(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]; b.t += dt; const p = b.m.geometry.attributes.position;
    for (let k = 0; k < b.v.length; k++) {
      if (b.landed[k]) continue;
      const v = b.v[k]; v.y -= b.gravity * dt; v.multiplyScalar(Math.exp(-b.drag * dt));
      let y = p.getY(k) + v.y * dt;
      if (y < 0.02 && b.gravity > 0) { y = 0.02; b.landed[k] = 1; if (b.floorStick && Math.random() < .12) bloodPool(p.getX(k), p.getZ(k), .15 + Math.random() * .25, .2); }
      p.setXYZ(k, p.getX(k) + v.x * dt, y, p.getZ(k) + v.z * dt);
    }
    p.needsUpdate = true;
    b.m.material.opacity = Math.max(0, 1 - Math.max(0, b.t - b.life * .6) / (b.life * .4));
    if (b.t > b.life) { scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); bursts.splice(i, 1); }
  }
  for (const c of chunks) {
    if (c.rest) continue;
    c.t += dt; c.v.y -= 11 * dt; c.m.position.addScaledVector(c.v, dt);
    c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
    if (c.m.position.y < .06) {
      c.m.position.y = .06;
      if (c.bleed && c.v.y < -2) bloodPool(c.m.position.x, c.m.position.z, .35 + Math.random() * .3, .3);
      c.v.y *= -.32; c.v.x *= .6; c.v.z *= .6; c.w.multiplyScalar(.6);
      if (Math.abs(c.v.y) < .4 && c.v.lengthSq() < .3) c.rest = true;
    }
  }
}
