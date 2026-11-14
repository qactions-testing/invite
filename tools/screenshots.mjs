// Capturas de los seis lugares de la etapa 1 (+ mapa y vista general del bosque).
// Uso: npm run build && npm run screenshots   → screenshots/stage1/*.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, serve, openGame, frameStats } from './harness.mjs';

/** Cada toma: id, título y el JS que acomoda la cámara (corre con `I = window.__invite`). */
export const SHOTS = [
  { id: 'estanque', title: 'Estanque de los Peces', js: `I.teleport('estanque', 12.5); I.look(I.state().yaw, -0.2); I.step(1.5);` },
  { id: 'fogata', title: 'Fogata de los Novios', js: `I.teleport('fogata', 5.6, 1.5); I.portraits(1); I.look(I.state().yaw, 0.03); I.step(1.5);` },
  { id: 'cueva', title: 'Cueva de las Amatistas', js: `const p = I.state().places.find((q) => q.id === 'cueva'); I.teleport({ x: p.x + 2.6, z: p.z + 0.5, yaw: 1.42, scene: 'bosque' }); I.look(1.42, 0.2); I.step(1.5);` },
  { id: 'cana', title: 'Corazón de la Caña Fístula', js: `I.teleport('cana'); I.teleport({ x: -0.9, z: 2.0, yaw: -0.42 }); I.look(-0.42, -0.1); I.step(1.5);` },
  { id: 'abuelas', title: 'Cocina de las Abuelas', js: `I.teleport('abuelas'); I.teleport({ x: -0.75, z: 2.1, yaw: -0.3 }); I.look(-0.3, -0.06); I.step(3.5);` },
  { id: 'gnomos', title: 'Casita de Gnomos', js: `I.teleport('gnomos'); I.teleport({ x: -0.2, z: 1.75, yaw: -0.1 }); I.look(-0.1, -0.2); I.step(1.5);` },
  { id: 'bosque', title: 'El bosque desde el punto de partida', js: `I.teleport({ x: I.state().places.find((q) => q.id === 'fogata').x - 12, z: I.state().places.find((q) => q.id === 'fogata').z - 20, yaw: 2.6, scene: 'bosque' }); I.look(2.6, 0.02); I.step(1.5);` },
  { id: 'mapa', title: 'Mapa del bosque (tecla M)', js: `I.teleport({ x: I.state().places[1].x - 6, z: I.state().places[1].z - 10, yaw: 0.6, scene: 'bosque' }); I.step(0.2);`, key: 'm' },
];

export async function capture({ baseUrl, outDir, quality = 'high', width = 1280, height = 720, dpr = 2, only = null }) {
  mkdirSync(outDir, { recursive: true });
  const { browser, page, errors } = await openGame(baseUrl, { quality, width, height, dpr });
  const out = [];
  try {
    for (const s of SHOTS) {
      if (only && !only.includes(s.id)) continue;
      await page.evaluate(`(() => { const I = window.__invite; ${s.js} })()`);
      if (s.key) await page.keyboard.press(s.key);
      const stats = await frameStats(page);
      const file = join(outDir, `${s.id}.png`);
      await page.screenshot({ path: file });
      if (s.key) await page.keyboard.press(s.key);
      out.push({ id: s.id, title: s.title, file: `${s.id}.png`, mean: +stats.mean.toFixed(1), std: +stats.std.toFixed(1) });
    }
  } finally { await browser.close(); }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(out, null, 1));
  return { shots: out, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const server = await serve(4174);
  try {
    const { shots, errors } = await capture({ baseUrl: server.url, outDir: join(ROOT, 'screenshots/stage1'), only: only.length ? only : null,
      dpr: process.argv.includes('--1x') ? 1 : 2, quality: process.argv.includes('--low') ? 'low' : 'high' });
    console.table(shots);
    if (errors.length) console.log(errors.join('\n'));
  } finally { server.stop(); }
}
