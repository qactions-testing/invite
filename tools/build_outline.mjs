// Genera public/assets/outline.json: contorno del Cono Sur (Argentina, Chile, Uruguay,
// Paraguay) desde Natural Earth 1:50m (dominio público), proyectado a metros de mundo.
// Uso: node tools/build_outline.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache');
mkdirSync(CACHE, { recursive: true });
const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const file = join(CACHE, 'ne_50m_admin_0_countries.geojson');
if (!existsSync(file)) execFileSync('curl', ['-sSL', '--fail', '--retry', '3', '-o', file, SRC]);

const COUNTRIES = ['Argentina', 'Chile', 'Uruguay', 'Paraguay'];
const NS_METERS = 480; // extensión norte-sur del mundo caminable (entre 300 y 500 m)
const TOLERANCE = 0.35; // simplificación Douglas-Peucker, en metros
const MIN_AREA = 12; // descarta islotes menores a 12 m²

const gj = JSON.parse(readFileSync(file, 'utf8'));
const raw = {};
for (const f of gj.features) {
  const name = f.properties.ADMIN;
  if (!COUNTRIES.includes(name)) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  // solo anillo exterior; se descartan islas oceánicas lejanas (Pascua, Juan Fernández)
  raw[name] = polys.map((p) => p[0]).filter((ring) => ring.every(([lon]) => lon > -77));
}
for (const c of COUNTRIES) if (!raw[c]) throw new Error(`Falta ${c} en Natural Earth`);

let latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
for (const rings of Object.values(raw)) for (const ring of rings) for (const [lon, lat] of ring) {
  latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
  lonMin = Math.min(lonMin, lon); lonMax = Math.max(lonMax, lon);
}
const latC = (latMin + latMax) / 2, lonC = (lonMin + lonMax) / 2;
const cos = Math.cos((latC * Math.PI) / 180);
const k = NS_METERS / (latMax - latMin); // metros por grado de latitud
const project = ([lon, lat]) => [(lon - lonC) * cos * k, (latC - lat) * k]; // x = este, z = sur

function simplify(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    for (let i = a + 1; i < b; i++) {
      // anillo cerrado (a == b): distancia al punto, no a la recta
      const d = len < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - az) : Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a / 2);
};

const countries = {};
let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, nPts = 0;
for (const [name, rings] of Object.entries(raw)) {
  countries[name] = [];
  for (const ring of rings) {
    const pts = simplify(ring.map(project), TOLERANCE);
    if (pts.length < 4 || area(pts) < MIN_AREA) continue;
    const flat = [];
    for (const [x, z] of pts) {
      flat.push(+x.toFixed(2), +z.toFixed(2));
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    nPts += pts.length;
    countries[name].push(flat);
  }
}
const out = { source: 'Natural Earth 1:50m admin-0 (public domain)', k, latC, lonC, cos, bounds: { minX, maxX, minZ, maxZ }, countries };
mkdirSync(join(ROOT, 'public/assets'), { recursive: true });
writeFileSync(join(ROOT, 'public/assets/outline.json'), JSON.stringify(out));
console.log(`outline: ${nPts} puntos, ${(maxX - minX).toFixed(0)} m E-O x ${(maxZ - minZ).toFixed(0)} m N-S, k=${k.toFixed(3)} m/°`);
