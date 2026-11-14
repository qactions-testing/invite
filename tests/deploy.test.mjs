// Prueban las dos cosas pedidas: que la app está alojada en el repo qactions-testing/invite
// y que está desplegada en Vercel. La URL del deploy sale de DEPLOY_URL o de deploy.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/harness.mjs';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
// curl respeta el proxy y los certificados del entorno; fetch() de Node no
const curl = (url) => {
  const out = execFileSync('curl', ['-sSL', '--max-time', '60', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const cut = out.lastIndexOf('\n');
  return { status: +out.slice(cut + 1), body: out.slice(0, cut) };
};
const deployFile = join(ROOT, 'deploy.json');
const DEPLOY_URL = (process.env.DEPLOY_URL || (existsSync(deployFile) ? JSON.parse(readFileSync(deployFile, 'utf8')).url : '') || '').replace(/\/$/, '');

test('la app está alojada en el repo qactions-testing/invite (rama subida y al día)', () => {
  assert.match(git('config', '--get', 'remote.origin.url'), /qactions-testing\/invite/);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD'), head = git('rev-parse', 'HEAD');
  const remote = git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s+/)[0];
  assert.equal(remote, head, `la rama ${branch} del remoto no coincide con el commit local`);
  const files = git('ls-files').split('\n');
  for (const f of ['index.html', 'src/main.ts', 'src/world/dungeon.ts', 'src/content/ideas.ts', 'blender/build.py',
    'public/assets/outline.json', 'public/assets/rooms/gnomos.glb', 'public/assets/dungeon/kit.glb', 'tests/stage1.test.mjs', 'tests/stage2.test.mjs']) {
    assert.ok(files.includes(f), `falta ${f} en el repo`);
  }
  assert.equal(git('status', '--porcelain'), '', 'hay cambios sin commitear');
});

test('la app está desplegada en Vercel y sirve el juego completo', { skip: DEPLOY_URL ? false : 'todavía no hay deploy: falta deploy.json o DEPLOY_URL' }, () => {
  assert.match(new URL(DEPLOY_URL).hostname, /\.vercel\.app$/);
  const page = curl(`${DEPLOY_URL}/`);
  assert.equal(page.status, 200, `la portada respondió ${page.status}`);
  assert.match(page.body, /<title>Invite — Bosque del Cono Sur<\/title>/);
  const bundle = /src="\.?\/?(assets\/index-[^"]+\.js)"/.exec(page.body);
  assert.ok(bundle, 'la portada no referencia el bundle del juego');
  const js = curl(`${DEPLOY_URL}/${bundle[1]}`);
  assert.equal(js.status, 200);
  assert.ok(js.body.includes('Mazmorra de los Gnomos') && js.body.includes('Bvenos Ayres'), 'el bundle no trae la mazmorra ni la invitación');
  const outline = curl(`${DEPLOY_URL}/assets/outline.json`);
  assert.equal(outline.status, 200);
  assert.ok(JSON.parse(outline.body).countries.Argentina, 'falta el contorno del Cono Sur');
  const kit = curl(`${DEPLOY_URL}/assets/dungeon/kit.json`);
  assert.equal(kit.status, 200);
  assert.ok(JSON.parse(kit.body).pieces.includes('chest_base'), 'falta el kit de la mazmorra');
  for (const asset of ['assets/rooms/cana.glb', 'assets/rooms/abuelas_lm.webp', 'assets/sky/sky.jpg']) {
    const code = execFileSync('curl', ['-sSL', '--max-time', '60', '-o', '/dev/null', '-w', '%{http_code}', `${DEPLOY_URL}/${asset}`], { encoding: 'utf8' });
    assert.equal(code, '200', `${asset} respondió ${code}`);
  }
});
