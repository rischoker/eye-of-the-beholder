// Quick framing check: fake players + a fake question, no full flow.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const PORT = 3112;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', e => console.log('[pageerror]', e.message)); page.on('console', m => console.log('[console]', m.text().slice(0, 200)));
await page.addInitScript(() => { window.__capture = true; });
await page.goto(`http://localhost:${PORT}/?sim`);
await page.waitForFunction('window.ready', null, { timeout: 240000 });
await page.click('#open');
await page.waitForTimeout(1500);
const simWait = async sec => { const t0 = await page.evaluate(() => window.__eotb.dbg().simNow); while ((await page.evaluate(() => window.__eotb.dbg().simNow)) < t0 + sec) await page.waitForTimeout(500); };
const players = ['Knight', 'Mage', 'Barbarian', 'Ranger', 'Rogue', 'Rogue_Hooded', 'Knight', 'Mage'].map((c, i) => ({ id: 'p' + i, name: ['Ana', 'Leo', 'Sofía', 'Mateo', 'Valen', 'Juan', 'Camila', 'Dani'][i], char: c, tint: i >= 6 ? 1 : 0, online: true }));
await page.evaluate(ps => ps.forEach(p => window.__eotb.onMsg({ t: 'player_join', p })), players);
await simWait(1);
await page.screenshot({ path: process.argv[2] + '_lobby.png' });
await page.evaluate(ps => {
  const E = window.__eotb; E.onMsg({ t: 'intro', short: true, players: ps, level: 'A1' });
}, players);
await page.waitForTimeout(500);
await page.evaluate(ps => {
  const E = window.__eotb;
  E.onMsg({ t: 'pos', p: ps.map((p, i) => [p.id, -5 + i * 1.4, 2 + (i % 3) * 1.3, Math.PI, 1, 0]) });
  E.boss.root.parent.userData.key.intensity = 260; E.onMsg({ t: 'ask', round: 3, level: 'A2', part: 'Vocabulary', prompt: 'You can borrow books from the ___.', circles: [{ x: -4.2, z: 1.2, r: .72, color: '#e8423a', letter: 'A', text: 'library' }, { x: -1.4, z: 3.6, r: .72, color: '#3a8ee8', letter: 'B', text: 'bakery' }, { x: 1.4, z: 3.6, r: .72, color: '#3fd46b', letter: 'C', text: 'garage' }, { x: 4.2, z: 1.2, r: .72, color: '#f2c230', letter: 'D', text: 'stadium' }], alive: 8 });
  const r = E.boss.root.parent; r.visible = true; r.position.set(0, 6.4, -10.5);
}, players);
await simWait(6);
await page.evaluate(() => window.__eotb.onMsg({ t: 'countdown', secs: 5 }));
await simWait(2.5);
await page.screenshot({ path: process.argv[2] + '_count.png' });
await simWait(3);
await page.evaluate(ps => {
  const E = window.__eotb, pos = ps.map((p, i) => [p.id, -5 + i * 1.4, 2 + (i % 3) * 1.3, Math.PI, 1, 0]);
  E.onMsg({ t: 'verdict', correct: 0, correctText: 'library', dead: [{ id: 'p0' }, { id: 'p2' }, { id: 'p4' }, { id: 'p5' }], surv: ['p1', 'p3', 'p6', 'p7'], players: ps, pos });
}, players);
for (const [n, w] of [['v1', 1.6], ['v2', 1.0], ['v3', 1.2], ['v4', 3.5]]) { await simWait(w); await page.screenshot({ path: process.argv[2] + '_' + n + '.png' }); }
await page.evaluate(ps => window.__eotb.onMsg({ t: 'over', level: 'A1', rounds: 6, ranking: ps.map((p, i) => ({ ...p, rank: i + 1, points: 120 - i * 15, round: 7 - (i >> 1), correct: 6 - (i >> 1), answered: 7 - (i >> 1), parts: [{ name: 'Vocabulary', ok: 3, n: 3, level: 'A1' }, { name: 'Grammar', ok: 1, n: 3, level: 'A2' }] })) }), players);
await simWait(4); await page.screenshot({ path: process.argv[2] + '_died.png' });
await page.waitForTimeout(25000); await page.screenshot({ path: process.argv[2] + '_final.png' });
await b.close(); srv.kill(); process.exit(0);
