// Music, beholder voice lines and sound effects.
// Real files in /assets/voice and /assets/sfx are used when present (see /api/audio);
// anything missing is synthesized so the game always has sound.
export const VOICE_LINES = {
  intro: 'So... more little adventurers have crawled into my lair. You will answer my questions... or you will DIE!',
  answer_or_die: 'Answer... or DIE!',
  laugh_1: 'Mwahahahaha!',
  laugh_2: 'Delicious.',
  kill_1: 'Wrong. How sad.',
  kill_2: 'Another soul for my collection.',
  kill_3: 'Your English... was not enough.',
  angry_1: 'What?! You... survived?',
  angry_2: 'Impossible! Again!',
  angry_3: 'Lucky... but luck always runs out.',
  next_1: 'Next question!',
  next_2: 'Let us see... how much you really know.',
  harder: 'The questions grow harder... and so does your fate.',
  last_one: 'Only one remains... Interesting. Let us see how long you last.',
  you_died: 'All of you... dead. Come back... if you dare.',
};

let ctx, master, musicGain, sfxGain, voiceGain;
const files = { voice: new Set(), sfx: new Set() };
const buffers = new Map();
const music = {};
let duck = 0, duckTarget = 0, musicBase = 0, current = null;

export async function init() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.85; sfxGain.connect(master);
  voiceGain = ctx.createGain(); voiceGain.gain.value = 1.0; voiceGain.connect(master);
  try { const r = await fetch('/api/audio').then(r => r.json()); r.voice.forEach(f => files.voice.add(f.replace(/\.\w+$/, ''))); r.sfx.forEach(f => files.sfx.add(f.replace(/\.\w+$/, ''))); } catch { }
  for (const name of ['lobby', 'battle']) {
    const el = new Audio(`/assets/music/${name}.mp3`); el.loop = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
    const src = ctx.createMediaElementSource(el); const g = ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(musicGain);
    music[name] = { el, g };
  }
  musicGain.gain.value = 1;
  // preload the effects that exist as files
  for (const f of files.sfx) load('sfx', f);
  for (const f of files.voice) load('voice', f);
  requestAnimationFrame(tickDuck);
}
export function resume() { if (ctx && ctx.state !== 'running') ctx.resume(); }
export const context = () => ctx;
export const voiceOut = () => voiceGain;

async function load(kind, name) {
  const key = kind + '/' + name;
  if (buffers.has(key)) return buffers.get(key);
  const p = fetch(`/assets/${kind}/${name}.mp3`).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b)).catch(() => null);
  buffers.set(key, p); return p;
}
export const hasVoice = name => files.voice.has(name);

// ---------- music with ducking (the beholder is always louder than the music) ----------
export function playMusic(name, vol = 0.32, fade = 1.5) {
  musicBase = vol;
  for (const [k, m] of Object.entries(music)) {
    const t = ctx.currentTime;
    m.g.gain.cancelScheduledValues(t); m.g.gain.setValueAtTime(m.g.gain.value, t);
    if (k === name) { if (m.el.paused) { m.el.currentTime = k === 'battle' ? 0 : m.el.currentTime; m.el.play().catch(() => { }); } m.g.gain.linearRampToValueAtTime(1, t + fade); }
    else { m.g.gain.linearRampToValueAtTime(0, t + fade); const el = m.el; setTimeout(() => { if (m.g.gain.value < .02) el.pause(); }, fade * 1000 + 100); }
  }
  current = name;
}
export function stopMusic(fade = 1.2) { musicBase = 0; playMusic('__none__', 0, fade); }
export function setDuck(on) { duckTarget = on ? 1 : 0; }
let speaking = 0;
function tickDuck() {
  duck += (Math.max(duckTarget, speaking > 0 ? 1 : 0) - duck) * 0.08;
  if (musicGain) musicGain.gain.value = musicBase * (1 - 0.72 * duck);
  requestAnimationFrame(tickDuck);
}

// ---------- beholder voice ----------
// Plays a voice line file through an <audio> element (so the beholder's jaw can follow it).
// Returns { el, duration } or null when the file does not exist (caller then uses grunts).
export async function voiceLine(name, onEl) {
  if (!files.voice.has(name)) return null;
  const el = new Audio(`/assets/voice/${name}.mp3`); el.crossOrigin = 'anonymous';
  speaking++;
  const done = () => { speaking = Math.max(0, speaking - 1); };
  el.addEventListener('ended', done, { once: true }); el.addEventListener('error', done, { once: true });
  await new Promise(r => { el.addEventListener('loadedmetadata', r, { once: true }); el.addEventListener('error', r, { once: true }); el.load(); setTimeout(r, 1500); });
  onEl && onEl(el);
  return { el, duration: isFinite(el.duration) ? el.duration : 3 };
}
export function speakingStart() { speaking++; }
export function speakingEnd() { speaking = Math.max(0, speaking - 1); }

// RPG-style "voice": short growled syllables for text the beholder reads without a recording.
export function grunt(ch) {
  if (!ctx || !/[aeiouy]/i.test(ch)) return;
  const t = ctx.currentTime, f0 = 62 + Math.random() * 26;
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.15, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.12);
  o2.type = 'square'; o2.frequency.value = f0 / 2;
  const formant = { a: 750, e: 520, i: 330, o: 480, u: 360, y: 400 }[ch.toLowerCase()] || 500;
  f.type = 'bandpass'; f.frequency.value = formant; f.Q.value = 4;
  f2.type = 'lowpass'; f2.frequency.value = 1400;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  o.connect(f); o2.connect(f); f.connect(f2); f2.connect(g); g.connect(voiceGain);
  o.start(t); o2.start(t); o.stop(t + 0.18); o2.stop(t + 0.18);
}

// ---------- sound effects ----------
const variants = (base) => [...files.sfx].filter(f => f === base || f.startsWith(base + '_'));
export async function sfx(name, { vol = 1, rate = 1, delay = 0 } = {}) {
  if (!ctx) return;
  const list = variants(name);
  if (list.length) {
    const buf = await load('sfx', list[Math.random() * list.length | 0]);
    if (buf) {
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.playbackRate.value = rate * (0.94 + Math.random() * 0.12); g.gain.value = vol;
      s.connect(g); g.connect(sfxGain); s.start(ctx.currentTime + delay); return;
    }
  }
  synth(name, vol, delay);
}

function noiseBuffer(sec) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let _noise; const noise = () => _noise || (_noise = noiseBuffer(2.5));
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function nsrc(t, dur, filterType, freq, q = 1) {
  const s = ctx.createBufferSource(); s.buffer = noise(); s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  s.connect(f); s.start(t); s.stop(t + dur); return { s, f };
}
function synth(name, vol, delay) {
  const t = ctx.currentTime + delay, out = ctx.createGain(); out.gain.value = vol; out.connect(sfxGain);
  const osc = (type, f, dur) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(t); o.stop(t + dur); return o; };
  switch (name) {
    case 'tick': { const o = osc('sine', 70, .5), g = ctx.createGain(); o.frequency.exponentialRampToValueAtTime(40, t + .3); env(g, t, .005, .9, .35); o.connect(g); g.connect(out); break; }
    case 'beam': { const { f } = nsrc(t, 1.2, 'bandpass', 2400, 2), g = ctx.createGain(); f.frequency.exponentialRampToValueAtTime(600, t + 1.1); env(g, t, .02, .6, 1.1); f.connect(g); g.connect(out);
      const o = osc('sawtooth', 420, 1.2), g2 = ctx.createGain(); o.frequency.exponentialRampToValueAtTime(90, t + 1.1); env(g2, t, .01, .18, 1.1); o.connect(g2); g2.connect(out); break; }
    case 'charge': { const o = osc('sawtooth', 60, 1.6), g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(3000, t + 1.4);
      o.frequency.exponentialRampToValueAtTime(240, t + 1.5); env(g, t, 1.2, .25, .3); o.connect(f); f.connect(g); g.connect(out); break; }
    case 'splat': { const { f } = nsrc(t, .5, 'lowpass', 900), g = ctx.createGain(); env(g, t, .005, 1, .35); f.connect(g); g.connect(out);
      const o = osc('sine', 120, .3), g2 = ctx.createGain(); o.frequency.exponentialRampToValueAtTime(40, t + .25); env(g2, t, .005, .8, .25); o.connect(g2); g2.connect(out); break; }
    case 'scream_m': case 'scream_f': {
      const base = name === 'scream_f' ? 520 : 260, o = osc('sawtooth', base, 1.3), g = ctx.createGain(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
      o.frequency.setValueAtTime(base * 1.3, t); o.frequency.linearRampToValueAtTime(base * 1.7, t + .25); o.frequency.exponentialRampToValueAtTime(base * .6, t + 1.2);
      const lfo = osc('sine', 7, 1.3), lg = ctx.createGain(); lg.gain.value = base * .06; lfo.connect(lg); lg.connect(o.frequency);
      f1.type = 'bandpass'; f1.frequency.value = 900; f1.Q.value = 3; f2.type = 'bandpass'; f2.frequency.value = 2400; f2.Q.value = 5;
      env(g, t, .04, .5, 1.1); o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(out);
      const { f } = nsrc(t, 1.2, 'highpass', 3000), gn = ctx.createGain(); env(gn, t, .04, .08, 1); f.connect(gn); gn.connect(out); break; }
    case 'rumble': { const { f } = nsrc(t, 5, 'lowpass', 120, .7), g = ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(1.2, t + 1.5); g.gain.exponentialRampToValueAtTime(.0001, t + 5); f.connect(g); g.connect(out);
      const o = osc('sine', 38, 5), g2 = ctx.createGain(); g2.gain.setValueAtTime(.0001, t); g2.gain.exponentialRampToValueAtTime(.5, t + 2); g2.gain.exponentialRampToValueAtTime(.0001, t + 5); o.connect(g2); g2.connect(out); break; }
    case 'torch': { const { f } = nsrc(t, 1.4, 'bandpass', 700, .6), g = ctx.createGain(); f.frequency.exponentialRampToValueAtTime(2500, t + .3); env(g, t, .05, .7, 1.2); f.connect(g); g.connect(out); break; }
    case 'gong': { for (const [fr, a] of [[55, 1], [110, .5], [164, .3], [233, .2]]) { const o = osc('sine', fr, 5), g = ctx.createGain(); env(g, t, .01, .5 * a, 4.5); o.connect(g); g.connect(out); }
      const { f } = nsrc(t, .4, 'lowpass', 400), g = ctx.createGain(); env(g, t, .005, .6, .35); f.connect(g); g.connect(out); break; }
    case 'ghost': { const o = osc('sine', 600, 2), g = ctx.createGain(); o.frequency.setValueAtTime(400, t); o.frequency.linearRampToValueAtTime(900, t + 1); o.frequency.linearRampToValueAtTime(500, t + 2);
      const lfo = osc('sine', 5, 2), lg = ctx.createGain(); lg.gain.value = 30; lfo.connect(lg); lg.connect(o.frequency); env(g, t, .4, .12, 1.5); o.connect(g); g.connect(out); break; }
    case 'circles': { [523, 659, 784, 1046].forEach((fr, i) => { const o = osc('triangle', fr, 1.5), g = ctx.createGain(); env(g, t + i * .06, .01, .12, 1.2); o.connect(g); g.connect(out); });
      const o = osc('sine', 65, 1.5), g = ctx.createGain(); env(g, t, .05, .3, 1.3); o.connect(g); g.connect(out); break; }
    case 'burn': { const { f } = nsrc(t, 1.6, 'bandpass', 1500, .5), g = ctx.createGain(); env(g, t, .03, .8, 1.5); f.connect(g); g.connect(out); break; }
    case 'petrify': { for (let i = 0; i < 6; i++) { const { f } = nsrc(t + i * .12, .2, 'bandpass', 600 + Math.random() * 1600, 2), g = ctx.createGain(); env(g, t + i * .12, .003, .7, .15); f.connect(g); g.connect(out); } break; }
    case 'roar': { const o = osc('sawtooth', 70, 2.2), g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(45, t + 2);
      const { f: nf } = nsrc(t, 2.2, 'lowpass', 500), gn = ctx.createGain(); env(gn, t, .1, .5, 2); nf.connect(gn); gn.connect(out); env(g, t, .1, .5, 2); o.connect(f); f.connect(g); g.connect(out); break; }
    case 'stamp': { const o = osc('sine', 90, .4), g = ctx.createGain(); o.frequency.exponentialRampToValueAtTime(35, t + .3); env(g, t, .003, 1, .35); o.connect(g); g.connect(out);
      const { f } = nsrc(t, .3, 'lowpass', 1200), gn = ctx.createGain(); env(gn, t, .003, .5, .25); f.connect(gn); gn.connect(out); break; }
    default: break;
  }
}
