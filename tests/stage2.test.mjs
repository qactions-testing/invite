// Tests de la etapa 2: campamento, trote, kit modular, mazmorra de cinco cuartos e invitación.
// Es además la prueba de juego completa: trampilla → llave → puerta → cofre → invitación → vencimiento.
// Uso: npm run build && npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, openGame } from '../tools/harness.mjs';
import { capture, SHOTS2 } from '../tools/screenshots.mjs';

let server, browser, page, errors;
const I = (fn, ...args) => page.evaluate(fn, ...args);
const state = () => page.evaluate(() => window.__invite.state());
const step = (sec, hz = 60) => page.evaluate(([s, h]) => window.__invite.step(s, h), [sec, hz]);
const EXPIRED = 'Tu invitación se autodestruyó. Para ir al casamiento, debes conseguirla nuevamente.';

before(async () => {
  server = await serve(4183);
  ({ browser, page, errors } = await openGame(server.url, { quality: 'low' }));
  await I(() => window.__invite.clearCard());
});
after(async () => { await browser?.close(); server?.stop(); });

test('campamento: carpa y ropa colgada con las dos remeras pedidas', async () => {
  const s = await state();
  const camp = s.places.find((p) => p.id === 'campamento');
  assert.ok(camp && camp.kind === 'natural', 'falta el campamento');
  for (const id of ['carpa', 'remera-amarilla', 'remera-centaura', 'mochila', 'guitarra']) assert.ok(s.scenes.bosque.includes(id), `falta ${id}`);
  await I(() => { const X = window.__invite, p = X.posOf('remera-centaura'); X.teleport({ x: p[0] + 1.2, z: p[2] + 1.2, scene: 'bosque' }); X.step(0.05); X.lookAt('remera-centaura'); X.step(0.1); });
  assert.equal((await state()).hover, 'remera-centaura');
  await page.keyboard.press('e');
  const r = (await state()).reader;
  assert.ok(r && /centaura/.test(r.title) && /cebra/.test(r.text) && /mujer/.test(r.text), JSON.stringify(r));
  await page.keyboard.press('Escape');
});

test('Shift hace trotar a 6 m/s; sin Shift se camina a 3 m/s', async () => {
  const run = async (shift) => {
    await I(() => { const X = window.__invite; X.teleport('fogata', 4, 1.5); X.look(X.state().yaw + Math.PI, 0); });
    const a = await state();
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.down('w'); await step(1); await page.keyboard.up('w');
    if (shift) await page.keyboard.up('Shift');
    const b = await state();
    return Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  };
  const walk = await run(false), trot = await run(true);
  assert.ok(Math.abs(walk - 3) < 0.15, `caminando: ${walk.toFixed(2)} m en 1 s`);
  assert.ok(Math.abs(trot - 6) < 0.3, `trotando: ${trot.toFixed(2)} m en 1 s`);
  assert.equal((await state()).speed, 3, 'al soltar Shift vuelve a 3 m/s');
});

test('el kit modular de Blender trae pared, arco, piso, escalera, puerta, antorcha y cofre, y la mazmorra lo usa', async () => {
  const kit = await I(() => fetch('assets/dungeon/kit.json').then((r) => r.json()));
  for (const p of ['wall', 'arch', 'floor', 'stairs', 'door', 'torch', 'chest_base', 'chest_lid', 'key']) assert.ok(kit.pieces.includes(p), `falta la pieza ${p}`);
  const { dungeon } = await state();
  assert.ok(dungeon, 'la mazmorra no cargó');
  for (const p of ['wall', 'arch', 'floor', 'torch']) assert.ok(dungeon.pieces.includes(p), `la mazmorra no usa ${p}`);
  assert.equal(dungeon.rooms.length, 5);
  assert.ok(dungeon.fog > 0.01 && dungeon.fog < 0.12, `niebla liviana (${dungeon.fog})`);
});

test('la trampilla de la casita de gnomos lleva a la mazmorra', async () => {
  await I(() => { const X = window.__invite; X.teleport('gnomos'); X.teleport({ x: -0.75, z: 0.45 }); X.step(0.05); X.lookAt('trampilla'); X.step(0.1); });
  let s = await state();
  assert.equal(s.hover, 'trampilla');
  await page.keyboard.press('e'); // primero se lee: cerrada con candado
  assert.match((await state()).reader.text, /Cerrada con candado/);
  await page.keyboard.press('e'); // al cerrar el mensaje llega "la señal"
  await step(0.1);
  s = await state();
  assert.equal(s.trapOpen, true);
  assert.match(await page.locator('#prompt').innerText(), /Bajar a la mazmorra/);
  await page.keyboard.press('e');
  await step(1);
  s = await state();
  assert.equal(s.scene, 'mazmorra');
  assert.equal(s.room, 0, 'se llega al primer cuarto');
});

test('cinco cuartos: el corredor de antorchas parpadea y lleva hasta la llave', async () => {
  let s = await state();
  const lights = [];
  for (let i = 0; i < 20; i++) { await step(0.05); lights.push((await state()).dungeon.torchLight[3]); }
  assert.ok(Math.max(...lights) / Math.min(...lights) > 1.15, 'las antorchas parpadean');
  assert.ok(s.dungeon.torches >= 6, `antorchas: ${s.dungeon.torches}`);
  assert.equal(await I(() => window.__invite.walkRoute('llave')), true);
  const visited = new Set([s.room]);
  s = await state();
  for (let i = 0; i < 80 && s.autoWalk; i++) { await step(0.5, 30); s = await state(); visited.add(s.room); }
  assert.equal(s.autoWalk, false, 'llega caminando hasta la llave');
  for (const r of [0, 1, 2, 3]) assert.ok(visited.has(r), `no pasó por el cuarto ${r + 1} (visitó ${[...visited]})`);
  assert.equal(s.hover, 'llave');
});

test('la puerta está cerrada hasta que se toma la llave; tomarla la abre', async () => {
  // de frente a la puerta cerrada: no se puede pasar
  await I(() => { const X = window.__invite; X.teleport({ scene: 'mazmorra', x: 4, z: 8.6, yaw: 0 }); X.look(0, 0); });
  await page.keyboard.down('w'); await step(3); await page.keyboard.up('w');
  let s = await state();
  assert.ok(s.pos[2] > 7.3 && s.room === 2, `no debería cruzar (z=${s.pos[2].toFixed(2)})`);
  assert.equal(s.dungeon.unlocked, false);
  await I(() => { window.__invite.lookAt('puerta-mazmorra'); window.__invite.step(0.1); });
  assert.equal((await state()).hover, 'puerta-mazmorra');
  await page.keyboard.press('e');
  assert.match(await page.locator('#toast').innerText(), /cerrada/i);
  // la llave
  await I(() => { const X = window.__invite; X.teleport({ scene: 'mazmorra', x: 14, z: 5.2, yaw: 0 }); X.step(0.05); X.lookAt('llave'); X.step(0.1); });
  assert.equal((await state()).hover, 'llave');
  await page.keyboard.press('e');
  await step(2);
  s = await state();
  assert.equal(s.dungeon.hasKey, true);
  assert.equal(s.dungeon.unlocked, true);
  assert.ok(s.dungeon.doorOpen > 0.95, `la puerta gira hasta abrirse (${s.dungeon.doorOpen})`);
  assert.ok(await page.locator('#inv-key').isVisible(), 'la llave aparece en el inventario');
});

test('llegar al cofre muestra "You found it!" y lo abre', async () => {
  await I(() => { const X = window.__invite; X.teleport({ scene: 'mazmorra', x: 4, z: 8.6, yaw: 0 }); X.look(0, 0); });
  // a 3 m/s se llega en ~2,3 s; el cartel dura 5 s de tiempo real, así que se mira enseguida
  // se camina de a pasos cortos hasta encontrarlo (con la suite en paralelo los eventos de teclado pueden llegar tarde)
  await page.keyboard.down('w');
  for (let i = 0; i < 20 && !(await state()).dungeon.found; i++) await step(0.2);
  await page.keyboard.up('w');
  await step(0.6);
  for (let i = 0; i < 10 && (await state()).dungeon.chestOpen <= 0.95; i++) await step(0.2);
  const s = await state();
  assert.equal(s.room, 4, `debería estar en la sala del tesoro (z=${s.pos[2].toFixed(2)})`);
  assert.equal(s.found, 'You found it!');
  assert.ok(await page.locator('#found').isVisible());
  assert.equal(s.dungeon.found, true);
  assert.ok(s.dungeon.chestOpen > 0.95);
});

test('tomar la invitación con click: suenan las trompetas y se abre con el texto exacto y el sello de lacre', async () => {
  const before = (await state()).audio.fanfares;
  await I(() => { window.__invite.lookAt('invitacion'); window.__invite.step(0.1); });
  assert.equal((await state()).hover, 'invitacion');
  assert.match(await page.locator('#prompt').innerText(), /Click o E/);
  await page.mouse.click(480, 270);
  const s = await state();
  assert.equal(s.dungeon.cardTaken, true);
  assert.equal(s.audio.fanfares, before + 1, 'trompetas de victoria');
  assert.ok(s.invitation, 'la invitación se abre en primera pantalla');
  for (const line of [
    'Invitación formal a la ceremonia pagana de Agustina y Gonzalo, reyes del mundo futuro, justos guerreros de la cofradía de los enamorados.',
    'Día: 13 de marzo de 2027', 'Hora: 4PM a 8PM', 'Lugar: Villa de mayo 378 - San Miguel, Provincia de Bvenos Ayres, Argentina.',
    'Coordenadas:', '34°31\'31.8" S', '58°42\'23.4" O',
    'Te esperamos, no invites a nadie, este encuentro es secreto y esta invitación se autodestruirá en 2 horas.',
  ]) assert.ok(s.invitation.includes(line), `falta en la invitación: ${line}`);
  assert.ok(await page.locator('#seal').isVisible(), 'sello de lacre visible');
  const seal = await page.locator('#seal').evaluate((el) => getComputedStyle(el).backgroundImage);
  assert.match(seal, /rgb\(109, 13, 26\)/, 'lacre rojo oscuro');
  const paper = await page.locator('#invitation .card').evaluate((el) => getComputedStyle(el).backgroundImage);
  assert.match(paper, /rgb\(241, 233, 214\)/, 'papel color ahuesado');
  assert.ok(s.card.leftMs > 7190000 && s.card.leftMs <= 7200000, 'quedan 2 horas');
  await page.keyboard.press('Escape');
  assert.equal((await state()).invitation, null);
  assert.ok(await page.locator('#inv-card').isVisible(), 'queda en el inventario con su cuenta regresiva');
  await page.keyboard.press('i');
  assert.ok((await state()).invitation, 'I la vuelve a abrir');
  await page.keyboard.press('i');
});

test('a las 2 horas la invitación se autodestruye, avisa y hay que conseguirla de nuevo', async () => {
  await I(() => window.__invite.advanceClock(2 * 3600 * 1000 - 5000));
  await step(0.1);
  let s = await state();
  assert.ok(s.card && s.card.leftMs < 6000, 'todavía la tiene, por segundos');
  assert.match(await page.locator('#inv-time').innerText(), /^0:00:0\d$/);
  await I(() => window.__invite.advanceClock(6000));
  await step(0.1);
  s = await state();
  assert.equal(s.card, null);
  assert.equal(s.notice, EXPIRED);
  assert.ok(await page.locator('#notice').isVisible());
  assert.deepEqual([s.dungeon.hasKey, s.dungeon.unlocked, s.dungeon.found, s.dungeon.cardTaken], [false, false, false, false], 'la mazmorra vuelve a empezar');
  assert.equal(await I(() => localStorage.getItem('invite.card.v1')), null);
  await page.keyboard.press('e');
  assert.equal((await state()).notice, null);
});

test('la invitación sobrevive a recargar la página mientras no venza', async () => {
  await I(() => { const X = window.__invite; X.dungeonAct('key'); X.step(0.1); X.teleport({ scene: 'mazmorra', x: 4, z: 3.6, yaw: 0 }); X.step(0.3); X.dungeonAct('card'); });
  assert.ok((await state()).card);
  assert.ok(await I(() => localStorage.getItem('invite.card.v1')), 'se guarda en el navegador');
  // una pestaña nueva del mismo navegador equivale a recargar: comparte el almacenamiento
  const again = await page.context().newPage();
  try {
    await again.goto(page.url(), { waitUntil: 'commit' });
    await again.waitForFunction(() => window.__invite?.ready, null, { timeout: 240000 });
    const s = await again.evaluate(() => { window.__invite.manual(true); return window.__invite.state(); });
    assert.ok(s.card && s.card.leftMs > 7000000, 'sigue en su poder');
    assert.equal(s.dungeon.unlocked, true, 'la puerta sigue abierta');
    assert.equal(s.dungeon.cardTaken, true, 'el cofre ya está vacío');
  } finally { await again.close(); }
  await page.keyboard.press('Escape');
  await I(() => window.__invite.clearCard());
});

test('los bombos de ceremonia crecen al acercarse a la invitación', async () => {
  await I(() => { const X = window.__invite; X.teleport({ scene: 'mazmorra', x: 6, z: 28, yaw: 0 }); X.step(3); });
  const far = (await state()).audio.drumLevel;
  await I(() => { const X = window.__invite; X.dungeonAct('key'); X.teleport({ scene: 'mazmorra', x: 4, z: 4.4, yaw: 0 }); X.step(3); });
  const near = (await state()).audio.drumLevel;
  assert.ok(far > 0.05 && far < 0.4, `lejos se oyen apenas (${far.toFixed(2)})`);
  assert.ok(near > far + 0.4, `cerca suenan fuerte (${far.toFixed(2)} → ${near.toFixed(2)})`);
  await page.waitForFunction(() => window.__invite.state().audio.drumHits >= 4, null, { timeout: 30000 });
  // en el bosque no suenan
  await I(() => { const X = window.__invite; X.clearCard(); X.teleport('fogata', 5, 1.5); X.step(4); });
  assert.ok((await state()).audio.drumLevel < 0.02);
});

test('por la escalera se vuelve a la casita de gnomos', async () => {
  await I(() => { const X = window.__invite; X.teleport({ scene: 'mazmorra', x: 6.3, z: 28, yaw: -1.57 }); X.step(0.05); X.lookAt('salida-mazmorra'); X.step(0.1); });
  assert.equal((await state()).hover, 'salida-mazmorra');
  await page.keyboard.press('e');
  await step(1);
  assert.equal((await state()).scene, 'gnomos');
  assert.deepEqual(errors, []);
  assert.deepEqual((await state()).errors, []);
});

test('capturas de la etapa 2: campamento, los cinco cuartos y la invitación', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'invite-shots2-'));
  const { shots } = await capture({ baseUrl: server.url, outDir: dir, quality: 'low', width: 640, height: 360, dpr: 1, shots: SHOTS2 });
  assert.equal(shots.length, SHOTS2.length);
  for (const s of shots) {
    assert.ok(existsSync(join(dir, s.file)) && statSync(join(dir, s.file)).size > 15000, `${s.id}: archivo vacío`);
    assert.ok(s.std > 6 && s.mean > 4, `${s.id}: imagen plana u oscura (media ${s.mean}, desvío ${s.std})`);
  }
});
