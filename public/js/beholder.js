// beholder-animator.js — procedural animation for the rigged beholder (Three.js r150+)
// Usage:
//   const gltf = await new GLTFLoader().loadAsync('beholder_rigged.glb');
//   scene.add(gltf.scene);
//   const boss = new Beholder(gltf.scene, { scene });
//   // in your loop: boss.update(dt)
//   boss.setEmotion('angry'); boss.laugh(); boss.talk('You shall not pass!');
//   boss.fireRays([targetVec3, ...]); boss.eyeBeam(targetVec3); boss.hit(); boss.lookAt(vec3);
import * as THREE from 'three';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _c1 = new THREE.Color();
const ID = new THREE.Quaternion();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- moods ----------
export const MOODS = {
  neutral:   { floatAmp: .05, floatSpd: 1.1, agit: .10, wigSpd: 1.3, spread: 0, curl: 0, droop: 0, forward: 0, pitch: 0, height: 0, back: 0, tremble: 0, lidU: .12, lidL: .08, pupil: .07, round: 0, glow: .15, glowCol: [1, .25, .1], jaw: .02, saccade: 1, gazeDown: 0 },
  angry:     { floatAmp: .03, floatSpd: 1.6, agit: .06, wigSpd: 3.2, spread: 0, curl: 0, droop: 0, forward: .75, pitch: .16, height: .02, back: 0, tremble: .010, lidU: .46, lidL: .18, pupil: .025, round: 0, glow: .95, glowCol: [1, .12, .02], jaw: -.01, saccade: .4, gazeDown: 0, snarl: 1 },
  happy:     { floatAmp: .08, floatSpd: 1.9, agit: .20, wigSpd: 2.6, spread: .35, curl: 0, droop: 0, forward: 0, pitch: -.08, height: .04, back: 0, tremble: 0, lidU: .14, lidL: .52, pupil: .12, round: .2, glow: .35, glowCol: [1, .7, .15], jaw: .10, saccade: 1.4, gazeDown: 0 },
  sad:       { floatAmp: .03, floatSpd: .6, agit: .05, wigSpd: .7, spread: 0, curl: 0, droop: .95, forward: 0, pitch: .26, height: -.12, back: 0, tremble: 0, lidU: .42, lidL: 0, pupil: .18, round: .75, glow: .06, glowCol: [.3, .5, 1], jaw: .03, saccade: .3, gazeDown: .45 },
  surprised: { floatAmp: .04, floatSpd: 1.3, agit: .08, wigSpd: 1.8, spread: .95, curl: 0, droop: 0, forward: 0, pitch: -.12, height: .06, back: .08, tremble: .003, lidU: -.22, lidL: -.12, pupil: .06, round: 1, glow: .18, glowCol: [1, .9, .5], jaw: .30, saccade: .2, gazeDown: 0 },
  fear:      { floatAmp: .02, floatSpd: 2.2, agit: .05, wigSpd: 4.5, spread: 0, curl: .95, droop: 0, forward: 0, pitch: .05, height: -.03, back: .22, tremble: .016, lidU: -.18, lidL: -.08, pupil: .30, round: 1, glow: .10, glowCol: [.7, .8, 1], jaw: .14, saccade: 4, gazeDown: 0 },
};
const MOOD_KEYS = Object.keys(MOODS.neutral).filter(k => k !== 'glowCol');

// ten classic beholder rays, colour-coded
export const RAY_COLORS = [0xff3fa4, 0xffe23f, 0xa64dff, 0x3fe9ff, 0x7dff3f, 0x3f7dff, 0xd9b3ff, 0xc9a66b, 0x29ff7a, 0xff2a2a, 0xff8a1f];

// ---------- shaders ----------
const NOISE_GLSL = /* glsl */`
float bhHash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float bhNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(bhHash(i),bhHash(i+vec2(1,0)),u.x), mix(bhHash(i+vec2(0,1)),bhHash(i+vec2(1,1)),u.x), u.y); }
float bhFbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*bhNoise(p); p*=2.03; a*=.5; } return v; }
`;

function patchBodyMaterial(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float eyeMask;\nvarying float vEyeMask;\nvarying vec3 vRestPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeMask = eyeMask; vRestPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vEyeMask; varying vec3 vRestPos;
uniform vec3 uEyeC, uGaze, uGazeR, uGazeU, uGlowCol; uniform float uPupil, uRound, uGlow, uFlash, uTime, uIrisR, uLidUT, uLidLT;
${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float bhIris = 0.0; float bhPupilM = 0.0; float bhAO = 1.0;
if (vEyeMask > 0.001) {
  vec3 d = normalize(vRestPos - uEyeC);
  float fz = dot(d, uGaze);
  vec2 p = vec2(dot(d, uGazeR), dot(d, uGazeU));
  float r = length(p) * step(0.0, fz);
  float t = r / uIrisR;
  float ang = atan(p.y, p.x);
  // ---- sclera: wet blood-shot flesh, darker toward the socket
  float vein = smoothstep(.60,.64, bhFbm(vRestPos.xy*34.)) * .6 + smoothstep(.69,.72, bhFbm(vRestPos.xy*72.+3.)) * .4;
  float edge = clamp(1. - vEyeMask, 0., 1.);
  vec3 scl = mix(vec3(.40,.17,.16), vec3(.20,.04,.04), smoothstep(.0,.9,edge) + smoothstep(.55,1.3,t)*0.0);
  scl *= .85 + .3*bhFbm(vRestPos.xy*12.);
  scl = mix(scl, vec3(.62,.05,.04), vein*.6*(.4+.6*smoothstep(1.1,2.2,t)));
  // ---- iris: radial fibres, collarette, crypts, dark limbal ring
  float fib = bhFbm(vec2(ang*9.0, t*2.2 + uTime*.04));
  float fib2 = bhNoise(vec2(ang*38.0, t*6.0));
  vec3 iris = mix(vec3(1.,.97,.70), vec3(1.,.62,.16), smoothstep(.06,.34,t));
  iris = mix(iris, vec3(.95,.22,.06), smoothstep(.34,.70,t));
  iris = mix(iris, vec3(.45,.03,.03), smoothstep(.72,.95,t));
  iris *= .66 + .5*fib + .22*(fib2-.5);
  float coll = exp(-pow((t-.36)/.045, 2.)) * (.6 + .4*bhNoise(vec2(ang*14., 1.)));
  iris += vec3(1.,.75,.35) * coll * .35;
  float crypt = smoothstep(.62,.72, bhNoise(vec2(ang*11., t*9.)) ) * smoothstep(.4,.6,t) * (1.-smoothstep(.85,.95,t));
  iris *= 1. - crypt*.35;
  // ---- pupil: slit <-> round, with a hot rim when the eye glows
  float py = p.y / uIrisR;
  float slitW = max(uPupil * pow(max(0., 1. - py*py*1.02), .75), 1e-4);
  float dSlit = abs(p.x) / slitW;
  float dRound = r / max(uPupil*1.6 + .02, 1e-3);
  float dp = mix(max(dSlit, abs(py)*1.02), dRound, uRound);
  float aa = min(fwidth(dp) * 1.2, .35) + .02;
  bhPupilM = 1. - smoothstep(1. - aa, 1. + aa, dp);
  bhPupilM *= mix(1. - smoothstep(.96, 1.04, abs(py)), 1., uRound);
  float prim = smoothstep(2.2, 1.0, dp) * (1. - bhPupilM);
  float irisM = 1. - smoothstep(1. - fwidth(t)*1.5 - .01, 1. + fwidth(t)*1.5, t);
  vec3 eyeCol = mix(scl, iris, irisM);
  eyeCol = mix(eyeCol, eyeCol*.55, prim*.6*irisM);
  eyeCol = mix(eyeCol, vec3(.015,.0,.0), bhPupilM);
  // ---- lid shadows: the sclera darkens just under the lid edges (occlusion)
  float la = atan(d.z, d.y);
  bhAO = mix(.28, 1., smoothstep(uLidUT - .02, uLidUT + .32, la)) * mix(.45, 1., smoothstep(uLidLT + .02, uLidLT - .20, la));
  eyeCol *= bhAO;
  bhIris = irisM * (1. - bhPupilM) * vEyeMask * (.5 + .5*bhAO) + prim * irisM * vEyeMask * .6;
  diffuseColor.rgb = mix(diffuseColor.rgb, eyeCol, vEyeMask);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, vEyeMask);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uGlowCol * uGlow * bhIris * 1.6;
totalEmissiveRadiance += vec3(1.,.92,.85) * uFlash * .55;`);
  };
  mat.customProgramCacheKey = () => 'beholder-body2';
  mat.needsUpdate = true;
}

// Lids reuse the beholder's own skin texture (UVs borrowed from the surrounding brow/cheek),
// so a closed lid looks like the same wrinkled hide instead of a flat shell.
function makeLidMaterial(map, U) {
  const m = new THREE.MeshStandardMaterial({ map, color: 0xd8d0c8, roughness: .8, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float edgeT;\nvarying float vEdgeT;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdgeT = edgeT;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vEdgeT; uniform float uFlash;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float e = vEdgeT; // 0 at the free edge
diffuseColor.rgb = mix(vec3(.50,.16,.14), diffuseColor.rgb, smoothstep(.0,.16,e));
diffuseColor.rgb *= mix(.30, 1., smoothstep(.0,.05,e));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(.25, roughnessFactor, smoothstep(.0,.12,vEdgeT));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.,.92,.85) * uFlash * .55;');
  };
  m.customProgramCacheKey = () => 'beholder-lid2';
  return m;
}

// Spherical lid shell around the eye; the free edge rolls inward to read as a thick fleshy lip.
function lidGeometry(R, phi0, phiL, th0, thL, edgeAtStart) {
  const g = new THREE.SphereGeometry(R, 48, 18, phi0, phiL, th0, thL);
  const pos = g.attributes.position, n = pos.count, edge = new Float32Array(n), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const th = Math.acos(THREE.MathUtils.clamp(v.y / R, -1, 1));
    const e = edgeAtStart ? (th - th0) / thL : (th0 + thL - th) / thL;  // 0 at the free edge, 1 at the far side
    edge[i] = e;
    const roll = Math.exp(-e * 22) * .006;     // pull the lip inward
    v.multiplyScalar((R - roll) / R);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('edgeT', new THREE.BufferAttribute(edge, 1));
  g.computeVertexNormals();
  return g;
}

const BEAM_VS = /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const BEAM_FS = /* glsl */`
varying vec2 vUv; uniform vec3 uCol; uniform float uTime, uAlpha;
${NOISE_GLSL}
void main(){
  float across = abs(vUv.x - .5) * 2.;           // cylinder wraps u around
  float core = pow(1. - across, 3.0);
  float n = bhNoise(vec2(vUv.x*8., vUv.y*14. - uTime*18.));
  float a = (core*1.4 + n*.5*(1.-across)) * uAlpha;
  vec3 c = mix(uCol, vec3(1.), core*core*.8);
  gl_FragColor = vec4(c*a, a);
}`;

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c); return _glowTex;
}

// ---------- main class ----------
export class Beholder {
  constructor(root, opts = {}) {
    this.root = root;
    this.scene = opts.scene || root.parent;
    this.onEvent = opts.onEvent || (() => {});
    this.beamScale = opts.beamScale || 1;
    let holder = null;
    root.traverse(o => { if (o.userData && o.userData.beholderRig) holder = o; if (o.isSkinnedMesh) this.mesh = o; });
    if (!holder || !this.mesh) throw new Error('beholder_rigged.glb expected (rig metadata missing)');
    this.holder = holder;
    const rig = this.rig = holder.userData.beholderRig;
    this.bones = {}; root.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    this.mesh.frustumCulled = false;
    this.bodyC = new THREE.Vector3(...rig.bodyCenter);
    this.eyeC = new THREE.Vector3(...rig.eye.center);
    this.t = 0;

    // --- eye mask attribute ---
    const geo = this.mesh.geometry, pos = geo.attributes.position, E = rig.eyeEllipse;
    const mask = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (z < E.zmin) continue;
      const e = ((x - E.cx) / E.rx) ** 2 + ((y - E.cy) / E.ry) ** 2;
      mask[i] = 1 - smooth(clamp((e - .78) / .22, 0, 1));
    }
    geo.setAttribute('eyeMask', new THREE.BufferAttribute(mask, 1));

    // --- uniforms ---
    this.U = {
      uEyeC: { value: this.eyeC.clone() }, uGaze: { value: new THREE.Vector3(0, 0, 1) },
      uGazeR: { value: new THREE.Vector3(1, 0, 0) }, uGazeU: { value: new THREE.Vector3(0, 1, 0) },
      uPupil: { value: .07 }, uRound: { value: 0 }, uGlow: { value: .15 }, uGlowCol: { value: new THREE.Color(1, .25, .1) },
      uFlash: { value: 0 }, uTime: { value: 0 }, uIrisR: { value: .50 }, uLidUT: { value: .8 }, uLidLT: { value: 2.1 },
    };
    const mat = this.mesh.material = this.mesh.material.clone();
    patchBodyMaterial(mat, this.U);

    // --- eyelids (children of body bone) ---
    const body = this.bones.body;
    const lidR = .306;
    const phi0 = .4, phiL = Math.PI - 2 * phi0;
    this.lidU = new THREE.Group(); this.lidL = new THREE.Group();
    const thU = this.lidThU = .92, thL = this.lidThL = 2.03;
    this.lidOpenU = -.1; this.lidOpenL = .08;
    const lidMat = makeLidMaterial(mat.map, this.U);
    const upper = new THREE.Mesh(lidGeometry(lidR, phi0, phiL, .12, thU - .12, false), lidMat);
    const lower = new THREE.Mesh(lidGeometry(lidR * .995, phi0, phiL, thL, Math.PI - thL, true), lidMat);
    this.lidU.add(upper); this.lidL.add(lower);
    for (const g of [this.lidU, this.lidL]) { g.position.copy(this.eyeC).sub(this.bodyC); body.add(g); }
    this._borrowLidUVs(upper, this.lidOpenU, pos, mask, true);
    this._borrowLidUVs(lower, this.lidOpenL, pos, mask, false);
    this.lid = { u: .1, l: .08, blink: 0 };
    this.nextBlink = 1.5;

    // --- stalks ---
    this.stalks = rig.stalks.map((s, si) => {
      const chain = [0, 1, 2, 3].map(k => this.bones[`stalk${si}_${k}`]);
      const eye = this.bones[`stalk${si}_eye`];
      const all = [...chain, eye];
      const segDir = chain.map((b, k) => all[k + 1].position.clone().normalize());
      const perpU = segDir.map(d => new THREE.Vector3().crossVectors(d, Math.abs(d.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize());
      const perpV = segDir.map((d, k) => new THREE.Vector3().crossVectors(d, perpU[k]).normalize());
      const base = new THREE.Vector3(...s.base), radial = base.clone().sub(this.bodyC).normalize();
      const bendQ = (D, amt) => segDir.map(sd => {
        const ax = new THREE.Vector3().crossVectors(sd, D); const l = ax.length();
        if (l < 1e-4) return new THREE.Quaternion();
        return new THREE.Quaternion().setFromAxisAngle(ax.divideScalar(l), Math.acos(clamp(sd.dot(D), -1, 1)) * amt / 4);
      });
      const curlQ = segDir.map((sd, k) => {
        const ax = new THREE.Vector3().crossVectors(sd, radial.clone().negate()); if (ax.lengthSq() < 1e-6) ax.copy(perpU[k]);
        return new THREE.Quaternion().setFromAxisAngle(ax.normalize(), .55);
      });
      const postures = {
        spread: bendQ(radial, .85), droop: bendQ(new THREE.Vector3(0, -1, 0), .9),
        forward: bendQ(new THREE.Vector3(radial.x * .35, radial.y * .35, 1).normalize(), .9), curl: curlQ,
      };
      const eyeLocal = new THREE.Vector3(...s.eyePos).sub(new THREE.Vector3(...s.tip));
      const eyeDir = new THREE.Vector3(...s.eyeDir).normalize();
      // glow sprite at the eyeball
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: RAY_COLORS[si % RAY_COLORS.length], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      spr.position.copy(eyeLocal).addScaledVector(eyeDir, .035); spr.scale.setScalar(.16); eye.add(spr);
      return { si, chain, eye, all, segDir, perpU, perpV, postures, eyeLocal, eyeDir, spr, len: s.len,
        phase: Math.random() * 6.28, phase2: Math.random() * 6.28, aim: null, aimW: 0, glow: 0,
        color: RAY_COLORS[si % RAY_COLORS.length] };
    });

    // --- state ---
    this.mood = { ...MOODS.neutral, glowCol: new THREE.Color(...MOODS.neutral.glowCol) };
    this.moodTarget = MOODS.neutral; this.moodName = 'neutral';
    this.moodRate = 3;
    this.gaze = new THREE.Vector3(0, 0, 1); this.gazeTarget = new THREE.Vector3(0, 0, 1);
    this.lookTarget = null; this.saccadeOff = new THREE.Vector2(); this.nextSaccade = 1;
    this.jaw = 0; this.jawVel = 0;
    this.actions = [];  // active timed actions
    this.talkState = null;
    this.audioTalk = null;
    this.knock = new THREE.Vector3(); this.knockVel = new THREE.Vector3();
    this.squash = 0; this.squashVel = 0;
    this.beams = [];
    this.restRootPos = this.bones.root.position.clone();
  }

  // ---------------- public API ----------------
  setEmotion(name, rate = 3) { if (!MOODS[name]) return; this.moodTarget = MOODS[name]; this.moodName = name; this.moodRate = rate; }
  lookAt(worldPoint) { this.lookTarget = worldPoint ? worldPoint.clone() : null; }
  blink() { this.lid.blinkT = 0; }

  talk(text, { cps = 14, onChar, onDone, speech = false, voicePitch = .2, voiceRate = .85 } = {}) {
    const keys = []; let t = 0;
    const OPEN = { a: 1, o: .85, e: .65, i: .45, u: .55, y: .4 };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i].toLowerCase(); let o = .22, d = 1 / cps;
      if (OPEN[ch] !== undefined) o = OPEN[ch];
      else if ('mbp'.includes(ch)) o = 0;
      else if (ch === ' ') { o = .05; d *= .8; }
      else if (',;:'.includes(ch)) { o = 0; d = .22; }
      else if ('.!?'.includes(ch)) { o = 0; d = .38; }
      else if (!/[a-záéíóúñ]/.test(ch)) { o = .1; }
      keys.push({ t, o, i, d }); t += d;
    }
    this.talkState = { keys, t: 0, dur: t, onChar, onDone, lastChar: -1, emph: 0, speaking: false };
    if (speech && 'speechSynthesis' in window) {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.pitch = voicePitch; u.rate = voiceRate; u.lang = /[áéíóúñ¿¡]/i.test(text) ? 'es-ES' : 'en-GB';
        const v = speechSynthesis.getVoices().find(v => v.lang.startsWith(u.lang.slice(0, 2)) && /male|daniel|george|jorge|diego|pablo/i.test(v.name));
        if (v) u.voice = v;
        this.talkState.speaking = true;
        u.onend = () => { if (this.talkState) this.talkState.speaking = false; };
        speechSynthesis.speak(u);
      } catch (e) { }
    }
  }
  // Drive the jaw from a real audio element (e.g. an ElevenLabs voice line)
  talkAudio(audioEl, { ctx, out } = {}) {
    ctx = ctx || this._actx || (this._actx = new (window.AudioContext || window.webkitAudioContext)());
    const src = ctx.createMediaElementSource(audioEl); const an = ctx.createAnalyser(); an.fftSize = 512;
    src.connect(an); an.connect(out || ctx.destination);
    this.audioTalk = { an, buf: new Uint8Array(an.fftSize), el: audioEl };
    return audioEl.play().catch(() => { });
  }
  stopTalking() { this.talkState = null; if ('speechSynthesis' in window) speechSynthesis.cancel(); }

  laugh(duration = 2.4) { this._addAction('laugh', duration); this.onEvent({ type: 'laugh' }); }

  hit(dir = new THREE.Vector3(0, 0, -1)) {
    this._addAction('hit', .6);
    this.knockVel.addScaledVector(dir.clone().normalize(), 1.4);
    this.squashVel -= 6;
    this.U.uFlash.value = 1;
    this.lid.blinkT = 0;
    this.onEvent({ type: 'hit' });
  }

  // eye rays from the stalks. targets: array of world Vector3 (cycled across eyes). count = number of eyes to use.
  fireRays(targets, { count = 6, charge = .7, hold = .9, stagger = .09 } = {}) {
    if (!Array.isArray(targets)) targets = [targets];
    const order = [...this.stalks].sort(() => Math.random() - .5).slice(0, Math.min(count, this.stalks.length));
    order.forEach((s, i) => {
      const tgt = targets[i % targets.length].clone();
      s.aim = tgt; s.aimDelay = 0;
      this._addAction('ray', charge + hold + .5 + i * stagger, { s, tgt, charge: charge + i * stagger, hold });
    });
    this._addAction('rayBody', charge + hold + .6, { charge });
    this.onEvent({ type: 'charge' });
  }

  // signature central-eye beam
  eyeBeam(target, { charge = .9, hold = 1.4 } = {}) {
    this.lookTarget = target.clone();
    this._addAction('eyeBeam', charge + hold + .5, { tgt: target.clone(), charge, hold });
    this.onEvent({ type: 'eyeCharge' });
  }

  // ---------------- internals ----------------
  _addAction(type, dur, data = {}) { this.actions.push({ type, t: 0, dur, ...data }); }

  _makeBeam(color, radius) {
    radius *= this.beamScale;
    const geo = new THREE.CylinderGeometry(radius, radius * .6, 1, 12, 1, true); geo.translate(0, .5, 0); geo.rotateX(Math.PI / 2); // along +Z, base at origin
    const mat = new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uCol: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 0 } } });
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5;
    const outer = new THREE.Mesh(geo, mat.clone()); outer.scale.set(2.6, 2.6, 1); outer.material.uniforms.uCol.value = new THREE.Color(color); m.add(outer);
    const imp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    imp.renderOrder = 6;
    this.scene.add(m); this.scene.add(imp);
    return { m, outer, imp, mat };
  }
  _killBeam(b) { this.scene.remove(b.m); this.scene.remove(b.imp); b.m.geometry.dispose(); b.mat.dispose(); b.outer.material.dispose(); b.imp.material.dispose(); }
  _placeBeam(b, from, to, alpha, len01 = 1) {
    const L = from.distanceTo(to) * len01;
    b.m.position.copy(from); b.m.lookAt(to); b.m.scale.set(1, 1, Math.max(L, 1e-3));
    b.mat.uniforms.uAlpha.value = alpha; b.outer.material.uniforms.uAlpha.value = alpha * .35;
    b.mat.uniforms.uTime.value = this.t; b.outer.material.uniforms.uTime.value = this.t;
    b.imp.position.copy(from).lerp(to, len01); b.imp.material.opacity = len01 > .98 ? alpha : 0;
    b.imp.scale.setScalar((.35 + .12 * Math.sin(this.t * 40)) * (b.big ? 2.2 : 1) * this.beamScale);
  }

  // Map the lid onto one continuous patch of the beholder's skin texture: fit an affine map
  // (x, y) -> uv on the skin just above (or below) the eye, rejecting vertices from other UV islands.
  _borrowLidUVs(lid, openRot, pos, mask, upper) {
    const uvB = this.mesh.geometry.attributes.uv, ec = this.eyeC, E = this.rig.eyeEllipse;
    const top = E.cy + E.ry, bot = E.cy - E.ry;
    let pts = [];
    for (let i = 0; i < pos.count; i++) {
      if (mask[i] > .01) continue;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (z < .32 || Math.abs(x - E.cx) > .24) continue;
      if (upper ? (y < top + .03 || y > top + .2) : (y > bot - .02 || y < bot - .13)) continue;
      pts.push([x, y, uvB.getX(i), uvB.getY(i)]);
    }
    const fit = (P) => { // least squares u = a x + b y + c (same for v)
      let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = P.length, su = [0, 0, 0], sv = [0, 0, 0];
      for (const [x, y, u, v] of P) { sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; su[0] += x * u; su[1] += y * u; su[2] += u; sv[0] += x * v; sv[1] += y * v; sv[2] += v; }
      const M = new THREE.Matrix3().set(sxx, sxy, sx, sxy, syy, sy, sx, sy, n).invert();
      return [new THREE.Vector3(...su).applyMatrix3(M), new THREE.Vector3(...sv).applyMatrix3(M)];
    };
    let cu, cv;
    for (let it = 0; it < 6 && pts.length > 12; it++) {
      [cu, cv] = fit(pts);
      const res = pts.map(([x, y, u, v]) => Math.hypot(cu.x * x + cu.y * y + cu.z - u, cv.x * x + cv.y * y + cv.z - v));
      const med = [...res].sort((a, b) => a - b)[res.length >> 1];
      pts = pts.filter((_, k) => res[k] <= Math.max(med * 2.5, 1e-4));
    }
    const lp = lid.geometry.attributes.position, uv = new Float32Array(lp.count * 2);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), openRot), v = new THREE.Vector3();
    for (let j = 0; j < lp.count; j++) {
      v.fromBufferAttribute(lp, j).applyQuaternion(q).add(ec);
      // keep the texture on the patch even for the hidden part of the shell
      const y = v.y;
      uv[j * 2] = cu.x * v.x + cu.y * y + cu.z; uv[j * 2 + 1] = cv.x * v.x + cv.y * y + cv.z;
    }
    lid.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  stalkEyeWorld(s, out = new THREE.Vector3()) { return s.spr.getWorldPosition(out); }

  update(dt) {
    dt = Math.min(dt, .05);
    this.t += dt; const t = this.t; this.U.uTime.value = t;
    // ---- mood blend ----
    const M = this.mood, MT = this.moodTarget, k = this.moodRate;
    for (const key of MOOD_KEYS) M[key] = damp(M[key] ?? 0, MT[key] ?? 0, k, dt);
    M.glowCol.lerp(_c1.setRGB(...MT.glowCol), 1 - Math.exp(-k * dt));

    // ---- action layer accumulators ----
    const L = { jaw: 0, jawOverride: -1, pitch: 0, roll: 0, bob: 0, lidU: 0, lidL: 0, pupil: 0, pupilOverride: -1, glow: 0, agit: 0, spread: 0, curl: 0, forward: 0, tremble: 0, back: 0 };
    const keep = [];
    for (const a of this.actions) {
      a.t += dt; const p = a.t / a.dur; if (p < 1) keep.push(a);
      if (a.type === 'laugh') {
        const env = Math.sin(Math.min(p, 1) * Math.PI) ** .6;
        const ha = .5 + .5 * Math.sin(a.t * 2 * Math.PI * 5.2);
        L.jawOverride = Math.max(L.jawOverride, env * (.10 + .20 * ha));
        L.pitch -= .20 * env; L.bob += .035 * env * Math.abs(Math.sin(a.t * Math.PI * 5.2));
        L.roll += .05 * env * Math.sin(a.t * 7);
        L.lidL += .45 * env; L.lidU += .20 * env; L.pupilOverride = .03; L.agit += .22 * env; L.spread += .35 * env;
      } else if (a.type === 'hit') {
        const e = Math.max(0, 1 - p); L.agit += .35 * e; L.lidU += .6 * e * e; L.lidL += .5 * e * e; L.jaw += .2 * e; L.curl += .6 * e;
      } else if (a.type === 'ray') {
        const s = a.s;
        const cP = clamp(a.t / a.charge, 0, 1);
        const fireT = a.t - a.charge;
        s.aimW = fireT < a.hold ? smooth(cP) : Math.max(0, 1 - (fireT - a.hold) / .5);
        s.glow = Math.max(s.glow, fireT < 0 ? smooth(cP) * .8 : fireT < a.hold ? 1 : Math.max(0, 1 - (fireT - a.hold) / .3));
        if (fireT >= 0 && fireT < a.hold + .3) {
          if (!a.beam) { a.beam = this._makeBeam(s.color, .022); this.onEvent({ type: 'ray', color: s.color, target: a.tgt }); }
          const grow = clamp(fireT / .12, 0, 1), fade = fireT > a.hold ? 1 - (fireT - a.hold) / .3 : 1;
          this._placeBeam(a.beam, this.stalkEyeWorld(s, _v2), a.tgt, fade * (.85 + .15 * Math.sin(t * 50)), grow);
        } else if (a.beam && fireT >= a.hold + .3) { this._killBeam(a.beam); a.beam = null; }
        if (p >= 1) { s.aim = null; s.aimW = 0; if (a.beam) this._killBeam(a.beam); }
      } else if (a.type === 'rayBody') {
        const c = clamp(a.t / a.charge, 0, 1), f = a.t - a.charge;
        const lean = f < 0 ? smooth(c) : Math.max(0, 1 - f * 1.2);
        L.pitch -= .10 * lean; L.lidU += .28 * lean; L.pupilOverride = .02; L.glow += .8 * lean; L.jaw += .12 * lean; L.forward += .3 * lean;
        if (f > 0 && f < .25) { L.back += .25 * (1 - f / .25); L.tremble += .012; }
        if (f >= 0 && !a.fired) { a.fired = true; this.onEvent({ type: 'fire' }); }
      } else if (a.type === 'eyeBeam') {
        const c = clamp(a.t / a.charge, 0, 1), f = a.t - a.charge;
        L.glow += f < 0 ? smooth(c) * 2.2 : f < a.hold ? 2.6 : Math.max(0, 2.6 * (1 - (f - a.hold) / .4));
        L.tremble += f < 0 ? .012 * c : 0; L.lidU -= .15 * (f < a.hold ? 1 : 0); L.pupilOverride = f < 0 ? .07 * (1 - c) + .01 : .012;
        L.jaw += .18 * (f < a.hold ? smooth(c) : 0); L.spread += .5 * smooth(c);
        if (f >= 0 && f < a.hold + .4) {
          if (!a.beam) { a.beam = this._makeBeam(0xffd36b, .09); a.beam.big = true; this.onEvent({ type: 'eyeBeam', target: a.tgt }); }
          const grow = clamp(f / .18, 0, 1), fade = f > a.hold ? 1 - (f - a.hold) / .4 : 1;
          const from = this.bones.body.localToWorld(_v2.copy(this.eyeC).sub(this.bodyC).addScaledVector(this.gaze, this.rig.eye.radius * .95));
          this._placeBeam(a.beam, from, a.tgt, fade, grow);
          L.back += f < .3 ? .2 * (1 - f / .3) : 0;
        } else if (a.beam && f >= a.hold + .4) { this._killBeam(a.beam); a.beam = null; }
        if (p >= 1 && a.beam) this._killBeam(a.beam);
      }
    }
    this.actions = keep;

    // ---- body / float ----
    const root = this.bones.root, body = this.bones.body;
    const amp = M.floatAmp, spd = M.floatSpd;
    // knockback spring
    this.knockVel.addScaledVector(this.knock, -60 * dt).multiplyScalar(Math.exp(-7 * dt)); this.knock.addScaledVector(this.knockVel, dt);
    for (let rem = dt; rem > 1e-6; rem -= 1 / 120) { const h = Math.min(rem, 1 / 120); this.squashVel += (-140 * this.squash) * h; this.squashVel *= Math.exp(-9 * h); this.squash += this.squashVel * h; }
    const tr = M.tremble + L.tremble;
    root.position.set(
      this.restRootPos.x + this.knock.x + (Math.random() - .5) * tr,
      this.restRootPos.y + M.height + Math.sin(t * spd * 2) * amp + L.bob + this.knock.y + (Math.random() - .5) * tr,
      this.restRootPos.z - (M.back + L.back) + this.knock.z);
    // body orientation: mood pitch + gentle sway + turn toward look target
    let yawT = 0, pitchLook = 0;
    if (this.lookTarget) {
      const lp = this.holder.worldToLocal(_v1.copy(this.lookTarget));
      yawT = clamp(Math.atan2(lp.x, lp.z), -.6, .6) * .35; pitchLook = clamp(-Math.atan2(lp.y - this.bodyC.y, Math.hypot(lp.x, lp.z)), -.5, .5) * .25;
    }
    this._yaw = damp(this._yaw || 0, yawT, 3, dt); this._pl = damp(this._pl || 0, pitchLook, 3, dt);
    body.rotation.set(
      M.pitch + L.pitch + this._pl + Math.sin(t * spd * 2 - .8) * amp * .8 + this.knockVel.z * -.1,
      this._yaw + Math.sin(t * .37) * .07,
      L.roll + Math.sin(t * .7) * .035 + this.knockVel.x * .1);
    const breathe = Math.sin(t * 1.6) * .008, sq = this.squash;
    body.scale.set(1 + breathe - sq * .5, 1 + breathe + sq, 1 + breathe - sq * .5);

    // ---- jaw ----
    let jawT = M.jaw + L.jaw;
    if (MT.snarl) jawT += Math.max(0, Math.sin(t * 3.1) * Math.sin(t * 1.7)) * .08;
    if (this.talkState) {
      const ts = this.talkState; ts.t += dt;
      const ks = ts.keys; let i = ks.findIndex(kk => kk.t > ts.t); if (i < 0) i = ks.length; const cur = ks[Math.max(0, i - 1)];
      if (cur && cur.i !== ts.lastChar) { ts.lastChar = cur.i; ts.onChar && ts.onChar(cur.i); if (cur.o > .8) ts.emph = 1; }
      ts.emph *= Math.exp(-6 * dt);
      const o = cur ? cur.o : 0;
      jawT = Math.max(jawT, .02 + o * .24);
      L.pitch -= ts.emph * .05; body.rotation.x += -ts.emph * .05;
      if (ts.t > ts.dur) {
        if (ts.speaking) { ts.t = Math.max(0, ts.dur - .6); } // keep babbling until the TTS voice finishes
        else { const cb = ts.onDone; this.talkState = null; cb && cb(); }
      }
    }
    if (this.audioTalk) {
      const a = this.audioTalk; a.an.getByteTimeDomainData(a.buf);
      let s = 0; for (const v of a.buf) s += ((v - 128) / 128) ** 2; const rms = Math.sqrt(s / a.buf.length);
      jawT = Math.max(jawT, clamp(rms * 3.2, 0, 1) * .3);
      if (a.el.ended) this.audioTalk = null;
    }
    if (L.jawOverride >= 0) jawT = Math.max(jawT * .3, L.jawOverride);
    jawT = clamp(jawT, -.04, .36);
    // critically damped spring (snappy)
    const w = 38; for (let rem = dt; rem > 1e-6; rem -= 1 / 240) { const h = Math.min(rem, 1 / 240); this.jawVel += (w * w * (jawT - this.jaw) - 2 * w * this.jawVel) * h; this.jaw += this.jawVel * h; }
    this.bones.jaw.rotation.x = this.jaw;

    // ---- central eye gaze ----
    this.nextSaccade -= dt * Math.max(M.saccade, .05);
    if (this.nextSaccade <= 0) { this.saccadeOff.set((Math.random() - .5) * .45, (Math.random() - .5) * .25); this.nextSaccade = .6 + Math.random() * 1.6; }
    if (this.lookTarget) {
      const lp = body.worldToLocal(_v1.copy(this.lookTarget)).add(this.bodyC);
      this.gazeTarget.copy(lp.sub(this.eyeC)).normalize();
      this.gazeTarget.x += this.saccadeOff.x * .15; this.gazeTarget.y += this.saccadeOff.y * .15;
    } else this.gazeTarget.set(this.saccadeOff.x, this.saccadeOff.y, 1);
    this.gazeTarget.y -= M.gazeDown;
    this.gazeTarget.normalize();
    // clamp to cone of 0.6 rad around forward
    const fwd = _v3.set(0, -.05, 1).normalize(); const ang = this.gazeTarget.angleTo(fwd);
    if (ang > .6) this.gazeTarget.lerp(fwd, 1 - .6 / ang).normalize();
    this.gaze.lerp(this.gazeTarget, 1 - Math.exp(-18 * dt)).normalize();
    this.U.uGaze.value.copy(this.gaze);
    this.U.uGazeR.value.crossVectors(_v1.set(0, 1, 0), this.gaze).normalize();
    this.U.uGazeU.value.crossVectors(this.gaze, this.U.uGazeR.value).normalize();
    const pupilT = L.pupilOverride >= 0 ? L.pupilOverride : M.pupil + L.pupil;
    this.U.uPupil.value = damp(this.U.uPupil.value, pupilT, 10, dt);
    this.U.uRound.value = damp(this.U.uRound.value, L.pupilOverride >= 0 ? 0 : M.round, 8, dt);
    this.U.uGlow.value = damp(this.U.uGlow.value, M.glow + L.glow, 8, dt) * (1 + .04 * Math.sin(t * 9));
    this.U.uGlowCol.value.copy(M.glowCol);
    this.U.uFlash.value = Math.max(0, this.U.uFlash.value - dt * 4);

    // ---- lids ----
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.lid.blinkT = 0; this.nextBlink = 2 + Math.random() * 4; }
    let bl = 0;
    if (this.lid.blinkT !== undefined) { this.lid.blinkT += dt; const bt = this.lid.blinkT / .16; bl = bt < 1 ? Math.sin(bt * Math.PI) : 0; if (bt >= 1) this.lid.blinkT = undefined; }
    const lu = clamp(M.lidU + L.lidU, -.3, 1), ll = clamp(M.lidL + L.lidL, -.3, 1);
    this.lid.u = damp(this.lid.u, lu, 12, dt); this.lid.l = damp(this.lid.l, ll, 12, dt);
    const cu = Math.max(this.lid.u, bl * 1.05), cl = Math.max(this.lid.l, bl * .2);
    // the eye follows the gaze slightly with the lids (upper lid lowers when looking down)
    const gd = clamp(-this.gaze.y, -.4, .4);
    this.lidU.rotation.x = this.lidOpenU + (cu + gd * .4) * .72;
    this.lidL.rotation.x = this.lidOpenL - cl * .42 + gd * .1;
    this.U.uLidUT.value = this.lidThU + this.lidU.rotation.x;
    this.U.uLidLT.value = this.lidThL + this.lidL.rotation.x;

    // ---- stalks ----
    const ag = M.agit + L.agit, ws = M.wigSpd;
    const pw = { spread: clamp(M.spread + L.spread, 0, 1), curl: clamp(M.curl + L.curl, 0, 1), droop: clamp(M.droop, 0, 1), forward: clamp(M.forward + L.forward, 0, 1) };
    for (const s of this.stalks) {
      for (let kk = 0; kk < 4; kk++) {
        const b = s.chain[kk];
        _q1.identity();
        for (const pn in pw) if (pw[pn] > .001) { _q2.slerpQuaternions(ID, s.postures[pn][kk], pw[pn]); _q1.multiply(_q2); }
        const tipF = .5 + kk * .35;
        const a1 = ag * tipF * Math.sin(t * ws * 2 + s.phase - kk * .9);
        const a2 = ag * tipF * .7 * Math.cos(t * ws * 1.6 + s.phase2 - kk * .9);
        _q2.setFromAxisAngle(s.perpU[kk], a1); _q1.multiply(_q2);
        _q2.setFromAxisAngle(s.perpV[kk], a2); _q1.multiply(_q2);
        b.quaternion.copy(_q1);
      }
      s.eye.quaternion.identity();
      // aim at target
      if (s.aim && s.aimW > .001) {
        s.chain[0].parent.updateWorldMatrix(true, false);
        for (const [bi, f] of [[2, .35], [3, .5], [4, 1]]) {
          const b = s.all[bi];
          b.updateWorldMatrix(false, true);
          const eyeW = this.stalkEyeWorld(s, _v1);
          b.getWorldQuaternion(_q3);
          const curDir = _v2.copy(s.eyeDir).applyQuaternion(this._eyeWorldQuat(s, _q2));
          const want = _v3.copy(s.aim).sub(eyeW).normalize();
          _q1.setFromUnitVectors(curDir, want);
          _q1.slerp(ID, 1 - f * s.aimW);
          // convert world delta into bone local: local' = local * (worldQ^-1 * delta * worldQ)
          const inv = _q2.copy(_q3).invert();
          const dl = _q1.premultiply(inv).multiply(_q3);
          b.quaternion.multiply(dl);
        }
      }
      s.glow = Math.max(0, s.glow - dt * 2.5);
      s.spr.material.opacity = Math.min(1, s.glow * 1.2);
      s.spr.scale.setScalar(.12 + s.glow * .22 + Math.sin(t * 30 + s.phase) * .02 * s.glow);
    }
  }
  _eyeWorldQuat(s, out) { s.eye.updateWorldMatrix(true, false); return s.eye.getWorldQuaternion(out); }

  dispose() { for (const a of this.actions) if (a.beam) this._killBeam(a.beam); this.actions = []; }
}
