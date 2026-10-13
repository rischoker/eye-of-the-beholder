// UI proportions check at several screen shapes: question + countdown, eye close-up, final board + "Save this session".
// Usage: node tools/uicheck.mjs <outprefix>
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const PORT = 3113, OUT = process.argv[2] || 'ui';
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const sizes = (process.env.SIZES || '1280x720,1024x768').split(',').map(s => s.split('x').map(Number));
const players = ['Knight', 'Mage', 'Barbarian', 'Ranger', 'Rogue', 'Rogue_Hooded', 'Knight', 'Mage'].map((c, i) => ({ id: 'p' + i, name: ['Ana', 'Leo', 'Sofía', 'Mateo', 'Valen', 'Juan', 'Camila', 'Dani'][i], char: c, tint: i >= 6 ? 1 : 0, online: true }));
for (const [w, h] of sizes) {
  const tag = `${OUT}_${w}x${h}`;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${PORT}/?sim`);
  await page.waitForFunction('window.ready', null, { timeout: 240000 });
  await page.click('#open'); await page.waitForTimeout(1500);
  await page.evaluate(ps => ps.forEach(p => window.__eotb.onMsg({ t: 'player_join', p })), players);
  await page.evaluate(ps => window.__eotb.onMsg({ t: 'intro', short: true, players: ps, level: 'B1' }), players);
  await page.waitForTimeout(500);
  await page.evaluate(ps => {
    const E = window.__eotb;
    E.onMsg({ t: 'pos', p: ps.map((p, i) => [p.id, -5 + i * 1.4, 3 + (i % 2) * .6, Math.PI, 1, 0]) });
    E.boss.root.parent.userData.key.intensity = 260;
    E.onMsg({ t: 'ask', secs: 10, round: 7, level: 'B2', part: 'Grammar', prompt: 'If I had known about the traffic, I ___ earlier so that I would not have missed the beginning of the meeting.', circles: [{ x: -4.2, z: 1.2, r: 1, color: '#e8423a', letter: 'A', text: 'would have left' }, { x: -1.4, z: 3.6, r: 1, color: '#3a8ee8', letter: 'B', text: 'had left' }, { x: 1.4, z: 3.6, r: 1, color: '#3fd46b', letter: 'C', text: 'will leave' }, { x: 4.2, z: 1.2, r: 1, color: '#f2c230', letter: 'D', text: 'would leave' }], alive: 8 });
    const r = E.boss.root.parent; r.visible = true; r.position.set(0, 5.9, -10.5);
  }, players);
  await page.waitForTimeout(3000);
  // show the full question + options + a countdown number without waiting for the growl
  await page.evaluate(() => {
    document.getElementById('dtxt').textContent = 'If I had known about the traffic, I ___ earlier so that I would not have missed the beginning of the meeting.';
    document.getElementById('dopts').innerHTML = [['#e8423a', 'A', 'would have left'], ['#3a8ee8', 'B', 'had left'], ['#3fd46b', 'C', 'will leave'], ['#f2c230', 'D', 'would leave']].map(([c, l, t]) => `<div class="opt"><b style="background:${c};color:${c}"><span style="color:#160b0b">${l}</span></b>${t}</div>`).join('');
    const el = document.getElementById('countdown'); el.textContent = '10'; el.style.opacity = 1;
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${tag}_count.png` });
  await page.evaluate(() => { document.getElementById('countdown').style.opacity = ''; const E = window.__eotb; E.S.cam.pos.set(0, 6.5, -2); E.S.cam.look.set(0, 6.0, -10.5); E.boss.setEmotion('neutral', 20); document.getElementById('dialog').classList.remove('on'); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${tag}_eye.png` });
  await page.evaluate(() => {
    const E = window.__eotb; E.S.cam.pos.set(0, 9.2, 17.2); E.S.cam.look.set(0, 2.6, -1.5);
    const parts = (a, b) => [{ name: 'Grammar', ok: a, n: 3, level: 'B1' }, { name: 'Vocabulary', ok: b, n: 2, level: 'B1' }];
    const names = ['Ana', 'Leo', 'Sofía', 'Mateo', 'Valen', 'Juan', 'Camila', 'Dani'], ch = ['Knight', 'Mage', 'Barbarian', 'Ranger', 'Rogue', 'Rogue_Hooded', 'Knight', 'Mage'];
    const ranking = names.map((n, i) => ({ rank: i + 1, id: 'p' + i, name: n, char: ch[i], tint: i >= 6 ? 1 : 0, points: 210 - i * 25, round: 8 - (i >> 1), correct: 7 - (i >> 1), answered: 7, parts: parts(3 - (i % 3), 2 - (i % 2)) }));
    const qs = ['She has lived in Bogotá ___ 2015.', 'I wish I ___ more time to study for the exam yesterday.', 'Choose the word that means "very tired".', 'By the time we arrived, the film ___.', 'He suggested ___ to the museum on Sunday.', 'The report ___ by the manager before the meeting.', 'Not only ___ late, but he also forgot the documents needed for the presentation to the board of directors.'];
    const log = qs.map((q, i) => ({ round: i + 1, level: i < 3 ? 'B1' : 'B2', part: i % 2 ? 'Grammar' : 'Vocabulary', prompt: q, answer: ['since', 'had had', 'exhausted', 'had started', 'going', 'had been read', 'was he'][i], ok: names.slice(0, 8 - i), ko: i ? names.slice(8 - i, 9 - i) : [] }));
    E.renderFinal({ ranking, level: 'B1', rounds: 7, log, date: new Date().toISOString() });
    document.getElementById('final').classList.add('on');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${tag}_final.png` });
  const dl = page.waitForEvent('download', { timeout: 240000 });
  await page.click('#saveShot');
  const d = await dl; await d.saveAs(`${tag}_saved.png`); console.log('saved', d.suggestedFilename());
  await ctx.close();
}
await b.close(); srv.kill(); process.exit(0);
