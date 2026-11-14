// Descarga texturas y cielo CC0 de Poly Haven (https://polyhaven.com, licencia CC0).
// Uso: node tools/fetch_polyhaven.mjs
// - public/assets/textures/<id>.webp  difuso 1k para runtime (original JPG en .cache, lo usa Blender)
// - public/assets/sky/sky_1k.hdr      entorno (iluminación)
// - public/assets/sky/sky.jpg         fondo 4k (HDR bajado de exposición, sRGB 8 bits)
// - public/assets/sky/sky.json        dirección del sol en el espacio del HDRI
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEX_DIR = join(ROOT, 'public/assets/textures');
const SKY_DIR = join(ROOT, 'public/assets/sky');
const CACHE = join(ROOT, '.cache/polyhaven');
for (const d of [TEX_DIR, SKY_DIR, CACHE]) mkdirSync(d, { recursive: true });

export const SKY_ID = 'qwantani_sunset_puresky';
export const TEXTURES = [
  // terreno
  'forest_leaves_02', 'leafy_grass', 'cliff_side', 'coast_sand_01', 'mossy_rock',
  // cortezas
  'bark_brown_02', 'pine_bark', 'palm_tree_bark',
  // salas y construcciones
  'plank_flooring_02', 'plastered_wall_04', 'old_stone_wall', 'gingham_check',
  'wood_table_001', 'brown_planks_09', 'cobblestone_floor_04', 'clay_roof_tiles_02',
  'thatch_roof_angled',
];

// curl respeta el proxy y el CA del entorno; fetch() de Node no.
const curl = (args) => execFileSync('curl', ['-sSL', '--fail', '--retry', '3', ...args], { maxBuffer: 1 << 28 });
const getJson = (url) => JSON.parse(curl([url]).toString('utf8'));
const download = (url, dest) => {
  if (existsSync(dest)) return false;
  curl(['-o', dest, url]);
  return true;
};

const manifest = {};
for (const id of TEXTURES) {
  const files = getJson(`https://api.polyhaven.com/files/${id}`);
  const diff = files.Diffuse?.['1k']?.jpg?.url;
  if (!diff) throw new Error(`Sin mapa difuso 1k para ${id}`);
  // original en .cache (lo usa Blender); WebP liviano para runtime
  const src = join(CACHE, `${id}.jpg`);
  const fresh = download(diff, src);
  const dest = join(TEX_DIR, `${id}.webp`);
  if (!existsSync(dest)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src, '-c:v', 'libwebp', '-quality', '80', dest]);
  manifest[id] = { diffuse: `assets/textures/${id}.webp` };
  console.log(`${fresh ? 'descargado' : 'en caché  '} ${id}`);
}
writeFileSync(join(TEX_DIR, 'textures.json'), JSON.stringify(manifest, null, 1));

// --- cielo ---
const sky = getJson(`https://api.polyhaven.com/files/${SKY_ID}`);
download(sky.hdri['1k'].hdr.url, join(SKY_DIR, 'sky_1k.hdr'));
const hdr4k = join(CACHE, `${SKY_ID}_4k.hdr`);
download(sky.hdri['4k'].hdr.url, hdr4k);

/** Decodifica un .hdr (Radiance RGBE, RLE nuevo) a Float32 RGB lineal. */
function readHdr(path) {
  const b = readFileSync(path);
  let p = 0, line = '';
  const next = () => { let s = ''; while (b[p] !== 10) s += String.fromCharCode(b[p++]); p++; return s; };
  while ((line = next()) !== '') { /* cabecera */ }
  const m = /-Y (\d+) \+X (\d+)/.exec(next());
  const H = +m[1], W = +m[2], out = new Float32Array(W * H * 3), scan = new Uint8Array(W * 4);
  for (let y = 0; y < H; y++) {
    if (b[p] === 2 && b[p + 1] === 2 && ((b[p + 2] << 8) | b[p + 3]) === W) {
      p += 4;
      for (let c = 0; c < 4; c++) for (let x = 0; x < W;) {
        let n = b[p++];
        if (n > 128) { n -= 128; const v = b[p++]; while (n--) scan[x++ * 4 + c] = v; }
        else while (n--) scan[x++ * 4 + c] = b[p++];
      }
    } else { scan.set(b.subarray(p, p + W * 4)); p += W * 4; }
    for (let x = 0; x < W; x++) {
      const e = scan[x * 4 + 3], f = e ? 2 ** (e - 136) : 0, o = (y * W + x) * 3;
      out[o] = scan[x * 4] * f; out[o + 1] = scan[x * 4 + 1] * f; out[o + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { W, H, data: out };
}

// Fondo: el HDR 4k bajado SKY_EV pasos y codificado en sRGB de 8 bits (el shader lo vuelve a subir).
export const SKY_EV = -1.5;
const { W, H, data } = readHdr(hdr4k);
const rgb = Buffer.alloc(W * H * 3), k = 2 ** SKY_EV;
let best = -1, bx = 0, by = 0;
for (let i = 0; i < W * H; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], bl = data[i * 3 + 2], lum = r + g + bl;
  if (lum > best) { best = lum; bx = i % W; by = Math.floor(i / W); }
  for (let c = 0; c < 3; c++) {
    const v = Math.min(1, data[i * 3 + c] * k);
    rgb[i * 3 + c] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  }
}
// centroide de la zona más brillante = sol
let sx = 0, sy = 0, sw = 0;
for (let y = Math.max(0, by - 40); y < Math.min(H, by + 40); y++) for (let x = bx - 40; x < bx + 40; x++) {
  const i = y * W + ((x + W) % W), lum = data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2];
  if (lum > best * 0.5) { sx += x * lum; sy += y * lum; sw += lum; }
}
const raw = join(CACHE, 'sky_rgb.raw');
writeFileSync(raw, rgb);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', raw, '-q:v', '2', join(SKY_DIR, 'sky.jpg')]);
const u = (sx / sw + 0.5) / W, v = 1 - (sy / sw + 0.5) / H;
// misma convención que equirectUv de three.js
const phi = (u - 0.5) * 2 * Math.PI, theta = (v - 0.5) * Math.PI;
const sunDir = [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)];
writeFileSync(join(SKY_DIR, 'sky.json'), JSON.stringify({ id: SKY_ID, sunDir, elevationDeg: (theta * 180) / Math.PI, ev: SKY_EV }, null, 1));
console.log(`cielo ${SKY_ID}: sol a ${((theta * 180) / Math.PI).toFixed(1)}° de elevación`);
