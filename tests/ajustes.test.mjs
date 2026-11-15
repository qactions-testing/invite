// Botón de parlante (silencia solo la música), botón de calidad (Alta/Media/Baja) y lo que hace rendir al bosque:
// vegetación en parcelas (no se dibuja lo lejano) y pocas luces puntuales encendidas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve, openGame, frameStats } from '../tools/harness.mjs';

let server, browser, page, errors;
before(async () => {
  server = await serve(4182);
  ({ browser, page, errors } = await openGame(server.url, { quality: 'high', width: 960, height: 540 }));
});
after(async () => { await browser?.close(); server?.stop(); });

const S = () => page.evaluate(() => window.__invite.state());
const step = (s) => page.evaluate((x) => window.__invite.step(x), s);

test('el botón de parlante silencia solo la música y se recuerda', async () => {
  await page.evaluate(() => window.__invite.teleport('fogata', 6, 1.5));
  await step(1);
  assert.equal(await page.isVisible('#btn-music'), true, 'el botón está en pantalla');
  const box = await page.locator('#btn-music').boundingBox();
  assert.ok(box.x < 80 && box.y < 80, 'en la esquina superior izquierda');
  assert.ok((await S()).audio.musicGain > 0.1, 'la música suena');
  await page.click('#btn-music');
  await step(0.3);
  let a = (await S()).audio;
  assert.equal(a.musicOn, false);
  assert.ok(a.musicGain < 0.001, `música en silencio (${a.musicGain})`);
  assert.ok(a.birdGain > 0.1, 'las aves siguen sonando');
  assert.equal(await page.evaluate(() => localStorage.getItem('invite.music.v1')), '0', 'se recuerda');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#btn-music .slash')).display), 'inline', 'parlante tachado');
  assert.equal(await page.getAttribute('#btn-music', 'aria-label'), 'Activar la música');
  await page.click('#btn-music');
  await step(1.5);
  a = (await S()).audio;
  assert.equal(a.musicOn, true);
  assert.ok(a.musicGain > 0.1, 'vuelve la música');
});

test('el botón de calidad rota Alta → Media → Baja, se recuerda y en todas se ve el bosque', async () => {
  await page.evaluate(() => { const X = window.__invite; X.teleport('fogata', 6, 1.5); X.step(0.5); });
  let s = await S();
  assert.equal(s.quality, 'alta');
  assert.equal(s.shadows, true); assert.equal(s.bloom, true);
  assert.equal(await page.innerText('#btn-quality'), 'Calidad: Alta');
  const expect = [['media', 'Media', true, false, 1], ['baja', 'Baja', false, false, 0.75], ['alta', 'Alta', true, true, 1]];
  for (const [level, label, shadows, bloom, dpr] of expect) {
    await page.click('#btn-quality');
    await step(0.3);
    s = await S();
    assert.equal(s.quality, level);
    assert.equal(await page.innerText('#btn-quality'), `Calidad: ${label}`);
    assert.equal(s.shadows, shadows, `${level}: sombras`);
    assert.equal(s.bloom, bloom, `${level}: bloom`);
    assert.equal(s.pixelRatio, dpr, `${level}: densidad de píxeles`);
    assert.equal(await page.evaluate(() => localStorage.getItem('invite.quality.v1')), level);
    const st = await frameStats(page);
    assert.ok(st.mean > 40 && st.std > 10, `${level}: el bosque se ve (brillo ${st.mean.toFixed(0)}, contraste ${st.std.toFixed(0)})`);
  }
});

test('la vegetación se dibuja por parcelas: el bosque cuesta mucho menos por cuadro', async () => {
  const report = [];
  for (const where of ['fogata', 'campamento', 'cueva']) {
    await page.evaluate((w) => { const X = window.__invite; X.teleport(w, 8, 1.5); X.step(0.5); }, where);
    const s = await S();
    assert.ok(s.world.trees >= 150, 'siguen estando todos los árboles');
    assert.ok(s.chunks.total > 50, `vegetación partida en parcelas (${s.chunks.total})`);
    const now = await page.evaluate(() => window.__invite.renderCost(false));
    const before = await page.evaluate(() => window.__invite.renderCost(true));
    report.push(`${where}: ${(now.triangles / 1e6).toFixed(2)} M triángulos (antes ${(before.triangles / 1e6).toFixed(2)} M), ${now.calls} draw calls (antes ${before.calls})`);
    assert.ok(now.triangles < before.triangles * 0.6, report.at(-1));
  }
  console.log(report.join('\n'));
});

test('pocas luces puntuales encendidas a la vez, también en la mazmorra', async () => {
  await page.evaluate(() => { const X = window.__invite; X.teleport('fogata', 6, 1.5); X.step(0.5); });
  assert.ok((await S()).lights <= 3, 'bosque');
  await page.evaluate(() => { const X = window.__invite; X.teleport({ scene: 'mazmorra', x: 6, z: 24.4, yaw: 0 }); X.step(0.5); });
  const s = await S();
  assert.equal(s.scene, 'mazmorra');
  assert.ok(s.lights <= 5, `mazmorra: ${s.lights} luces`); // 3 + 2 extra: vive de sus antorchas
  const st = await frameStats(page);
  assert.ok(st.mean > 8, `el corredor sigue iluminado (brillo ${st.mean.toFixed(1)})`);
  await page.evaluate(() => window.__invite.teleport('fogata', 6, 1.5));
  assert.deepEqual(errors, []);
});
