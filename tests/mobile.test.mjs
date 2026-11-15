// Celular: joystick y botones con texto solo en pantallas táctiles, mirar deslizando, zoom con pellizco,
// paneles que se cierran con un toque, y la misma disposición usable en vertical y en horizontal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serve, openGame, frameStats } from '../tools/harness.mjs';

let server, browser, page, errors, cdp;
before(async () => {
  server = await serve(4176);
  ({ browser, page, errors } = await openGame(server.url, { quality: 'low', mobile: true, width: 390, height: 844 }));
  cdp = await page.context().newCDPSession(page);
});
after(async () => { await browser?.close(); server?.stop(); });

const I = (fn, arg) => page.evaluate(fn, arg);
const S = () => I(() => window.__invite.state());
const box = (sel) => I((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
/** toques reales (CDP): el navegador genera los pointer events como en un celular */
// touchStart/Move: dedos presentes; touchEnd: dedos que se levantan ([] = todos). [x, y, id?]
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id], i) => ({ x, y, id: id ?? i })) });
const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); };
const tapSel = async (sel) => { const b = await box(sel); await tap(b.cx, b.cy); };
const settle = () => page.waitForTimeout(450); // el mismo toque que abre un panel no lo cierra

test('en el celular aparecen el joystick y los botones con texto, 70 % transparentes', async () => {
  const s = await S();
  assert.equal(s.touch, true);
  assert.equal(await I(() => matchMedia('(pointer: coarse)').matches), true, 'el emulador debería ser táctil');
  assert.equal(await I(() => getComputedStyle(document.getElementById('touch')).display), 'block');
  assert.equal(await I(() => getComputedStyle(document.getElementById('stick')).opacity), '0.3');
  const labels = await I(() => [...document.querySelectorAll('#tbtns button')].map((b) => b.textContent));
  assert.deepEqual(labels, ['Leer', 'Trotar', 'Mapa', 'Buscar', 'Invitación', 'Cerrar']);
  assert.equal(await I(() => getComputedStyle(document.querySelector('#tbtns button')).opacity), '0.3');
  const stick = await box('#stick'), btns = await box('#tbtns');
  assert.ok(stick.cx < 195 && btns.cx > 195, 'joystick a la izquierda, botones a la derecha');
  assert.equal(await I(() => getComputedStyle(document.getElementById('hint')).display), 'none', 'sin pistas de teclado');
  assert.equal(await I(() => document.querySelector('#tbtns [data-a=card]').classList.contains('off')), true, 'Invitación oculto sin invitación');
});

test('en la compu no aparecen los controles táctiles', async () => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const p = await ctx.newPage();
  await p.goto(`${server.url}?quality=low`);
  await p.waitForLoadState('load');
  assert.equal(await p.evaluate(() => document.body.classList.contains('touch')), false);
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('touch')).display), 'none');
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('hint')).display), 'block');
  await ctx.close();
});

test('el joystick camina a 3 m/s y con Trotar a 6 m/s', async () => {
  await I(() => { const X = window.__invite; X.teleport('fogata', 4, 1.5); X.look(X.state().yaw + Math.PI, 0); X.step(0.05); });
  const st = await box('#stick');
  await touch('touchStart', [[st.cx, st.cy]]);
  await touch('touchMove', [[st.cx, st.cy - 60]]);
  const a = await S();
  await I(() => window.__invite.step(1));
  const b = await S();
  const d = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  assert.ok(Math.abs(d - 3) < 0.15, `caminó ${d.toFixed(2)} m en 1 s`);
  // hacia adelante: la dirección del movimiento coincide con la mirada
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  assert.ok(((b.pos[0] - a.pos[0]) * fx + (b.pos[2] - a.pos[2]) * fz) / d > 0.97, 'avanza hacia donde mira');
  // segundo dedo: Trotar, sin soltar el joystick
  const run = await box('#tbtns [data-a=run]');
  await touch('touchStart', [[st.cx, st.cy - 60], [run.cx, run.cy]]);
  await touch('touchEnd', [[run.cx, run.cy, 1]]); // se levanta solo el segundo dedo
  assert.equal((await S()).run, true);
  await I(() => window.__invite.step(1));
  const c = await S();
  const d2 = Math.hypot(c.pos[0] - b.pos[0], c.pos[2] - b.pos[2]);
  assert.ok(Math.abs(d2 - 6) < 0.3, `trotó ${d2.toFixed(2)} m en 1 s`);
  await touch('touchEnd', []);
  await I(() => window.__invite.step(0.5));
  const e = await S();
  assert.ok(Math.hypot(e.pos[0] - c.pos[0], e.pos[2] - c.pos[2]) < 0.01, 'al soltar el joystick se detiene');
  await tapSel('#tbtns [data-a=run]');
  assert.equal((await S()).run, false, 'Trotar se apaga con otro toque');
});

test('deslizar el dedo gira la vista y pellizcar hace zoom', async () => {
  const y0 = (await S()).yaw;
  await touch('touchStart', [[150, 300]]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[150 + i * 20, 300]]);
  await touch('touchEnd', []);
  const y1 = (await S()).yaw;
  assert.ok(y0 - y1 > 0.3, `deslizar a la derecha gira a la derecha (${(y0 - y1).toFixed(2)} rad)`);
  const f0 = (await S()).fov;
  await touch('touchStart', [[150, 420], [240, 420]]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[150 - i * 12, 420], [240 + i * 12, 420]]);
  await touch('touchEnd', []);
  const f1 = (await S()).fov;
  assert.ok(f1 < f0 - 10, `abrir los dedos acerca (fov ${f0} → ${f1.toFixed(1)})`);
  await touch('touchStart', [[90, 420], [300, 420]]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[90 + i * 20, 420], [300 - i * 20, 420]]);
  await touch('touchEnd', []);
  assert.ok((await S()).fov > f1 + 10, 'cerrar los dedos aleja');
  assert.equal(await I(() => document.scrollingElement.scrollTop + window.visualViewport.offsetTop), 0, 'la página no se desplaza');
});

test('tocar un objeto abre su mensaje; los paneles se cierran con un toque', async () => {
  // lector: tocar lo que se mira
  await I(() => { const X = window.__invite; X.teleport('piedra-fogon', 1.5, 3.6); X.step(0.05); X.lookAt('piedra-fogon'); X.step(0.1); });
  assert.match(await page.locator('#prompt').innerText(), /^Tocá · Leer: Piedra del fogón/);
  await tap(195, 422);
  await I(() => window.__invite.step(0.02));
  assert.equal((await S()).reader?.title, 'Piedra del fogón');
  assert.equal(await I(() => getComputedStyle(document.getElementById('stick')).display), 'none', 'con un panel abierto solo queda Cerrar');
  await settle(); await tap(195, 300);
  assert.equal((await S()).reader, null, 'un toque cierra el lector');
  // botón Leer
  await I(() => window.__invite.step(0.05));
  await tapSel('#tbtns [data-a=read]');
  assert.ok((await S()).reader, 'Leer abre el mensaje');
  await settle(); await tapSel('#tbtns [data-a=close]');
  assert.equal((await S()).reader, null, 'Cerrar cierra el lector');
  // mapa
  await tapSel('#tbtns [data-a=map]');
  assert.equal((await S()).map, true);
  await settle(); await tap(195, 18); // fuera de la hoja (tocar un lugar del mapa viaja)
  assert.equal((await S()).map, false, 'un toque cierra el mapa');
  assert.equal((await S()).travelling, false, 'cerrar no viaja');
  // buscador: se cierra tocando afuera de la caja
  await tapSel('#tbtns [data-a=search]');
  assert.equal((await S()).search, true);
  await settle(); await tap(195, 50);
  assert.equal((await S()).search, false, 'un toque afuera cierra el buscador');
  // buscador: tocar un resultado camina hasta ahí
  await tapSel('#tbtns [data-a=search]');
  await page.locator('#search-input').fill('mate galleta');
  await settle(); await tapSel('#results li');
  assert.equal((await S()).travelling, true, 'tocar un resultado empieza el viaje rápido');
  await page.waitForFunction(() => !window.__invite.state().travelling, null, { timeout: 60000 });
  assert.equal((await S()).scene, 'cana', 'llega a la sala del mate');
  // tocar un lugar del mapa también viaja
  await tapSel('#tbtns [data-a=map]');
  await settle();
  const pt = await I(() => window.__invite.mapPoint('fogata'));
  await tap(pt.x, pt.y);
  assert.equal((await S()).travelling, true, 'tocar un lugar del mapa viaja');
  await page.waitForFunction(() => !window.__invite.state().travelling, null, { timeout: 60000 });
  assert.equal((await S()).scene, 'bosque');
  // invitación
  await I(() => { const X = window.__invite; X.clearCard(); X.dungeonAct('key'); X.step(2); X.teleport({ scene: 'mazmorra', x: 4, z: 4.4, yaw: 0 }); X.step(2.2); X.dungeonAct('card'); X.step(0.1); });
  assert.ok((await S()).invitation, 'la invitación se abre');
  await settle(); await tap(195, 422);
  assert.equal((await S()).invitation, null, 'un toque guarda la invitación');
  await I(() => window.__invite.step(0.05));
  assert.equal(await I(() => document.querySelector('#tbtns [data-a=card]').classList.contains('off')), false, 'con invitación aparece el botón');
  await tapSel('#tbtns [data-a=card]');
  assert.ok((await S()).invitation, 'el botón Invitación la vuelve a abrir');
  await settle(); await tapSel('#tbtns [data-a=close]');
  assert.equal((await S()).invitation, null);
  await I(() => { const X = window.__invite; X.clearCard(); X.step(0.05); });
});

test('en horizontal los controles entran en pantalla y siguen funcionando', async () => {
  await page.setViewportSize({ width: 844, height: 390 });
  await I(() => { const X = window.__invite; X.teleport('fogata', 4, 1.5); X.look(X.state().yaw + Math.PI, 0); X.step(0.05); });
  const st = await box('#stick'), bt = await box('#tbtns');
  for (const r of [st, bt]) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 844 && r.y + r.h <= 390, `dentro de la pantalla: ${JSON.stringify(r)}`);
  assert.ok(st.x + st.w < bt.x, 'joystick y botones no se pisan');
  await touch('touchStart', [[st.cx, st.cy]]);
  await touch('touchMove', [[st.cx, st.cy - 50]]);
  const a = await S();
  await I(() => window.__invite.step(1));
  const b = await S();
  await touch('touchEnd', []);
  const d = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  assert.ok(Math.abs(d - 3) < 0.15, `caminó ${d.toFixed(2)} m en 1 s`);
  await tapSel('#tbtns [data-a=map]');
  assert.equal((await S()).map, true);
  const map = await box('#map .sheet');
  assert.ok(map.y >= 0 && map.y + map.h <= 390, 'el mapa entra en la pantalla horizontal');
  await settle(); await tap(60, 60); // fuera de la hoja
  assert.equal((await S()).map, false);
  await page.setViewportSize({ width: 390, height: 844 });
});

test('capturas del celular en vertical y horizontal', async () => {
  const dir = join(ROOT, 'screenshots/mobile');
  mkdirSync(dir, { recursive: true });
  for (const [name, w, h] of [['vertical', 390, 844], ['horizontal', 844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await I(() => { const X = window.__invite; X.teleport('fogata', 5.6, 1.5); X.portraits(1); X.look(X.state().yaw, 0.03); X.step(1); });
    const st = await frameStats(page);
    assert.ok(st.mean > 40 && st.std > 10, `${name}: la escena se ve (brillo ${st.mean.toFixed(0)})`);
    await page.screenshot({ path: join(dir, `${name}.jpg`), type: 'jpeg', quality: 85 });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(errors, []);
});
