// The students' heroes (KayKit adventurers): animation, recolors, nameplates, speech bubbles,
// deaths and the ghosts that rise from the bodies.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { scene, camera, bloodPool } from './scene.js';
import * as FX from './fx.js';
import { TINTS, CHARS } from '/shared/tints.js';

const loader = new GLTFLoader();
const models = {}, weapons = {}; let clips = [];
const LOADOUT = { Knight: { r: 'sword_A', l: 'shield_A' }, Barbarian: { r: 'axe_B' }, Mage: { r: 'staff_A' }, Ranger: { l: 'bow_A_withString' }, Rogue: { r: 'dagger_A', l: 'dagger_B' }, Rogue_Hooded: { r: 'dagger_B', l: 'dagger_A' } };
export const VOICE = { Knight: 'm', Barbarian: 'm', Mage: 'f', Ranger: 'm', Rogue: 'f', Rogue_Hooded: 'm' };

export async function loadHeroes(onProgress) {
  const jobs = [
    ...CHARS.map(c => loader.loadAsync(`/assets/chars/${c}.glb`).then(g => models[c] = g)),
    ...['General', 'MovementBasic', 'Simulation'].map(a => loader.loadAsync(`/assets/anims/Rig_Medium_${a}.glb`).then(g => clips.push(...g.animations))),
    ...[...new Set(Object.values(LOADOUT).flatMap(o => Object.values(o)))].map(w => loader.loadAsync(`/assets/weapons/${w}.glb`).then(g => weapons[w] = g.scene)),
  ];
  let done = 0; jobs.forEach(j => j.then(() => onProgress && onProgress(++done / jobs.length)));
  await Promise.all(jobs);
}
const clip = name => clips.find(c => c.name === name);

// ghost look: cold fresnel glow, see-through
function ghostMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uA: { value: 0 } },
    vertexShader: `#include <common>
#include <skinning_pars_vertex>
varying vec3 vN; varying vec3 vV; varying float vY;
void main(){
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed,1.);
  vN = normalize(normalMatrix * objectNormal); vV = normalize(-mv.xyz); vY = transformed.y;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform float uT, uA; varying vec3 vN; varying vec3 vV; varying float vY;
void main(){
  float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float scan = .75 + .25*sin(vY*40. - uT*4.);
  vec3 c = mix(vec3(.25,.35,.75), vec3(.75,.88,1.), f);
  gl_FragColor = vec4(c * (f*1.4 + .18) * scan * uA, 1.);
}`,
  });
}

export class Hero {
  constructor(p, labels) {
    this.id = p.id; this.name = p.name; this.char = p.char; this.tint = p.tint || 0;
    this.root = new THREE.Group(); scene.add(this.root);
    this.alive = true; this.ghost = null; this.dead = false;
    this.pos = new THREE.Vector3(); this.target = new THREE.Vector3(); this.dir = Math.PI; this.dirT = Math.PI; this.moving = false;
    this.build();
    // nameplate + speech bubble live in the DOM (crisp at any resolution)
    this.tag = document.createElement('div'); this.tag.className = 'tag';
    labels.appendChild(this.tag);
    this.bub = document.createElement('div'); this.bub.className = 'bubble'; labels.appendChild(this.bub);
    this.setInfo(p);
  }
  build() {
    if (this.model) { this.root.remove(this.model); }
    const src = models[this.char] || models.Knight;
    const m = SkeletonUtils.clone(src.scene);
    const tint = TINTS[this.tint];
    m.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.material = o.material.clone();
      if (tint) { o.material.color = new THREE.Color(0xffffff).lerp(new THREE.Color(tint), .55); }
      o.userData.baseColor = o.material.color.clone();
    });
    // KayKit models are ~2.4 m tall: scale them to read as small next to the beholder
    m.scale.setScalar(0.78);
    const hands = {}; m.traverse(o => { if (o.isBone && /^handslot\.?[lr]$/.test(o.name)) hands[o.name.slice(-1)] = o; });
    const lo = LOADOUT[this.char] || {};
    for (const side of ['r', 'l']) if (lo[side] && hands[side] && weapons[lo[side]]) { const w = weapons[lo[side]].clone(true); w.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.material = o.material.clone(); } }); hands[side].add(w); }
    m.traverse(o => {
      if (!o.isMesh) return;
      if (!o.userData.baseColor) o.userData.baseColor = o.material.color.clone();
      // a little self-light so every student can always find their hero in the dark
      if (o.material.map) { o.material.emissiveMap = o.material.map; o.material.emissive = new THREE.Color(tint ? tint : 0xffffff).lerp(new THREE.Color(0xffffff), .5); o.material.emissiveIntensity = .22; }
    });
    this.model = m; this.root.add(m);
    this.mixer = new THREE.AnimationMixer(m);
    this.actions = {}; this.cur = null;
    // a soft blob shadow keeps them grounded in the torchlight
    if (!this.blob) {
      this.blob = new THREE.Mesh(new THREE.CircleGeometry(.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .55, depthWrite: false }));
      this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = .025; this.root.add(this.blob);
    }
    this.play('Idle_A');
  }
  setInfo(p) {
    const changed = (p.char && p.char !== this.char) || (p.tint !== undefined && p.tint !== this.tint);
    this.name = p.name; if (p.char) this.char = p.char; if (p.tint !== undefined) this.tint = p.tint;
    if (changed && !this.dead) this.build();
    const col = TINTS[this.tint] || '#e9dcc4';
    this.tag.innerHTML = `<i style="background:${col}"></i>${escapeHtml(this.name)}`;
    this.tag.classList.toggle('off', p.online === false);
  }
  action(name) {
    if (this.actions[name] !== undefined) return this.actions[name];
    const c = clip(name); return (this.actions[name] = c ? this.mixer.clipAction(c) : null);
  }
  play(name, { once = false, fade = .2, speed = 1 } = {}) {
    const a = this.action(name); if (!a || this.cur === a) return a;
    a.reset(); a.setEffectiveTimeScale(speed); a.setEffectiveWeight(1); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
    if (this.cur) this.cur.crossFadeTo(a, fade, false);
    a.play(); this.cur = a; return a;
  }
  place(x, z, dir) { this.pos.set(x, 0, z); this.target.set(x, 0, z); this.root.position.copy(this.pos); if (dir !== undefined) { this.dir = this.dirT = dir; this.root.rotation.y = dir; } }
  setTarget(x, z, dir, moving) {
    const body = this.ghost ? this.ghost.target : this.target;
    body.set(x, 0, z);
    if (this.ghost) { this.ghost.dirT = dir; this.ghost.moving = moving; }
    else if (!this.dead) { this.dirT = dir; this.moving = moving; }
  }
  say(text, ms = 2600) {
    clearTimeout(this._bt); this.bub.textContent = text; this.bub.classList.add('on');
    this._bt = setTimeout(() => this.bub.classList.remove('on'), ms);
  }
  cheer() { if (!this.dead) { this.play('Cheering', { fade: .15 }); this._cheer = 2.2; } }

  // ---- deaths ----
  die(kind, hitFrom) {
    if (this.dead) return; this.dead = true; this.alive = false;
    const chest = this.root.position.clone().add(new THREE.Vector3(0, 1.0, 0));
    const away = this.root.position.clone().sub(hitFrom || new THREE.Vector3(0, 0, -8)).setY(0).normalize();
    this.moving = false;
    if (kind === 'gib') {
      FX.bloodSpray(chest, { amount: 1.6, dir: away }); FX.chunkBurst(chest, { n: 18, power: 1.2 });
      bloodPool(this.root.position.x, this.root.position.z, 2.6, 1.4);
      this.model.visible = false; this.blob.visible = false;
    } else if (kind === 'stone') {
      this.setColor(0x8a8580, .0); this.play(Math.random() < .5 ? 'Death_A' : 'Death_B', { once: true, fade: .05 });
      this.freezeAt = .35;
      setTimeout(() => { // shatter
        FX.chunkBurst(chest.clone().setY(.7), { n: 22, stone: true, colors: [0x7d7873, 0x5e5a56, 0x96918b], power: .7 });
        FX.bloodSpray(chest.clone().setY(.6), { amount: .7 }); FX.dust(this.root.position.clone().setY(.5));
        bloodPool(this.root.position.x, this.root.position.z, 1.5, 1);
        this.model.visible = false;
      }, 900);
    } else if (kind === 'burn') {
      this.play(Math.random() < .5 ? 'Death_A' : 'Death_B', { once: true, fade: .1 });
      this.burn = 0; FX.ashRise(chest);
      setTimeout(() => bloodPool(this.root.position.x, this.root.position.z, 1.1, 1.6), 400);
    } else { // classic: blown back, blood everywhere
      this.play(Math.random() < .5 ? 'Death_A' : 'Death_B', { once: true, fade: .08 });
      FX.bloodSpray(chest, { amount: 1.1, dir: away });
      this.knock = away.multiplyScalar(2.2);
      setTimeout(() => bloodPool(this.root.position.x, this.root.position.z, 2.0, 1.8), 350);
    }
  }
  setColor(hex, keep) {
    const c = new THREE.Color(hex);
    this.model.traverse(o => { if (o.isMesh) { o.material.color.copy(o.userData.baseColor || o.material.color).lerp(c, 1 - keep); if (keep === 0) { o.material.map = null; o.material.emissiveMap = null; o.material.emissiveIntensity = 0; } o.material.needsUpdate = true; } });
  }
  rise() { // the ghost leaves the body
    if (this.ghost) return;
    const src = models[this.char] || models.Knight;
    const g = SkeletonUtils.clone(src.scene); const mat = ghostMaterial();
    g.traverse(o => { if (o.isMesh) { o.material = mat; o.frustumCulled = false; } });
    g.scale.setScalar(0.78);
    const holder = new THREE.Group(); holder.add(g); scene.add(holder);
    holder.position.copy(this.root.position);
    const mixer = new THREE.AnimationMixer(g); const idle = clip('Idle_B') || clip('Idle_A'); if (idle) mixer.clipAction(idle).setEffectiveTimeScale(.6).play();
    const walk = clip('Walking_A');
    this.ghost = { holder, model: g, mat, mixer, idle: idle && mixer.clipAction(idle), walk: walk && mixer.clipAction(walk), cur: 'idle', target: holder.position.clone(), dir: this.dir, dirT: this.dir, moving: false, t: 0 };
    FX.ghostWisps(holder.position.clone().setY(1));
    this.tag.classList.add('ghost');
  }

  update(dt, t, labelsRect) {
    this.mixer.update(dt);
    if (this.freezeAt !== undefined && this.cur && this.cur.time >= this.freezeAt) { this.cur.paused = true; this.freezeAt = undefined; }
    if (this.burn !== undefined && this.burn < 1) {
      this.burn = Math.min(1, this.burn + dt * .7);
      this.model.traverse(o => { if (o.isMesh) { o.material.color.copy(o.userData.baseColor).lerp(new THREE.Color(0x0d0a09), this.burn); o.material.emissive = new THREE.Color(0xff4a10); o.material.emissiveMap = null; o.material.emissiveIntensity = Math.max(0, .9 - this.burn) * (1 + Math.sin(t * 30) * .3); o.material.needsUpdate = this.burn < .05; } });
    }
    if (this.knock) { this.root.position.addScaledVector(this.knock, dt); this.knock.multiplyScalar(Math.exp(-6 * dt)); if (this.knock.lengthSq() < .001) this.knock = null; }
    if (!this.dead) {
      // smooth toward the server position
      this.pos.lerp(this.target, 1 - Math.exp(-14 * dt));
      this.root.position.copy(this.pos);
      let d = this.dirT - this.dir; d = Math.atan2(Math.sin(d), Math.cos(d)); this.dir += d * Math.min(1, dt * 12); this.root.rotation.y = this.dir;
      if (this._cheer > 0) this._cheer -= dt;
      else this.play(this.moving ? 'Running_A' : 'Idle_A', { fade: .15, speed: this.moving ? 1.3 : 1 });
    }
    if (this.ghost) {
      const G = this.ghost; G.t += dt; G.mixer.update(dt);
      G.mat.uniforms.uT.value = t; G.mat.uniforms.uA.value = Math.min(1, G.t * .8) * .9;
      const fromBody = Math.max(0, 1 - G.t * .6);
      G.holder.position.lerp(G.target, 1 - Math.exp(-8 * dt));
      G.holder.position.y = .45 + Math.sin(t * 2 + this.pos.x) * .12 + fromBody * -.4;
      let d = G.dirT - G.dir; d = Math.atan2(Math.sin(d), Math.cos(d)); G.dir += d * Math.min(1, dt * 8); G.holder.rotation.y = G.dir;
      const want = G.moving ? 'walk' : 'idle';
      if (want !== G.cur && G.walk && G.idle) { const a = G[want], b = G[G.cur]; a.reset().play(); b.crossFadeTo(a, .3, false); G.cur = want; }
    }
    // labels
    const anchor = this.ghost ? this.ghost.holder.position : this.root.position;
    const v = _v.set(anchor.x, (this.ghost ? anchor.y : 0) + 2.15, anchor.z).project(camera);
    const x = (v.x * .5 + .5) * innerWidth, y = (-v.y * .5 + .5) * innerHeight;
    const vis = v.z < 1 && !(this.dead && !this.ghost);
    this.tag.style.transform = `translate(-50%,-100%) translate(${x}px,${y}px)`; this.tag.style.opacity = vis ? 1 : 0;
    this.bub.style.transform = `translate(-50%,-100%) translate(${x}px,${y - 46}px)`;
  }
  dispose() {
    scene.remove(this.root); this.tag.remove(); this.bub.remove();
    if (this.ghost) scene.remove(this.ghost.holder);
  }
}
const _v = new THREE.Vector3();
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// what the heroes shout (short, everyday English the students can read at a glance)
export const LINES = {
  ask: ['Uh-oh...', 'I know this one!', 'Wait... what?', 'Think, think...', 'Easy!', 'Hmm...', 'Which one?!', 'Help me!', "Don't panic!", 'Read it again!'],
  count: ['Hurry!', 'Here! Here!', 'Follow me!', 'This one!', 'Are you sure?', 'Run!!'],
  doomed: ['Oh no...', 'NOOO!', 'Wait!', 'Mercy!', 'Not like this!', 'I was so close!', 'Mommy!'],
  survive: ['Phew!', 'YES!!', 'Too easy!', 'Still alive!', 'Ha! Missed me!', 'I knew it!', 'Lucky...', 'Next!'],
  mourn: ['RIP', 'Nooo!', 'They were brave...', 'Poor thing...', 'I will avenge you!'],
  ghost: ['Boooo...', "I'll haunt you!", "It's cold here...", 'Avenge me!', 'Why me?', 'Help them!', "I'm still here..."],
  dark: ['Where are we?', 'Who turned off the lights?', 'Hello...?', 'I hear something...', 'Stay close!', 'What was that?!'],
};
export const pick = a => a[Math.random() * a.length | 0];
