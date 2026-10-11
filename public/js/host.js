// Eye of the Beholder — projector screen: lobby, intro cinematic, rounds, executions and the final board.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as S from './scene.js';
import * as FX from './fx.js';
import * as A from './audio.js';
import { Hero, loadHeroes, LINES, pick, VOICE } from './heroes.js';
import { Beholder } from './beholder.js';
import { TINTS } from '/shared/tints.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// ?sim runs on simulated time (fixed 1/30 s per frame) so slow test machines see every animation
const SIM = new URLSearchParams(location.search).has('sim');
let simNow = 0; const simWaits = [];
const wait = ms => SIM ? new Promise(r => simWaits.push({ at: simNow + ms / 1000, r })) : new Promise(r => setTimeout(r, ms));
const labels = $('labels');
const nowMs = () => SIM ? simNow * 1000 : performance.now();

// ---------- loading ----------
let loaded = 0; const prog = (k, v) => { loaded = Math.max(loaded, v); $('loadbar').firstChild.style.width = Math.round(loaded * 100) + '%'; };
const BEHOLDER_SCALE = 7.4;
const BH_HOME = new THREE.Vector3(0, 5.9, -10.5);
let boss, bossRoot, bossLight, eyeGlow;

async function loadBeholder() {
  const g = await new GLTFLoader().loadAsync('/assets/beholder.glb', e => e.total && prog('b', .1 + .5 * e.loaded / e.total));
  bossRoot = new THREE.Group(); bossRoot.add(g.scene); g.scene.scale.setScalar(BEHOLDER_SCALE);
  S.scene.add(bossRoot);
  boss = new Beholder(g.scene, { scene: S.scene, beamScale: BEHOLDER_SCALE * .8, onEvent: onBossEvent });
  // its own sinister lighting: blood-red from below, cold rim from behind
  bossLight = new THREE.PointLight(0xff2a14, 0, 26, 1.3); bossLight.position.set(0, -3.5, 4.5); bossRoot.add(bossLight);
  const rim = new THREE.PointLight(0x6f86ff, 0, 24, 1.4); rim.position.set(0, 5, -6); bossRoot.add(rim); bossRoot.userData.rim = rim;
  // a cold key light from the audience so the monster always reads, even in the dark
  const key = new THREE.SpotLight(0xc8d0ff, 0, 40, .42, .7, 1.1); key.position.set(0, 14, 10); key.target = bossRoot; S.scene.add(key); bossRoot.userData.key = key; lspot = key;
  // a glow that shows the eye before the body is visible in the dark
  const c = document.createElement('canvas'); c.width = c.height = 128; const gx = c.getContext('2d');
  const gr = gx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,190,90,1)'); gr.addColorStop(.25, 'rgba(255,60,20,.55)'); gr.addColorStop(1, 'rgba(255,0,0,0)');
  gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
  eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0 }));
  eyeGlow.scale.setScalar(8); S.scene.add(eyeGlow);
  hideBoss();
}
function hideBoss() { bossRoot.position.set(0, 6, -30); bossRoot.visible = false; bossLight.intensity = 0; bossRoot.userData.rim.intensity = 0; if (eyeGlow) eyeGlow.material.opacity = 0; if (bossRoot.userData.key && state !== 'lobby') bossRoot.userData.key.intensity = 0; }

Promise.all([S.loadArena().then(() => prog('a', .7)), loadHeroes(v => prog('h', .6 + .3 * v)), loadBeholder()]).then(() => {
  prog('', 1); $('open').disabled = false; $('open').textContent = 'Open the lair';
  window.ready = true;
}).catch(e => { console.error(e); $('open').textContent = 'Could not load: ' + e.message; });

$('open').onclick = async () => {
  await A.init(); A.resume();
  $('splash').hidden = true;
  showLobby();
  connect();
};

// ---------- networking ----------
let ws, room = { code: null, key: null }, state = 'boot', backoff = 600;
const heroes = new Map();
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { backoff = 600; send({ t: 'host', code: room.code, key: room.key }); };
  ws.onclose = () => setTimeout(connect, backoff = Math.min(backoff * 1.6, 5000));
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
}
const send = m => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
setInterval(() => send({ t: 'ping' }), 15000);

function onMsg(m) {
  switch (m.t) {
    case 'room': {
      room.code = m.code; room.key = m.key;
      $('code').textContent = m.code;
      const url = `${location.origin}/j/${m.code}`;
      $('url').textContent = url.replace(/^https?:\/\//, '');
      $('qr').innerHTML = `<img alt="QR code to join" src="/qr.svg?text=${encodeURIComponent(url)}">`;
      setLevel(m.level || level);
      if (m.state === 'lobby') { for (const h of heroes.values()) h.dispose(); heroes.clear(); m.players.forEach(addHero); showLobby(); }
      break;
    }
    case 'player_join': addHero(m.p, true); break;
    case 'player_update': { const h = heroes.get(m.p.id); if (h) h.setInfo(m.p); else addHero(m.p); break; }
    case 'player_leave': { const h = heroes.get(m.pid); if (h) { h.dispose(); heroes.delete(m.pid); } lineup(); break; }
    case 'emote': { const h = heroes.get(m.pid); if (h) h.cheer(); break; }
    case 'intro': runFlow(() => intro(m)); break;
    case 'pos': for (const [id, x, z, dir, , moving] of m.p) { const h = heroes.get(id); if (h) h.setTarget(x, z, dir, !!moving); } break;
    case 'ask': runFlow(() => ask(m)); break;
    case 'countdown': runFlow(() => countdown(m)); break;
    case 'verdict': runFlow(() => verdict(m)); break;
    case 'over': runFlow(() => over(m)); break;
    case 'top': renderTop(m.top, $('top2')); renderTop(m.top, $('top')); break;
  }
  if (state === 'lobby') updateLobbyCount();
}
// one scripted sequence at a time; a new server message cancels whatever was playing
let flowId = 0;
function runFlow(fn) { const id = ++flowId; fn().catch(e => { if (e !== 'cancel') console.error(e); }); return id; }
const alive = id => () => { if (id !== flowId) throw 'cancel'; };

// ---------- lobby ----------
let level = 'A1';
function setLevel(lv) { level = lv; document.querySelectorAll('#levels button').forEach(b => b.setAttribute('aria-pressed', b.textContent === lv)); }
$('levels').onclick = e => { if (e.target.tagName === 'BUTTON') { setLevel(e.target.textContent); send({ t: 'level', level }); } };
setLevel('A1');
$('start').onclick = () => { if (heroes.size) send({ t: 'start', level }); };
$('again').onclick = () => send({ t: 'start', level, short: true });
$('toLobby').onclick = () => send({ t: 'lobby' });

function showLobby() {
  state = 'lobby'; ++flowId;
  $('lobby').hidden = false; $('hud').hidden = true; dialog(false); $('final').classList.remove('on'); $('died').classList.remove('on');
  clearLabels(); S.clearCircles(); S.clearBlood(); FX.clearFx();
  S.torchesLit(true); S.ambient.intensity = .22; S.moon.intensity = .15;
  hideBoss(); boss.setEmotion('neutral');
  S.cam.pos.set(3.4, 3.6, 10.5); S.cam.look.set(3.4, 1.3, 1.6); lobbyLight(true);
  A.playMusic('lobby', .3);
  fetch('/api/top').then(r => r.json()).then(t => renderTop(t, $('top'))).catch(() => { });
  lineup(); updateLobbyCount();
}
function addHero(p, fresh) {
  if (heroes.has(p.id)) { heroes.get(p.id).setInfo(p); return; }
  const h = new Hero(p, labels); heroes.set(p.id, h);
  if (state === 'lobby') { lineup(); if (fresh) { h.play('Spawn_Ground', { once: true, fade: .05 }); h._cheer = 1.2; FX.dust(h.root.position.clone().setY(.3), 25); A.sfx('stamp', { vol: .5 }); } }
  else { h.place(0, 6, Math.PI); h.dead = true; h.alive = false; h.model.visible = false; h.blob.visible = false; h.rise(); }
}
function lineup() {
  if (state !== 'lobby') return;
  const list = [...heroes.values()], n = list.length;
  list.forEach((h, i) => { const row = i < 5 ? 0 : 1, k = row ? i - 5 : i, cnt = row ? n - 5 : Math.min(5, n); const x = 3.6 + (k - (cnt - 1) / 2) * 1.55; h.place(x, 2.4 - row * 1.7, 0); h.target.set(x, 0, 2.4 - row * 1.7); });
}
function updateLobbyCount() { $('pcount').textContent = `${heroes.size} / 10 heroes`; $('start').disabled = !heroes.size; }
function renderTop(list, el) {
  if (!el) return;
  el.innerHTML = (list || []).slice(0, 10).map((r, i) => `<div class="row"><span>${i + 1}</span><b>${esc(r.name)}</b><em>${r.points} pts · R${r.round}</em></div>`).join('') || '<div style="color:var(--bone-dim)">Nobody has survived yet.</div>';
}

// a warm spotlight on the heroes standing in the lobby
let lspot;
const lobbyTarget = new THREE.Object3D(); lobbyTarget.position.set(3.4, 0, 2);
function lobbyLight(on) {
  if (!lspot) return;
  if (on) { S.scene.add(lobbyTarget); lspot.target = lobbyTarget; lspot.position.set(3.4, 9, 9); lspot.color.set(0xffc89a); lspot.angle = .55; lspot.intensity = 160; }
  else { lspot.target = bossRoot; lspot.position.set(0, 14, 10); lspot.color.set(0xc8d0ff); lspot.angle = .42; lspot.intensity = 0; }
}

// ---------- dialog box over the beholder ----------
function dialog(on) { $('dialog').classList.toggle('on', on); }
function setDialog(text, opts, lv) { $('dtxt').textContent = text; $('dlv').textContent = lv || ''; $('dopts').innerHTML = opts ? opts.map((c, i) => `<div class="opt" data-i="${i}"><b style="background:${c.color};color:${c.color}"><span style="color:#160b0b">${c.letter}</span></b>${esc(c.text)}</div>`).join('') : ''; }
let clabels = [];
function circleLabels(list) { clearLabels(); clabels = list.map(c => { const d = document.createElement('div'); d.className = 'clabel'; d.style.borderColor = c.color; d.innerHTML = `<b style="background:${c.color}">${c.letter}</b>${esc(c.text)}`; labels.appendChild(d); return { d, c }; }); }
function clearLabels() { clabels.forEach(l => l.d.remove()); clabels = []; }

// The beholder speaks: a recorded line when available (jaw follows the audio), otherwise growled text.
async function bossSay(lineKey, text, { show = true, cps = 15 } = {}) {
  if (show) { setDialog('', null, ''); dialog(true); }
  const v = await A.voiceLine(lineKey, el => boss.talkAudio(el, { ctx: A.context(), out: A.voiceOut() }));
  if (v) {
    if (show) typeText(text, v.duration * 1000 * .85);
    await new Promise(r => { v.el.addEventListener('ended', r, { once: true }); v.el.addEventListener('error', r, { once: true }); setTimeout(r, v.duration * 1000 + 800); });
  } else await growl(text, cps, show);
}
function typeText(text, ms) { const t0 = nowMs(); const tick = () => { const k = Math.min(1, (nowMs() - t0) / ms); $('dtxt').textContent = text.slice(0, Math.ceil(text.length * k)); if (k < 1) requestAnimationFrame(tick); }; tick(); }
function growl(text, cps, show) {
  A.speakingStart();
  return new Promise(res => boss.talk(text, { cps, onChar: i => { A.grunt(text[i]); if (show) $('dtxt').textContent = text.slice(0, i + 1); }, onDone: () => { A.speakingEnd(); res(); } }));
}

// ---------- intro cinematic ----------
async function intro(m) {
  const ok = alive(flowId);
  state = 'intro';
  lobbyLight(false); $('lobby').hidden = true; $('final').classList.remove('on'); $('died').classList.remove('on'); dialog(false); clearLabels();
  S.clearCircles(); S.clearBlood(); FX.clearFx();
  for (const h of heroes.values()) h.dispose(); heroes.clear();
  m.players.forEach(p => { const h = new Hero(p, labels); heroes.set(p.id, h); });
  S.cam.pos.set(0, 9.2, 17.2); S.cam.look.set(0, 2.6, -1.5);
  $('hud').hidden = false; hud(0, m.level, m.players.length);
  hideBoss(); boss.setEmotion('neutral'); boss.lookAt(null);
  if (m.short) {
    S.torchesLit(true); S.ambient.intensity = .22; S.moon.intensity = .12;
    A.playMusic('battle', .3, 1);
    await emerge(2.6, ok); ok();
    boss.laugh(); await bossSay('laugh_2', 'Delicious.'); ok();
    await wait(600); ok(); dialog(false);
    send({ t: 'introDone' }); return;
  }
  // 1. darkness and a title card
  A.stopMusic(1.5);
  $('fade').style.opacity = 1; await wait(1300); ok();
  S.torchesLit(false); S.ambient.intensity = .025; S.moon.intensity = 0;
  $('card').style.opacity = 1; await wait(3200); ok(); $('card').style.opacity = 0; await wait(900); ok();
  $('fade').style.opacity = 0;
  // 2. the torches ignite, one after the other
  await wait(1400); ok();
  A.sfx('torch'); S.lightTorch(0); S.shake(.15); await wait(1200); ok();
  A.sfx('torch'); S.lightTorch(1); S.shake(.15);
  for (let i = 0; i < 20; i++) { S.ambient.intensity += .01; await wait(40); } ok();
  const list = [...heroes.values()];
  for (const h of list.sort(() => Math.random() - .5).slice(0, 3)) { h.say(pick(LINES.dark)); await wait(900); ok(); }
  await wait(1500); ok();
  // 3. something comes out of the dark
  A.sfx('rumble'); S.shake(.6); A.playMusic('battle', .3, 4);
  await emerge(6.5, ok); ok();
  S.shake(.8); A.sfx('roar', { vol: .7 });
  boss.setEmotion('happy'); boss.lookAt(new THREE.Vector3(0, 1, 3));
  for (const h of list.slice(0, 2)) h.say(pick(['W-what is THAT?!', 'RUN!!', 'Oh no...', "It's HUGE!"]));
  await wait(1200); ok();
  boss.laugh(3.6); await bossSay('laugh_1', 'Mwahahahaha!', { show: false }); ok();
  boss.setEmotion('neutral');
  await bossSay('intro', 'So... more little adventurers have crawled into my lair. You will answer my questions... or you will DIE!'); ok();
  await wait(700); ok(); dialog(false);
  send({ t: 'introDone' });
}
async function emerge(secs, ok) {
  bossRoot.visible = true;
  const from = new THREE.Vector3(0, 9, -32), to = BH_HOME, t0 = nowMs();
  eyeGlow.material.opacity = 0;
  while (true) {
    const k = Math.min(1, (nowMs() - t0) / (secs * 1000)); const e = 1 - Math.pow(1 - k, 3);
    bossRoot.position.lerpVectors(from, to, e);
    bossLight.intensity = 40 * e; bossRoot.userData.rim.intensity = 36 * e; bossRoot.userData.key.intensity = 260 * e;
    eyeGlow.material.opacity = Math.min(1, k * 3) * (1 - e * .75);
    if (k >= 1) break; await wait(16); ok();
  }
  eyeGlow.material.opacity = .25;
}

// ---------- a round ----------
let round = 0, curAsk = null;
function hud(r, lv, n) { $('hRound').textContent = r ? `Round ${r}` : 'The lair'; $('hLevel').textContent = lv; $('hAlive').textContent = `${n} alive`; }
async function ask(m) {
  const ok = alive(flowId);
  state = 'ask'; round = m.round; curAsk = m;
  hud(m.round, m.level, m.alive);
  boss.setEmotion('neutral'); boss.lookAt(new THREE.Vector3(0, 1, 3));
  S.showCircles(m.circles); circleLabels(m.circles); A.sfx('circles');
  // a remark before the question (the last survivor and level-ups get their own line)
  if (m.lastOne) { await bossSay('last_one', 'Only one remains... Interesting. Let us see how long you last.'); ok(); }
  else if (m.harder && m.round > 1) { await bossSay('harder', 'The questions grow harder... and so does your fate.'); ok(); }
  else if (m.round > 1 && Math.random() < .35) { const k = pick(['next_1', 'next_2']); await bossSay(k, k === 'next_1' ? 'Next question!' : 'Let us see... how much you really know.'); ok(); }
  const aliveHeroes = [...heroes.values()].filter(h => !h.dead);
  setTimeout(() => { for (const h of aliveHeroes.sort(() => Math.random() - .5).slice(0, 2)) h.say(pick(LINES.ask)); }, 1200);
  setDialog('', null, `Round ${m.round} · ${m.level} · ${m.part}`); dialog(true);
  await growl(m.prompt, 16, true); ok();
  $('dopts').innerHTML = m.circles.map((c, i) => `<div class="opt" data-i="${i}"><b style="background:${c.color};color:${c.color}"><span style="color:#160b0b">${c.letter}</span></b>${esc(c.text)}</div>`).join('');
  await wait(500); ok();
  send({ t: 'askDone' });
}
async function countdown(m) {
  const ok = alive(flowId);
  state = 'countdown';
  boss.setEmotion('angry', 4);
  const b = $('banner'); b.classList.remove('stamp'); void b.offsetWidth; b.classList.add('stamp'); S.shake(.5); A.sfx('stamp');
  bossSay('answer_or_die', 'Answer... or DIE!', { show: false });
  const aliveHeroes = [...heroes.values()].filter(h => !h.dead);
  for (const h of aliveHeroes.sort(() => Math.random() - .5).slice(0, 2)) setTimeout(() => !h.dead && h.say(pick(LINES.count), 1800), 900 + Math.random() * 2000);
  for (let n = m.secs; n >= 1; n--) {
    const el = $('countdown'); el.textContent = n; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
    const pu = $('pulse'); pu.style.setProperty('--p', (.3 + (m.secs - n) / m.secs * .55).toFixed(2)); pu.classList.remove('beat'); void pu.offsetWidth; pu.classList.add('beat');
    if (n <= 2) S.shake(.12);
    A.sfx('tick', { vol: .9 });
    if (n === 2) A.sfx('charge', { vol: .8 });
    await wait(1000); ok();
  }
}
// death by colour of the ray: each eye kills its own way
const DEATHS = ['blood', 'gib', 'burn', 'stone'];
async function verdict(m) {
  const ok = alive(flowId);
  state = 'verdict';
  S.resolveCircles(m.correct);
  clabels.forEach((l, i) => l.d.classList.toggle('lose', i !== m.correct));
  document.querySelectorAll('#dopts .opt').forEach(o => o.classList.add(+o.dataset.i === m.correct ? 'win' : 'lose'));
  // freeze heroes exactly where the server judged them
  for (const [id, x, z, dir] of m.pos) { const h = heroes.get(id); if (h && !h.dead) { h.target.set(x, 0, z); h.moving = false; } }
  const doomed = m.dead.map(d => heroes.get(d.id)).filter(Boolean);
  const saved = m.surv.map(id => heroes.get(id)).filter(Boolean);
  hud(round, curAsk ? curAsk.level : '', saved.length);
  await wait(500); ok();
  if (doomed.length) {
    doomed.forEach(h => h.say(pick(LINES.doomed), 2200));
    await wait(700); ok();
    pendingKills = doomed.map((h, i) => ({ h, kind: DEATHS[(i + round) % DEATHS.length], t: h.root.position.clone().add(new THREE.Vector3(0, 1, 0)) }));
    boss.fireRays(pendingKills.map(k => k.t), { count: doomed.length, charge: .55, hold: .8, stagger: .12 });
    await wait(1700 + doomed.length * 140); ok();
    // the beholder is delighted
    boss.setEmotion('happy', 3); boss.laugh(2.6);
    const kl = pick(['kill_1', 'kill_2', 'kill_3', 'laugh_1']);
    const txt = { kill_1: 'Wrong. How sad.', kill_2: 'Another soul for my collection.', kill_3: 'Your English... was not enough.', laugh_1: 'Mwahahahaha!' }[kl];
    setTimeout(() => saved.forEach(h => !h.dead && h.say(pick(LINES.mourn), 2000)), 600);
    await bossSay(kl, txt, { show: false }); ok();
    await wait(800); ok();
  }
  if (saved.length) {
    saved.forEach((h, i) => setTimeout(() => { if (!h.dead) { h.cheer(); h.say(pick(LINES.survive), 2000); } }, i * 150));
    await wait(doomed.length ? 400 : 900); ok();
    boss.setEmotion('angry', 5); S.shake(.4);
    if (!doomed.length) A.sfx('roar', { vol: .6 });
    const al = pick(['angry_1', 'angry_2', 'angry_3']);
    await bossSay(al, { angry_1: 'What?! You... survived?', angry_2: 'Impossible! Again!', angry_3: 'Lucky... but luck always runs out.' }[al], { show: false }); ok();
    await wait(600); ok();
    boss.setEmotion('neutral', 2);
  }
  // ghosts whisper now and then
  for (const h of heroes.values()) if (h.ghost && Math.random() < .35) h.say(pick(LINES.ghost), 2200);
  S.clearCircles(); clearLabels(); dialog(false);
  await wait(700); ok();
  send({ t: 'execDone' });
}
let pendingKills = [];
function onBossEvent(ev) {
  if (ev.type === 'fire' || ev.type === 'hit') S.shake(.35);
  if (ev.type === 'charge') A.sfx('charge', { vol: .7 });
  if (ev.type === 'ray') {
    A.sfx('beam', { vol: .7 });
    // match the ray to the closest doomed hero
    let best = null, bd = 1e9;
    for (const k of pendingKills) { if (k.done) continue; const d = k.t.distanceTo(ev.target); if (d < bd) { bd = d; best = k; } }
    if (!best) return; best.done = true;
    setTimeout(() => {
      const h = best.h; h.die(best.kind, bossRoot.position);
      FX.sparks(best.t, ev.color);
      A.sfx(VOICE[h.char] === 'f' ? 'scream_f' : 'scream_m', { vol: .9 });
      A.sfx(best.kind === 'burn' ? 'burn' : best.kind === 'stone' ? 'petrify' : 'splat', { vol: .9, delay: .05 });
      S.shake(.45);
      setTimeout(() => { h.rise(); A.sfx('ghost', { vol: .5 }); }, 2200);
    }, 160);
  }
}

// ---------- game over ----------
async function over(m) {
  const ok = alive(flowId);
  state = 'over';
  S.clearCircles(); clearLabels(); dialog(false); $('hud').hidden = true;
  A.stopMusic(2);
  await wait(800); ok();
  $('died').classList.add('on'); A.sfx('gong', { vol: 1 });
  boss.setEmotion('happy', 2);
  await wait(2600); ok();
  boss.laugh(3); await bossSay('you_died', 'All of you... dead. Come back... if you dare.', { show: false }); ok();
  await wait(800); ok();
  $('died').classList.remove('on');
  renderFinal(m);
  $('final').classList.add('on');
  A.playMusic('lobby', .22, 3);
}
function renderFinal(m) {
  const rows = m.ranking.map(r => {
    const parts = (r.parts || []).filter(p => p.n).sort((a, b) => b.ok / b.n - a.ok / a.n);
    const best = parts[0] && parts[0].ok ? parts[0].name : '—';
    const worst = parts.length > 1 && parts[parts.length - 1].ok < parts[parts.length - 1].n ? parts[parts.length - 1].name : (parts.length === 1 && parts[0].ok < parts[0].n ? parts[0].name : '—');
    const ring = TINTS[r.tint] || 'transparent';
    return `<tr><td>${r.rank}</td><td><img src="/assets/portraits/${r.char}.png" alt="" style="border-color:${ring}"> <b>${esc(r.name)}</b></td><td class="pts">${r.points}</td><td>${Math.max(0, r.round - 1)} <small>rounds</small></td><td>${r.correct}/${r.answered}</td><td class="strong">${esc(best)}</td><td class="weak">${esc(worst)}</td></tr>`;
  }).join('');
  $('rank').innerHTML = `<tr><th>#</th><th>Hero</th><th>Points</th><th>Survived</th><th>Right</th><th>Strong at</th><th>Practise</th></tr>${rows}`;
  renderTop([], $('top2')); fetch('/api/top').then(r => r.json()).then(t => renderTop(t, $('top2'))).catch(() => { });
}

// ---------- main loop ----------
const clock = new THREE.Clock(); let T = 0; const perf = { t: 0, n: 0, last: 0 };
const eyeW = new THREE.Vector3();
function frame() {
  const dt = SIM ? 1 / 30 : Math.min(clock.getDelta(), .05); T += dt;
  if (SIM) { simNow += dt; for (let i = simWaits.length - 1; i >= 0; i--) if (simWaits[i].at <= simNow) { simWaits[i].r(); simWaits.splice(i, 1); } }
  if (boss) {
    boss.update(dt);
    if (state === 'lobby') { bossRoot.visible = false; eyeGlow.material.opacity = Math.max(0, Math.sin(T * .7)) * .35; }
    // the eye glow follows the central eye
    boss.bones.body.localToWorld(eyeW.copy(boss.eyeC).sub(boss.bodyC).add(new THREE.Vector3(0, 0, .25)));
    eyeGlow.position.copy(eyeW); eyeGlow.material.color.setRGB(1, .55 + boss.U.uGlow.value * .2, .4);
    bossLight.intensity = bossRoot.visible ? (34 + boss.U.uGlow.value * 24) : 0;
  }
  for (const h of heroes.values()) h.update(dt, T);
  // circle labels follow their circles on screen
  for (const { d, c } of clabels) { const v = eyeW.set(c.x, 3.1, c.z).project(S.camera); d.style.transform = `translate(-50%,-100%) translate(${(v.x * .5 + .5) * innerWidth}px,${(-v.y * .5 + .5) * innerHeight}px)`; }
  FX.update(dt); S.update(dt, T);
  // adaptive resolution: keeps the office projector PC smooth
  if (!SIM) { perf.t += clock.elapsedTime - perf.last; perf.last = clock.elapsedTime; perf.n++;
    if (perf.t > 2) { const ms = perf.t / perf.n * 1000; let pr = S.renderer.getPixelRatio();
      if (ms > 38 && pr > .6) S.renderer.setPixelRatio(pr = Math.max(.6, pr - .15));
      else if (ms < 20 && pr < Math.min(devicePixelRatio, 1.25)) S.renderer.setPixelRatio(pr = Math.min(Math.min(devicePixelRatio, 1.25), pr + .1));
      perf.t = 0; perf.n = 0; } }
  S.renderer.render(S.scene, S.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// for automated tests
window.__eotb = { heroes, get boss() { return boss; }, S, onMsg, send, dbg: () => ({ flowId, simNow, waits: simWaits.length, state }) };
