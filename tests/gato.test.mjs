// El gato tuxedo que acompaña, el inicio en el extremo norte, el mapa con puntero propio,
// el limitador de audio y los textos pedidos (tronco de Gonzalo y menú de inicio).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve, openGame } from '../tools/harness.mjs';

let server, browser, page, errors;
before(async () => {
  server = await serve(4183);
  ({ browser, page, errors } = await openGame(server.url, { quality: 'low', width: 960, height: 540 }));
});
after(async () => { await browser?.close(); server?.stop(); });

const S = () => page.evaluate(() => window.__invite.state());
const step = (s) => page.evaluate((x) => window.__invite.step(x), s);

test('se empieza en el extremo norte (Paraguay), mirando al sur-sudeste hacia la Caña Fístula', async () => {
  const s = await S();
  assert.equal(s.scene, 'bosque');
  const north = Math.min(...s.places.map((p) => p.z));
  assert.ok(s.pos[2] < north - 20, `al norte de todos los lugares (z ${s.pos[2].toFixed(0)} vs ${north.toFixed(0)})`);
  const cana = s.places.find((p) => p.id === 'cana'), d = Math.hypot(cana.x - s.pos[0], cana.z - s.pos[2]);
  assert.ok(d > 30 && d < 70, `a ${d.toFixed(0)} m de la Caña Fístula`);
  assert.ok(Math.abs(s.yaw - -2.81) < 0.05, `mirando al sur-sudeste (yaw ${s.yaw.toFixed(2)})`);
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  assert.ok(fz > 0.9 && fx > 0.2, 'hacia el sur, un poco al este');
});

test('un gato tuxedo con coronita de 3 granates y 3 diamantes acompaña al jugador', async () => {
  const s = await S();
  assert.ok(s.cat.scene, 'el gato está en la escena');
  assert.ok(s.cat.dist > 1 && s.cat.dist < 5, `cerca del jugador (${s.cat.dist.toFixed(1)} m)`);
  const kinds = s.cat.gems.map((g) => g.kind), angles = s.cat.gems.map((g) => g.angle);
  assert.equal(kinds.filter((k) => k === 'granate').length, 3);
  assert.equal(kinds.filter((k) => k === 'diamante').length, 3);
  assert.deepEqual(angles, [0, 60, 120, 180, 240, 300], 'equidistantes');
  for (let i = 0; i < 6; i++) assert.notEqual(kinds[i], kinds[(i + 1) % 6], 'alternados');
});

test('el gato camina, trota y se sienta según lo que hace el jugador', async () => {
  await page.evaluate(() => { const X = window.__invite; X.teleport('fogata', 5, 1.5); X.look(X.state().yaw + Math.PI, 0); X.step(0.1); });
  await page.keyboard.down('w');
  await step(1.2);
  let s = await S();
  assert.equal(s.cat.gait, 'camina', `caminando (${s.cat.speed.toFixed(2)} m/s)`);
  await page.keyboard.down('Shift'); await step(1.2);
  s = await S();
  assert.equal(s.cat.gait, 'trota', `trotando (${s.cat.speed.toFixed(2)} m/s)`);
  await page.keyboard.up('Shift'); await page.keyboard.up('w');
  assert.ok(s.cat.dist < 5, `lo sigue (${s.cat.dist.toFixed(1)} m)`);
  await step(6); // llega a su lugar, espera 2,5 s quieto y se sienta
  s = await S();
  assert.equal(s.cat.gait, 'quieto');
  assert.ok(s.cat.sit > 0.9, 'quieto un rato, se sienta');
});

test('el gato también entra a las salas y a la mazmorra', async () => {
  for (const [js, scene] of [[() => window.__invite.teleport('abuelas'), 'abuelas'], [() => window.__invite.teleport({ scene: 'mazmorra', x: 6, z: 24.4, yaw: 0 }), 'mazmorra']]) {
    await page.evaluate(js); await step(1);
    const s = await S();
    assert.equal(s.scene, scene);
    assert.ok(s.cat.scene, `el gato está en ${scene}`);
    assert.ok(s.cat.dist < 4, `${scene}: a ${s.cat.dist.toFixed(1)} m`);
  }
  await page.evaluate(() => window.__invite.teleport('fogata', 6, 1.5));
});

test('el gato maúlla y el audio pasa por un limitador', async () => {
  const a = (await S()).audio;
  assert.equal(a.limiter, true);
  await page.evaluate(() => window.__invite.meow());
  assert.equal((await S()).audio.meows, a.meows + 1);
});

test('el mapa muestra un puntero propio que se agranda sobre un lugar', async () => {
  await page.keyboard.press('m');
  await page.waitForTimeout(450);
  assert.match(await page.evaluate(() => getComputedStyle(document.getElementById('map')).cursor), /url\(/);
  const pt = await page.evaluate(() => window.__invite.mapPoint('fogata'));
  await page.mouse.move(pt.x, pt.y);
  assert.equal(await page.evaluate(() => document.getElementById('map-canvas').classList.contains('hot')), true);
  assert.match(await page.evaluate(() => getComputedStyle(document.getElementById('map-canvas')).cursor), /url\(/);
  const box = await page.locator('#map-canvas').boundingBox();
  assert.ok(box.height > 540 * 0.75, `el mapa ocupa casi todo el alto (${box.height.toFixed(0)} px)`);
  await page.keyboard.press('m');
});

test('textos: tronco de Gonzalo y menú de inicio', async () => {
  await page.evaluate(() => { const X = window.__invite; X.teleport('tronco-gonzalo', 1.5, 2.5); X.step(0.05); X.lookAt('tronco-gonzalo'); X.step(0.1); });
  await page.keyboard.press('e');
  const r = (await S()).reader;
  assert.ok(r && r.text.includes('El fuego sagrado lo recuerda mirando las estrellas.'), JSON.stringify(r));
  assert.ok(!r.text.includes('bien intencionado'));
  await page.keyboard.press('Escape');
  const keys = await page.evaluate(() => [...document.querySelectorAll('.keys')].map((k) => k.textContent));
  for (const k of keys) {
    assert.ok(!/m\/s|\(/.test(k.replace(/\(cuando la tengas\)/, '')), `sin velocidades ni paréntesis: ${k}`);
    assert.match(k, /Caminar/); assert.match(k, /Trotar/);
  }
  assert.match(keys.join(' '), /Tocar un objeto\s*Leer \/ entrar/);
  assert.ok(!keys.join(' ').includes('o Leer'));
  assert.deepEqual(errors, []);
});
