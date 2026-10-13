// Eye of the Beholder — server: rooms, player movement, rounds and the question bank.
// The server is the referee: it moves every player, decides who stands in which circle
// and never sends the correct answer before the countdown ends.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three'), { maxAge: '7d' }));
app.get('/qr.svg', async (req, res) => {
  try {
    const svg = await QRCode.toString(String(req.query.text || ''), { type: 'svg', margin: 1, color: { dark: '#0d0708', light: '#e9dcc4' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) { res.status(400).end(); }
});
app.get('/health', (_, res) => res.send('ok'));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
app.get('/play', (_, res) => res.sendFile(path.join(__dirname, 'public/phone.html')));
app.get('/j/:code', (req, res) => res.redirect('/play?code=' + encodeURIComponent(req.params.code)));
// lets the host page know which real voice / sound files exist (the rest are synthesized)
app.get('/api/audio', (_, res) => {
  const list = d => { try { return fs.readdirSync(path.join(__dirname, 'public/assets', d)).filter(f => /\.(mp3|ogg|wav)$/.test(f)); } catch { return []; } };
  res.json({ voice: list('voice'), sfx: list('sfx') });
});

// ---------- tuning (easy to change after playtesting) ----------
const T = {
  MAX_PLAYERS: 10,
  SPEED: 5.0,                 // units per second
  ARENA: { x: 6.6, zMin: -1.6, zMax: 5.4 },
  CIRCLE_R: 1.0,              // small on purpose, but 10 heroes still fit
  COUNTDOWN: [6, 6, 10, 10, 10], // seconds per level A1..C1 (B1+ questions are longer)
  READ_PAUSE_MS: 2500,        // quiet time after the beholder reads, before the count starts
  GRACE_MS: 250,              // network grace at the freeze
  ROUND_LEVEL_EVERY: 6,       // one level harder every N rounds (keeps solo / no-death games moving)
  MIX_LOWER: { 2: 0.2, 3: 0.4, 4: 0.4 }, // chance of pulling the question from the level below (softens B1+)
  CIRCLES_BY_LEVEL: [3, 3, 4, 4, 4],
  POINTS: [10, 20, 30, 40, 50],
};
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

// ---------- question bank (Castle Quest format) ----------
const BANK = LEVELS.map(lv => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions', lv + '.json'), 'utf8'));
  const qs = data.questions
    .filter(q => !q.t && q.q.length <= 170 && q.o.every(o => o.length <= 44))
    .map((q, i) => ({ ...q, id: lv + '-' + i, level: lv, li: LEVELS.indexOf(lv), partName: (data.parts[q.part] || {}).name || q.part }));
  console.log(`Bank ${lv}: ${qs.length} questions`);
  return qs;
});
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// circle layouts on the arena floor (front of the beholder); one is picked at random each round
const LAYOUTS = {
  3: [[[-3.6, 1.4], [0, 3.2], [3.6, 1.4]], [[-3.2, 3.4], [0, 0.6], [3.2, 3.4]], [[-4.2, 2.6], [0, 2.2], [4.2, 2.6]]],
  4: [[[-4.2, 1.2], [-1.4, 3.6], [1.4, 3.6], [4.2, 1.2]], [[-3.4, 0.4], [3.4, 0.4], [-3.4, 4.0], [3.4, 4.0]], [[-4.5, 2.6], [-1.5, 0.8], [1.5, 0.8], [4.5, 2.6]]],
};
const CIRCLE_COLORS = ['#e8423a', '#3a8ee8', '#3fd46b', '#f2c230']; // A red · B blue · C green · D gold

// ---------- rooms ----------
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() { let c; do { c = Array.from({ length: 4 }, () => LETTERS[Math.random() * LETTERS.length | 0]).join(''); } while (rooms.has(c)); return c; }
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const toHost = (room, msg) => send(room.host, msg);
const toPhones = (room, msg) => { for (const p of room.players.values()) send(p.ws, msg); };
const rid = () => Math.random().toString(36).slice(2, 10);

function publicPlayer(p) { return { id: p.id, name: p.name, char: p.char, tint: p.tint, online: !!(p.ws && p.ws.readyState === 1), alive: p.alive, points: p.points }; }
function createRoom(ws) {
  const room = { code: newCode(), key: rid(), host: ws, players: new Map(), state: 'lobby', level: 0, round: 0, created: Date.now(), lastSeen: Date.now(), timers: [] };
  rooms.set(room.code, room);
  return room;
}
const SLOW = +process.env.SLOW || 1; // tests only: stretches every timer
function later(room, ms, fn) { const t = setTimeout(fn, ms * SLOW); room.timers.push(t); return t; }
function clearTimers(room) { room.timers.forEach(clearTimeout); room.timers = []; }

// duplicate characters get a recolor: the first free variant index for that character
function pickTint(room, p) {
  const used = new Set([...room.players.values()].filter(o => o !== p && o.char === p.char).map(o => o.tint));
  let i = 0; while (used.has(i)) i++; return i;
}

function resetPlayer(p, i, n) {
  p.alive = true; p.points = 0; p.diedRound = null; p.correct = 0; p.answered = 0; p.parts = {}; p.hist = [];
  p.in = { x: 0, y: 0 };
  // spawn in a loose line at the front of the arena
  const span = Math.min(10, n * 1.3);
  p.x = n > 1 ? -span / 2 + span * (i / (n - 1)) : 0; p.z = 4.6 + (i % 2) * 0.5; p.dir = Math.PI;
}

function startGame(room, { short = false } = {}) {
  clearTimers(room);
  const list = [...room.players.values()];
  list.forEach((p, i) => resetPlayer(p, i, list.length));
  room.round = 0; room.startN = list.length; room.q = null; room.used = new Set(); room.frozen = false;
  room.state = 'intro';
  const payload = { t: 'intro', short, players: list.map(publicPlayer), level: LEVELS[room.level] };
  toHost(room, payload);
  toPhones(room, { t: 'state', state: 'intro' });
  later(room, short ? 9000 : 45000, () => { if (room.state === 'intro') nextRound(room); }); // fallback if the host never reports
}

function alivePlayers(room) { return [...room.players.values()].filter(p => p.alive); }

function currentLevelIndex(room) {
  const alive = alivePlayers(room).length, n = Math.max(1, room.startN);
  const base = room.level, room4 = 4 - base;
  const deathSteps = Math.floor((1 - alive / n) * room4 + 1e-9);
  const roundSteps = Math.floor((room.round - 1) / T.ROUND_LEVEL_EVERY);
  return clamp(base + deathSteps + roundSteps, base, 4);
}

function pickQuestion(room) {
  let li = currentLevelIndex(room);
  const target = li;
  if (li > room.level && Math.random() < (T.MIX_LOWER[li] || 0)) li--;
  let pool = BANK[li].filter(q => !room.used.has(q.id));
  if (!pool.length) { BANK[li].forEach(q => room.used.delete(q.id)); pool = BANK[li]; }
  const q = pool[Math.random() * pool.length | 0];
  room.used.add(q.id);
  const nCirc = T.CIRCLES_BY_LEVEL[li];
  // keep the correct option, drop random wrong ones down to the circle count, then shuffle
  let opts = q.o.map((text, i) => ({ text, ok: i === q.a }));
  const wrong = shuffle(opts.filter(o => !o.ok)).slice(0, nCirc - 1);
  opts = shuffle([opts.find(o => o.ok), ...wrong]);
  const layout = LAYOUTS[nCirc][Math.random() * LAYOUTS[nCirc].length | 0];
  const circles = shuffle(layout.slice()).map(([x, z], i) => ({ x, z, r: T.CIRCLE_R, color: CIRCLE_COLORS[i], letter: 'ABCD'[i], text: opts[i].text }));
  return { q, li, target, circles, correct: opts.findIndex(o => o.ok) };
}

function nextRound(room) {
  clearTimers(room);
  if (!alivePlayers(room).length) return gameOver(room);
  room.round++;
  const prevLi = room.q ? room.q.li : room.level;
  room.q = pickQuestion(room);
  room.state = 'ask'; room.frozen = false;
  const { q, circles, li, target } = room.q;
  const alive = alivePlayers(room).length;
  const secs = T.COUNTDOWN[li];
  const msg = { t: 'ask', secs, round: room.round, level: LEVELS[li], harder: target > prevLi, part: q.partName, prompt: q.q,
    circles: circles.map(c => ({ x: c.x, z: c.z, r: c.r, color: c.color, letter: c.letter, text: c.text })), alive, lastOne: alive === 1 && room.startN > 1 && !room.announcedLast };
  if (msg.lastOne) room.announcedLast = true;
  toHost(room, msg);
  toPhones(room, { t: 'ask', round: room.round, level: LEVELS[li], prompt: q.q, circles: msg.circles.map(c => ({ color: c.color, letter: c.letter, text: c.text })) });
  // fallback: if the host does not report that the beholder finished reading, start the countdown anyway
  later(room, 9000 + q.q.length * 90 + T.READ_PAUSE_MS + q.q.length * 25 + (msg.lastOne || msg.harder ? 9000 : 4000), () => { if (room.state === 'ask') startCountdown(room); });
}

function startCountdown(room) {
  if (room.state !== 'ask') return;
  room.state = 'countdown';
  const secs = T.COUNTDOWN[room.q.li];
  const ends = Date.now() + secs * 1000;
  toHost(room, { t: 'countdown', secs });
  toPhones(room, { t: 'countdown', secs });
  // the beholder says "Time is up!" after the last number, then the rays
  later(room, secs * 1000 + T.GRACE_MS, () => judge(room));
  room.countdownEnds = ends;
}

function judge(room) {
  if (room.state !== 'countdown') return;
  room.state = 'judge'; room.frozen = true;
  const { circles, correct, q, li } = room.q;
  const C = circles[correct];
  const dead = [], surv = [];
  for (const p of alivePlayers(room)) {
    const inCircle = circles.findIndex(c => Math.hypot(p.x - c.x, p.z - c.z) <= c.r);
    p.answered++;
    const part = p.parts[q.partName] ||= { ok: 0, n: 0, level: q.level };
    part.n++;
    // what this student answered, for the round-by-round review on their phone
    (p.hist ||= []).push({ round: room.round, level: LEVELS[li], part: q.partName, prompt: q.q, answer: C.text, chose: inCircle >= 0 ? circles[inCircle].text : null, ok: inCircle === correct });
    if (inCircle === correct) {
      p.correct++; part.ok++; p.points += T.POINTS[li]; surv.push(p.id);
    } else {
      p.alive = false; p.diedRound = room.round; dead.push({ id: p.id, chose: inCircle });
    }
  }
  toHost(room, { t: 'verdict', correct, correctText: C.text, dead, surv, players: [...room.players.values()].map(publicPlayer), pos: positions(room) });
  for (const p of room.players.values()) {
    const died = dead.some(d => d.id === p.id), lived = surv.includes(p.id);
    send(p.ws, { t: 'verdict', correct, correctText: C.text, you: died ? 'dead' : lived ? 'alive' : (p.alive ? 'alive' : 'ghost'), points: p.points, round: room.round });
  }
  later(room, dead.length ? 16000 : 11000, () => { if (room.state === 'judge') afterExec(room); });
}

function afterExec(room) {
  if (room.state !== 'judge') return;
  if (!alivePlayers(room).length) return gameOver(room);
  room.frozen = false;
  nextRound(room);
}

function report(room, p) {
  const parts = Object.entries(p.parts).map(([name, v]) => ({ name, ok: v.ok, n: v.n, level: v.level }));
  return { id: p.id, name: p.name, char: p.char, tint: p.tint, points: p.points, round: p.diedRound || room.round, correct: p.correct, answered: p.answered, parts, hist: p.hist || [] };
}

function gameOver(room) {
  clearTimers(room);
  room.state = 'over';
  const ranking = [...room.players.values()].map(p => report(room, p)).sort((a, b) => b.points - a.points || b.round - a.round);
  ranking.forEach((r, i) => r.rank = i + 1);
  toHost(room, { t: 'over', ranking: ranking.map(({ hist, ...r }) => r), level: LEVELS[room.level], rounds: room.round, date: new Date().toISOString() });
  const when = new Date().toISOString();
  for (const r of ranking) { const p = room.players.get(r.id); if (!p) continue; p.lastOver = { t: 'over', report: r, players: ranking.length, code: room.code, level: LEVELS[room.level], rounds: room.round, date: when }; send(p.ws, p.lastOver); }
  // everyone who answered at least once goes to the global ranking (the server keeps the real score)
  Promise.all(ranking.filter(r => r.points > 0).map(r => saveScore({ name: r.name, char: r.char, points: r.points, round: r.round, level: LEVELS[room.level] }).catch(e => console.error('score', e.message))))
    .then(() => topScores(10)).then(top => toHost(room, { t: 'top', top })).catch(() => { });
}

function positions(room) { return [...room.players.values()].map(p => [p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.dir.toFixed(2), p.alive ? 1 : 0, (p.in.x || p.in.y) && !(room.frozen && p.alive) ? 1 : 0]); }

// ---------- movement simulation (20 Hz) ----------
const TICK = 50;
setInterval(() => {
  for (const room of rooms.values()) {
    if (!['intro', 'ask', 'countdown', 'judge'].includes(room.state)) continue;
    const dt = TICK / 1000;
    for (const p of room.players.values()) {
      const frozen = room.frozen && p.alive; // ghosts keep floating around
      let { x: ix, y: iy } = p.in;
      if (!p.ws || p.ws.readyState !== 1) ix = iy = 0;
      if (frozen || (!ix && !iy)) continue;
      const m = Math.min(1, Math.hypot(ix, iy));
      const sp = T.SPEED * (p.alive ? 1 : 0.8) * m;
      const a = Math.atan2(ix, iy);
      p.x = clamp(p.x + Math.sin(a) * sp * dt, -T.ARENA.x, T.ARENA.x);
      p.z = clamp(p.z + Math.cos(a) * sp * dt, T.ARENA.zMin - (p.alive ? 0 : 1.5), T.ARENA.zMax);
      p.dir = a;
    }
    toHost(room, { t: 'pos', p: positions(room) });
  }
}, TICK);

// ---------- global ranking (Supabase through the server, or a local file) ----------
const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_KEY, SB_TABLE = process.env.SUPABASE_TABLE || 'beholder_scores';
const LOCAL_SCORES = path.join(__dirname, 'scores.json');
const sbHeaders = () => ({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' });
async function saveScore(row) {
  if (SB_URL && SB_KEY) {
    const r = await fetch(`${SB_URL}/rest/v1/${SB_TABLE}`, { method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (!r.ok) throw new Error('supabase ' + r.status + ' ' + await r.text());
  } else {
    let all = []; try { all = JSON.parse(fs.readFileSync(LOCAL_SCORES, 'utf8')); } catch { }
    all.push({ ...row, created_at: new Date().toISOString() }); fs.writeFileSync(LOCAL_SCORES, JSON.stringify(all.slice(-5000)));
  }
}
async function topScores(limit = 10) {
  if (SB_URL && SB_KEY) {
    const r = await fetch(`${SB_URL}/rest/v1/${SB_TABLE}?select=name,char,points,round,level&order=points.desc,round.desc&limit=${limit}`, { headers: sbHeaders() });
    if (!r.ok) throw new Error('supabase ' + r.status);
    return r.json();
  }
  let all = []; try { all = JSON.parse(fs.readFileSync(LOCAL_SCORES, 'utf8')); } catch { }
  return all.sort((a, b) => b.points - a.points || b.round - a.round).slice(0, limit);
}
app.get('/api/top', async (req, res) => { try { res.json(await topScores(Math.min(20, +req.query.limit || 10))); } catch (e) { console.error(e); res.json([]); } });

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch { return; } try { handle(ws, m); } catch (e) { console.error('handle error', e); } });
  ws.on('close', () => {
    const room = ws.room; if (!room) return;
    if (ws.role === 'host') { if (room.host === ws) room.host = null; room.lastSeen = Date.now(); }
    else if (ws.player && ws.player.ws === ws) {
      const p = ws.player; p.ws = null; p.in = { x: 0, y: 0 };
      toHost(room, { t: 'player_update', p: publicPlayer(p) });
      if (room.state === 'lobby') setTimeout(() => { if (!p.ws && room.state === 'lobby' && room.players.get(p.id) === p) { room.players.delete(p.id); toHost(room, { t: 'player_leave', pid: p.id }); } }, 20000);
    }
  });
});

function handle(ws, m) {
  if (m.t === 'ping') return send(ws, { t: 'pong' });
  if (m.t === 'host') {
    let room = m.code && rooms.get(m.code);
    if (room && room.key === m.key) { if (room.host && room.host !== ws) try { room.host.close(); } catch { } room.host = ws; }
    else room = createRoom(ws);
    ws.room = room; ws.role = 'host';
    send(ws, { t: 'room', code: room.code, key: room.key, state: room.state, level: LEVELS[room.level], players: [...room.players.values()].map(publicPlayer) });
    return;
  }
  if (m.t === 'join') {
    const code = String(m.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return send(ws, { t: 'error', msg: 'There is no game with that code.' });
    let p = m.pid && room.players.get(m.pid);
    if (!p) {
      if (room.players.size >= T.MAX_PLAYERS) return send(ws, { t: 'error', msg: 'The lair is full (10 players max).' });
      const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 12) || 'Hero';
      p = { id: rid(), name, char: CHARS.includes(m.char) ? m.char : 'Knight', ws: null, alive: room.state === 'lobby', points: 0, parts: {}, in: { x: 0, y: 0 }, x: 0, z: 5, dir: Math.PI, correct: 0, answered: 0 };
      p.tint = pickTint(room, p);
      room.players.set(p.id, p);
      if (room.state !== 'lobby') { p.alive = false; p.diedRound = room.round; } // late arrivals watch as ghosts
    } else if (p.ws && p.ws !== ws) { try { p.ws.close(); } catch { } }
    p.ws = ws; ws.room = room; ws.role = 'phone'; ws.player = p;
    send(ws, { t: 'joined', pid: p.id, name: p.name, char: p.char, tint: p.tint, state: room.state, alive: p.alive, points: p.points });
    if (room.state === 'over' && p.lastOver) send(ws, p.lastOver); // a phone that reconnects still gets its report
    toHost(room, { t: 'player_join', p: publicPlayer(p) });
    if (room.state === 'over') { const r = report(room, p); send(ws, { t: 'over', report: r, players: room.players.size }); }
    return;
  }
  const room = ws.room; if (!room) return;
  if (ws.role === 'phone') {
    const p = ws.player;
    if (m.t === 'setChar' && room.state === 'lobby' && CHARS.includes(m.char)) { p.char = m.char; p.tint = pickTint(room, p); send(ws, { t: 'char', char: p.char, tint: p.tint }); toHost(room, { t: 'player_update', p: publicPlayer(p) }); }
    if (m.t === 'move') { const x = +m.x || 0, y = +m.y || 0; p.in = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }; }
    if (m.t === 'emote' && room.state === 'lobby') toHost(room, { t: 'emote', pid: p.id });
    return;
  }
  if (ws.role === 'host' && room.host === ws) {
    if (m.t === 'level') { room.level = clamp(LEVELS.indexOf(m.level), 0, 4); }
    if (m.t === 'start' && room.players.size) { if (m.level) room.level = clamp(LEVELS.indexOf(m.level), 0, 4); startGame(room, { short: !!m.short }); }
    if (m.t === 'introDone' && room.state === 'intro') nextRound(room);
    if (m.t === 'askDone' && room.state === 'ask') startCountdown(room);
    if (m.t === 'execDone' && room.state === 'judge') afterExec(room);
    if (m.t === 'lobby') {
      clearTimers(room); room.state = 'lobby';
      for (const [id, p] of room.players) if (!p.ws) { room.players.delete(id); toHost(room, { t: 'player_leave', pid: id }); }
      for (const p of room.players.values()) { p.alive = true; p.points = 0; send(p.ws, { t: 'state', state: 'lobby' }); }
      toHost(room, { t: 'room', code: room.code, key: room.key, state: room.state, level: LEVELS[room.level], players: [...room.players.values()].map(publicPlayer) });
    }
    if (m.t === 'kick') { const p = room.players.get(m.pid); if (p) { send(p.ws, { t: 'kicked' }); room.players.delete(m.pid); toHost(room, { t: 'player_leave', pid: m.pid }); } }
  }
}
const CHARS = ['Knight', 'Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'];

setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch { } });
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.host || [...room.players.values()].some(p => p.ws);
    if (anyone) room.lastSeen = now;
    else if (now - room.lastSeen > 30 * 60 * 1000) { clearTimers(room); rooms.delete(code); }
  }
}, 25000);

server.listen(PORT, () => console.log('Eye of the Beholder on http://localhost:' + PORT));
