// Headless playtest: starts the server, opens the projector page, connects fake phones and screenshots each phase.
// Usage: node tools/playtest.mjs <outdir> [players]
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import WebSocket from 'ws';
import fs from 'fs';
const out = process.argv[2] || 'shots', N = +(process.argv[3] || 4);
fs.mkdirSync(out, { recursive: true });
const PORT = 3111;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, SLOW: process.env.SLOW || '10' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', d => process.stdout.write('[srv] ' + d)); srv.stderr.on('data', d => process.stdout.write('[srv!] ' + d));
await new Promise(r => setTimeout(r, 1200));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: 1024, height: 576 } });
page.on('console', m => { const t = m.text(); if (!/Failed to load|404/.test(t)) console.log('[page]', t.slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.addInitScript(() => { window.__capture = true; });
await page.goto(`http://localhost:${PORT}/?sim`);
await page.waitForFunction('window.ready', null, { timeout: 240000 });
await page.click('#open');
await page.waitForFunction(() => document.getElementById('code').textContent.length === 4 && !document.getElementById('code').textContent.includes('·'), null, { timeout: 30000 });
const code = await page.textContent('#code');
console.log('room', code);
const chars = ['Knight', 'Mage', 'Barbarian', 'Ranger', 'Rogue', 'Rogue_Hooded', 'Knight', 'Knight', 'Mage', 'Rogue'];
const names = ['Ana', 'Leo', 'Sofía', 'Mateo', 'Valen', 'Juan', 'Camila', 'Dani', 'Sara', 'Tomás'];
const phones = [];
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  await new Promise(r => ws.on('open', r));
  const ph = { ws, i, circles: null, alive: true };
  ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'joined') ph.pid = m.pid; if (m.t === 'ask') { ph.goal = Math.random() < .55 ? 0 : (Math.random() * 3 | 0); } if (m.t === 'verdict') { ph.alive = m.you === 'alive'; ph.goal = null; } });
  ws.send(JSON.stringify({ t: 'join', code, name: names[i], char: chars[i] }));
  phones.push(ph);
}
const shot = async (name, wait = 0) => { if (wait) await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
await shot('01_lobby', 2500);
// listen to server messages through the page hook
await page.evaluate(() => { window.__log = []; const o = window.__eotb.onMsg; });
await page.click('#start');
await shot('02_intro_dark', 20000);
await shot('03_intro_torches', 40000);
// steer phones: each walks toward a circle (half aim at circle 0) when a question arrives
const hostPos = {};
let lastAsk = null;
const steer = setInterval(async () => {
  let info; try { info = await page.evaluate(() => ({ c: window.__eotb.S.circles.map(c => [c.x, c.z]), h: [...window.__eotb.heroes.entries()].map(([id, h]) => [id, h.target.x, h.target.z]) })); } catch { return; }
  for (const ph of phones) {
    const me = info.h.find(e => e[0] === ph.pid); if (!me) continue;
    let x = (Math.random() - .5) * .6, y = (Math.random() - .5) * .6;
    if (ph.goal != null && info.c[ph.goal]) { const [cx, cz] = info.c[ph.goal]; const dx = cx - me[1], dz = cz - me[2], d = Math.hypot(dx, dz); x = d > .15 ? dx / d * Math.min(1, d) : 0; y = d > .15 ? dz / d * Math.min(1, d) : 0; }
    ph.ws.send(JSON.stringify({ t: 'move', x, y }));
  }
}, 300);
await page.waitForFunction(() => window.__eotb.boss && window.__eotb.boss.root.parent.position.z > -20, null, { timeout: 600000 });
await shot('04_intro_emerge', 8000);
await page.waitForFunction(() => document.getElementById('dialog').classList.contains('on'), null, { timeout: 600000 });
await shot('05_intro_speech', 15000);
await page.waitForFunction(() => document.getElementById('dialog').classList.contains('on') && document.getElementById('hRound').textContent.startsWith('Round'), null, { timeout: 900000 });
await shot('06_ask', 4000);
await page.waitForFunction(() => document.getElementById('banner').classList.contains('stamp'), null, { timeout: 900000 });
await shot('07_answer_or_die', 300);
await shot('08_countdown', 15000);
await page.waitForFunction(() => document.querySelector('#dopts .opt.win'), null, { timeout: 900000 });
await shot('09_verdict', 8000);
await shot('10_exec', 20000);
await shot('11_after', 25000);
await shot('12_later', 40000);
clearInterval(steer);
// fast-forward: let everyone die quickly by standing still far away
await page.waitForFunction(() => document.getElementById('died').classList.contains('on') || document.getElementById('final').classList.contains('on'), null, { timeout: 2400000 }).catch(() => console.log('no game over yet'));
await shot('13_you_died', 20000);
await page.waitForFunction(() => document.getElementById('final').classList.contains('on'), null, { timeout: 900000 }).catch(() => { });
await shot('14_final', 1500);
await b.close(); srv.kill(); process.exit(0);
