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

test('calidad Media por defecto; el botón rota Media → Baja → Alta, se recuerda y en todas se ve el bosque', async () => {
  await page.evaluate(() => { const X = window.__invite; X.teleport('fogata', 6, 1.5); X.step(0.5); });
  let s = await S();
  assert.equal(s.quality, 'media', 'por defecto Media (PC y celular)');
  assert.equal(s.shadows, true); assert.equal(s.bloom, false);
  assert.equal(await page.innerText('#btn-quality'), 'Calidad: Media');
  const expect = [['baja', 'Baja', false, false, 0.75], ['alta', 'Alta', true, true, 1], ['media', 'Media', true, false, 1]];
  for (const [level, label, shadows, bloom, dpr] of expect) {
    await page.click('#btn-quality');
    await step(0.3);
    s = await S();
    assert.equal(s.quality, level);
    assert.equal(await page.innerText('#btn-quality'), `Calidad: ${label}`);
    assert.equal(s.shadows, shadows, `${level}: sombras`);
    assert.equal(s.bloom, bloom, `${level}: bloom`);
    assert.equal(s.pixelRatio, dpr, `${level}: densidad de píxeles`);
    assert.equal(await page.evaluate(() => localStorage.getItem('invite.quality.v2')), level);
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

test('en PC la rueda del mouse y +/- hacen zoom; las pistas lo explican', async () => {
  await page.evaluate(() => { const X = window.__invite; X.teleport('fogata', 6, 1.5); X.setFov(68); X.step(0.05); });
  const fov = async () => (await S()).fov;
  const box = await page.locator('#app canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400); await page.waitForTimeout(100);
  const a = await fov();
  assert.ok(a < 60, `rueda hacia adelante acerca (fov ${a.toFixed(1)})`);
  await page.mouse.wheel(0, 400); await page.waitForTimeout(100);
  assert.ok((await fov()) > a + 5, 'rueda hacia atrás aleja');
  await page.evaluate(() => window.__invite.setFov(68));
  await page.keyboard.press('+'); await page.keyboard.press('+');
  const b = await fov();
  assert.ok(b < 60, `+ acerca (fov ${b.toFixed(1)})`);
  await page.keyboard.press('-'); await page.keyboard.press('-'); await page.keyboard.press('-');
  assert.ok((await fov()) > b + 10, '- aleja');
  await page.evaluate(() => window.__invite.setFov(68));
  const hint = await page.innerText('#hint');
  assert.match(hint, /Esc\s*Mostrar cursor/); assert.match(hint, /\+\/-\s*zoom/);
});

test('el chisporroteo del fuego es más espaciado y bajo', async () => {
  await page.evaluate(() => { const X = window.__invite; X.teleport('fogata', 3, 1.5); X.manual(false); });
  const c0 = (await S()).audio.crackles, t0 = Date.now();
  await page.waitForTimeout(6000);
  const n = (await S()).audio.crackles - c0, secs = (Date.now() - t0) / 1000;
  await page.evaluate(() => window.__invite.manual(true));
  assert.ok(n > 0, 'suena');
  assert.ok(n / secs < 1 / 0.2, `${(n / secs).toFixed(1)} chasquidos por segundo (antes ~5,5)`);
});
