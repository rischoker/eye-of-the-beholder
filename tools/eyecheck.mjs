// Quick framing check: fake players + a fake question, no full flow.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const PORT = 3112;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.addInitScript(() => { window.__capture = true; });
await page.goto(`http://localhost:${PORT}/?sim`);
await page.waitForFunction('window.ready', null, { timeout: 240000 });
await page.click('#open');
await page.waitForTimeout(1500);
const players = ['Knight', 'Mage', 'Barbarian', 'Ranger', 'Rogue', 'Rogue_Hooded', 'Knight', 'Mage'].map((c, i) => ({ id: 'p' + i, name: ['Ana', 'Leo', 'Sofía', 'Mateo', 'Valen', 'Juan', 'Camila', 'Dani'][i], char: c, tint: i >= 6 ? 1 : 0, online: true }));
await page.evaluate(ps => ps.forEach(p => window.__eotb.onMsg({ t: 'player_join', p })), players);
await page.waitForTimeout(6000);
await page.screenshot({ path: process.argv[2] + '_lobby.png' });
await page.evaluate(ps => {
  const E = window.__eotb; E.onMsg({ t: 'intro', short: true, players: ps, level: 'A1' });
}, players);
await page.waitForTimeout(500);
await page.evaluate(ps => {
  const E = window.__eotb;
  E.onMsg({ t: 'pos', p: ps.map((p, i) => [p.id, -4.2 + (i % 4) * .35 - .5, 1.2 + (i >> 2) * .5 - .3, Math.PI, 1, 0]) }); setTimeout(() => [...E.heroes.values()].forEach((h, i) => i < 3 && h.say(['Here! Here!', 'Hurry!', 'Are you sure?'][i], 9000)), 300);
  E.boss.root.parent.userData.key.intensity = 260; E.onMsg({ t: 'ask', round: 3, level: 'A2', part: 'Vocabulary', prompt: 'You can borrow books from the ___.', circles: [{ x: -4.2, z: 1.2, r: 1, color: '#e8423a', letter: 'A', text: 'library' }, { x: -1.4, z: 3.6, r: 1, color: '#3a8ee8', letter: 'B', text: 'bakery' }, { x: 1.4, z: 3.6, r: 1, color: '#3fd46b', letter: 'C', text: 'garage' }, { x: 4.2, z: 1.2, r: 1, color: '#f2c230', letter: 'D', text: 'stadium' }], alive: 8 });
  const r = E.boss.root.parent; r.visible = true; r.position.set(0, 6.4, -10.5);
}, players);
await page.waitForTimeout(9000);
await page.evaluate(() => { const E = window.__eotb; E.S.cam.pos.set(0, 6.5, -2); E.S.cam.look.set(0, 6.0, -10.5); E.boss.setEmotion('happy', 20); E.boss.laugh(8); });
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[2] + '_eye.png' });
await b.close(); srv.kill(); process.exit(0);
