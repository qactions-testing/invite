// Arnés compartido por los tests y la herramienta de capturas:
// levanta `vite preview` sobre dist/ y abre Chromium (Playwright) con WebGL por software.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function loadPlaywright() {
  try { return (await import('playwright')).chromium; }
  catch {
    // Playwright preinstalado fuera del proyecto (no se reinstala)
    const dir = process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/';
    return createRequire(dir)('playwright').chromium;
  }
}

/** Sirve dist/ en un puerto libre. Devuelve { url, stop }. */
export async function serve(port = 4173) {
  if (!existsSync(join(ROOT, 'dist/index.html'))) throw new Error('Falta dist/: corré `npm run build` primero.');
  const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(url); if (r.ok) return { url, stop: () => proc.kill() }; } catch { /* todavía no levantó */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error(`vite preview no respondió en ${url}`);
}

/** Abre el juego y espera a que window.__invite esté listo. Deja el bucle en modo manual (determinista). */
export async function openGame(baseUrl, { quality = 'low', width = 960, height = 540, dpr = 1, mobile = false } = {}) {
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  // contexto explícito: permite abrir otra pestaña que comparte el almacenamiento.
  // mobile: pantalla táctil emulada (puntero "coarse"), como un celular
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${baseUrl}?autostart=1&quality=${quality}`);
  await page.waitForFunction(() => window.__invite?.ready || window.__inviteError, null, { timeout: 240000 });
  const fatal = await page.evaluate(() => window.__inviteError);
  if (fatal) { await browser.close(); throw new Error(fatal); }
  await page.evaluate(() => window.__invite.manual(true));
  return { browser, page, errors };
}

/** Renderiza un cuadro y mide brillo medio y desvío estándar del canvas (0–255). */
export const frameStats = (page) => page.evaluate(() => {
  window.__invite.render();
  const gl = document.querySelector('#app canvas'), c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const ctx = c.getContext('2d');
  ctx.drawImage(gl, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, sq = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; sq += l * l; }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
});
