// Tests de la etapa 1: el bosque, sus 3 espacios naturales y sus 3 salas.
// Corren contra el build (dist/) servido por `vite preview`, en Chromium con WebGL por software.
// Uso: npm run build && npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, openGame, frameStats } from '../tools/harness.mjs';
import { capture, SHOTS } from '../tools/screenshots.mjs';

let server, browser, page, errors;
const I = (fn, ...args) => page.evaluate(fn, ...args);
const state = () => page.evaluate(() => window.__invite.state());
const step = (sec, hz = 60) => page.evaluate(([s, h]) => window.__invite.step(s, h), [sec, hz]);

before(async () => {
  server = await serve(4173);
  ({ browser, page, errors } = await openGame(server.url, { quality: 'low' }));
});
after(async () => { await browser?.close(); server?.stop(); });

test('carga sin errores y dibuja el bosque', async () => {
  await step(0.5);
  const s = await state();
  assert.equal(s.started, true);
  assert.equal(s.scene, 'bosque');
  assert.deepEqual(s.errors, []);
  assert.deepEqual(errors, []);
  const f = await frameStats(page);
  assert.ok(f.std > 12, `la imagen no debería ser plana (desvío ${f.std.toFixed(1)})`);
  assert.ok(f.mean > 25 && f.mean < 235, `brillo medio razonable (${f.mean.toFixed(1)})`);
});

test('el mapa tiene la forma del Cono Sur y mide entre 300 y 500 m', async () => {
  const { world } = await state();
  const long = Math.max(world.widthM, world.heightM);
  assert.ok(long >= 300 && long <= 500, `dimensión mayor ${long.toFixed(0)} m`);
  assert.ok(world.heightM > world.widthM * 1.8, 'más alto (N-S) que ancho, como el Cono Sur');
  const outline = await I(() => fetch('assets/outline.json').then((r) => r.json()));
  for (const c of ['Argentina', 'Chile', 'Uruguay', 'Paraguay']) assert.ok(outline.countries[c]?.length, `falta ${c}`);
});

test('más de 150 árboles y plantas, un río grande, tres arroyos y aves sudamericanas', async () => {
  const { world } = await state();
  assert.ok(world.trees > 150, `árboles: ${world.trees}`);
  assert.ok(world.plants > 150, `plantas: ${world.plants}`);
  assert.equal(world.rivers.filter((r) => r.main).length, 1);
  assert.equal(world.rivers.filter((r) => !r.main).length, 3);
  for (const r of world.rivers) assert.ok(r.length > 30, `${r.name} es demasiado corto`);
  assert.ok(world.birds.length >= 5, `especies de aves: ${world.birds.join(', ')}`);
  for (const b of ['hornero', 'benteveo', 'cóndor']) assert.ok(world.birds.includes(b), `falta ${b}`);
  assert.ok(world.fish >= 10, 'peces en el estanque');
});

test('cada lugar tiene nombre: espacios naturales y tres salas, con cada objeto en su lugar', async () => {
  const s = await state();
  // etapa 1: estanque, fogata, cueva + tres salas; la etapa 2 suma el campamento
  for (const id of ['estanque', 'fogata', 'cueva', 'cana', 'abuelas', 'gnomos']) assert.ok(s.places.some((p) => p.id === id), `falta ${id}`);
  assert.ok(s.places.filter((p) => p.kind === 'natural').length >= 3);
  assert.equal(s.places.filter((p) => p.kind === 'sala').length, 3);
  for (const p of s.places) {
    assert.ok(p.name.length > 5, `nombre de ${p.id}`);
    assert.ok(s.scenes[p.scene], `la escena ${p.scene} no cargó`);
    for (const o of p.objects) assert.ok(s.scenes[p.scene].includes(o), `${o} no está en ${p.scene}`);
    if (p.kind === 'sala') assert.ok(s.scenes.bosque.includes(`puerta-${p.id}`), `falta la puerta de ${p.id} en el bosque`);
  }
});

async function walk(key, seconds) {
  const a = await state();
  await page.keyboard.down(key);
  await step(seconds);
  await page.keyboard.up(key);
  const b = await state();
  return { dist: Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]), a, b };
}

test('se camina a 1 m/s con WASD y con las flechas', async () => {
  for (const [fwd, back] of [['w', 's'], ['ArrowUp', 'ArrowDown']]) {
    // claro de la fogata: de 4 m a 9 m del fuego, hacia afuera
    await I(() => { const X = window.__invite; X.teleport('fogata', 4, 1.5); X.look(X.state().yaw + Math.PI, 0); });
    const out = await walk(fwd, 5);
    assert.ok(Math.abs(out.dist - 5) < 0.25, `${fwd}: ${out.dist.toFixed(2)} m en 5 s`);
    const ret = await walk(back, 3);
    assert.ok(Math.abs(ret.dist - 3) < 0.15, `${back}: ${ret.dist.toFixed(2)} m en 3 s`);
  }
  for (const key of ['a', 'd', 'ArrowLeft', 'ArrowRight']) {
    await I(() => { const X = window.__invite; X.teleport('fogata', 6, 1.5); X.look(X.state().yaw + Math.PI, 0); });
    const side = await walk(key, 2);
    assert.ok(Math.abs(side.dist - 2) < 0.12, `${key}: ${side.dist.toFixed(2)} m en 2 s`);
  }
});

test('mirar un objeto y apretar E abre su mensaje en el lector; Esc lo cierra', async () => {
  await I(() => { const X = window.__invite; X.teleport('piedra-fogon', 1.5, 3.6); X.step(0.05); X.lookAt('piedra-fogon'); X.step(0.1); });
  let s = await state();
  assert.equal(s.hover, 'piedra-fogon');
  assert.match(await page.locator('#prompt').innerText(), /E — Leer: Piedra del fogón/);
  await page.keyboard.press('e');
  s = await state();
  assert.ok(s.reader, 'el lector debería estar abierto');
  assert.equal(s.reader.title, 'Piedra del fogón');
  assert.match(s.reader.text, /chispa/);
  assert.ok(await page.locator('#reader').isVisible());
  assert.equal(await page.locator('#reader-place').innerText(), 'FOGATA DE LOS NOVIOS');
  await page.keyboard.press('Escape');
  assert.equal((await state()).reader, null);
  assert.ok(!(await page.locator('#reader').isVisible()));
});

test('M abre y cierra el mapa del bosque', async () => {
  await page.keyboard.press('m');
  assert.equal((await state()).map, true);
  assert.ok(await page.locator('#map').isVisible());
  const colors = await I(() => {
    const c = document.getElementById('map-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, set = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) set.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4));
    return set.size;
  });
  assert.ok(colors > 12, `el mapa debería tener tierra, mar, ríos y lugares (colores: ${colors})`);
  await page.keyboard.press('m');
  assert.equal((await state()).map, false);
});

test('Ctrl+F busca entre todos los objetos y camina hasta el elegido (entrando a su sala)', async () => {
  await I(() => window.__invite.teleport('cana', 13, 2.2)); // en el bosque, a 13 m del árbol gigante
  const t0 = await state();
  assert.equal(t0.scene, 'bosque');
  await page.keyboard.press('Control+f');
  assert.equal((await state()).search, true);
  const total = await page.locator('#results li').count();
  assert.ok(total >= 23 + 6, `el buscador lista todos los objetos y lugares (${total})`);
  await page.keyboard.type('mate gall');
  assert.equal(await page.locator('#results li').count(), 1);
  assert.match(await page.locator('#results li').first().innerText(), /mate galleta/i);
  await page.keyboard.press('Enter');
  let s = await state();
  assert.equal(s.search, false);
  assert.equal(s.walking, true);
  for (let i = 0; i < 40 && s.walking; i++) { await step(5, 30); s = await state(); }
  assert.equal(s.walking, false, 'debería haber llegado');
  assert.equal(s.scene, 'cana');
  assert.equal(s.hover, 'mate', 'termina mirando el mate');
  const elapsed = s.t - t0.t, walked = s.walked - t0.walked;
  assert.ok(walked > 10, `caminó ${walked.toFixed(1)} m`);
  assert.ok(walked <= elapsed * 1.0 + 0.2, `nunca supera 1 m/s (${walked.toFixed(1)} m en ${elapsed.toFixed(1)} s)`);
  // una tecla de movimiento cancela la caminata automática
  await I(() => window.__invite.walkTo('piedra-ronda'));
  await step(1);
  assert.equal((await state()).walking, true);
  await page.keyboard.down('w'); await step(0.2); await page.keyboard.up('w');
  assert.equal((await state()).walking, false);
});

test('el fuego parpadea, el agua se mueve y las abuelas largan corazones', async () => {
  await I(() => window.__invite.teleport('fogata', 5, 1.5));
  const lights = [], t0 = (await state()).waterTime;
  for (let i = 0; i < 24; i++) { await step(0.05); lights.push((await state()).fireLight); }
  const min = Math.min(...lights), max = Math.max(...lights);
  assert.ok(min > 0 && max / min > 1.15, `la luz de la fogata varía (${min.toFixed(1)}–${max.toFixed(1)})`);
  assert.ok((await state()).waterTime > t0 + 1, 'el tiempo del shader de agua avanza');
  await I(() => window.__invite.teleport('gnomos'));
  const room = [];
  for (let i = 0; i < 24; i++) { await step(0.05); room.push((await state()).roomFire); }
  assert.ok(Math.max(...room) / Math.min(...room) > 1.15, 'la capa horneada de fuego parpadea en la sala');
  await I(() => window.__invite.teleport('abuelas'));
  await step(3);
  const s = await state();
  assert.equal(s.scene, 'abuelas');
  assert.ok(s.hearts >= 3, `corazones vivos: ${s.hearts}`);
});

test('el audio sintetizado suena: guitarra, banjo y cantos de aves', async () => {
  await page.waitForFunction(() => { const a = window.__invite.state().audio; return a.context === 'running' && a.notes > 12 && a.birdCalls >= 1 && a.banjoNotes >= 1; }, null, { timeout: 30000 });
  const { audio } = await state();
  assert.equal(audio.context, 'running');
  assert.ok(audio.notes > 12 && audio.banjoNotes >= 1 && audio.birdCalls >= 1, JSON.stringify(audio));
});

test('capturas de los seis lugares: se generan y ninguna queda negra o plana', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'invite-shots-'));
  const { shots } = await capture({ baseUrl: server.url, outDir: dir, quality: 'low', width: 640, height: 360, dpr: 1 });
  assert.equal(shots.length, SHOTS.length);
  for (const id of ['estanque', 'fogata', 'cueva', 'cana', 'abuelas', 'gnomos']) {
    const s = shots.find((q) => q.id === id);
    assert.ok(s, `falta la captura de ${id}`);
    assert.ok(existsSync(join(dir, s.file)) && statSync(join(dir, s.file)).size > 20000, `${id}: archivo vacío`);
    assert.ok(s.std > 10 && s.mean > 8, `${id}: imagen plana u oscura (media ${s.mean}, desvío ${s.std})`);
  }
});
