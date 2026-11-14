// Flora nativa procedural: atlas de hojas en canvas, generador de árboles y siembra por bioma.
import * as THREE from 'three';
import { Geo, Zone } from './geo';
import { Terrain } from './terrain';
import { Rng, TAU, clamp, makeCanvas, mulberry32, rr, smoothstep } from '../util';

type RGB = [number, number, number];
const V3 = THREE.Vector3;

// ---------------------------------------------------------------- atlas de hojas
export const CELL = { broad: 0, pinnate: 1, blossom: 2, needle: 3, small: 4, frond: 5, fern: 6, grass: 7, plume: 8, reed: 9, willow: 10, wildflower: 11, rosette: 12, lily: 13 };
const GRID = 4, CS = 512;

function drawLeaf(c: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, ang: number, shade: number) {
  c.save(); c.translate(x, y); c.rotate(ang);
  const g = c.createLinearGradient(-wid, 0, wid, 0);
  g.addColorStop(0, `rgb(${shade * 0.82},${shade * 0.82},${shade * 0.82})`);
  g.addColorStop(0.5, `rgb(${shade},${shade},${shade})`);
  g.addColorStop(1, `rgb(${shade * 0.9},${shade * 0.9},${shade * 0.9})`);
  c.fillStyle = g;
  c.beginPath(); c.moveTo(0, 0);
  c.bezierCurveTo(wid, -len * 0.25, wid * 0.85, -len * 0.8, 0, -len);
  c.bezierCurveTo(-wid * 0.85, -len * 0.8, -wid, -len * 0.25, 0, 0);
  c.fill();
  c.strokeStyle = 'rgba(40,40,40,0.28)'; c.lineWidth = Math.max(1, wid * 0.06);
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -len * 0.95); c.stroke();
  c.restore();
}

export function makeLeafAtlas(): THREE.DataTexture {
  const S = GRID * CS, [cv, c] = makeCanvas(S, S), rng = mulberry32(4242);
  const cell = (i: number, fn: () => void) => {
    c.save(); c.translate((i % GRID) * CS, Math.floor(i / GRID) * CS);
    c.beginPath(); c.rect(4, 4, CS - 8, CS - 8); c.clip(); fn(); c.restore();
  };
  const twig = (x0: number, y0: number, x1: number, y1: number, w: number, s = 90) => {
    c.strokeStyle = `rgb(${s},${s * 0.9},${s * 0.8})`; c.lineWidth = w; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  };
  cell(CELL.broad, () => {
    for (let i = 0; i < 150; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * 205, x = 256 + Math.cos(a) * r, y = 256 + Math.sin(a) * r;
      drawLeaf(c, x, y, rr(rng, 46, 70), rr(rng, 15, 23), a + Math.PI / 2 + rr(rng, -0.8, 0.8), 110 + 130 * (i / 150) * rr(rng, 0.8, 1));
    }
  });
  cell(CELL.pinnate, () => {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + rng(), len = rr(rng, 170, 235);
      const ex = 256 + Math.cos(a) * len, ey = 256 + Math.sin(a) * len;
      twig(256, 256, ex, ey, 3, 110);
      for (let q = 2; q < 15; q++) {
        const t = q / 15, x = 256 + (ex - 256) * t, y = 256 + (ey - 256) * t;
        for (const s of [-1, 1]) drawLeaf(c, x, y, rr(rng, 34, 44), rr(rng, 8, 11), a + Math.PI / 2 + s * 1.15, rr(rng, 150, 240));
      }
    }
  });
  cell(CELL.blossom, () => {
    for (let i = 0; i < 9; i++) drawLeaf(c, rr(rng, 110, 400), rr(rng, 110, 400), 70, 18, rng() * TAU, 105);
    for (let i = 0; i < 20; i++) {
      const a0 = rng() * TAU, r0 = Math.sqrt(rng()) * 190, x = 256 + Math.cos(a0) * r0, y = 256 + Math.sin(a0) * r0, s = rr(rng, 0.8, 1.25);
      for (let p = 0; p < 5; p++) drawLeaf(c, x, y, 46 * s, 22 * s, (p / 5) * TAU + a0, rr(rng, 215, 255));
      c.fillStyle = 'rgb(150,140,110)'; c.beginPath(); c.arc(x, y, 7 * s, 0, TAU); c.fill();
    }
  });
  cell(CELL.needle, () => {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + rng() * 0.5, len = rr(rng, 180, 235);
      const ex = 256 + Math.cos(a) * len, ey = 256 + Math.sin(a) * len;
      twig(256, 256, ex, ey, 22, 120);
      for (let q = 1; q < 34; q++) {
        const t = q / 34, x = 256 + (ex - 256) * t, y = 256 + (ey - 256) * t;
        for (const s of [-1, 1]) drawLeaf(c, x, y, 34, 9, a + Math.PI / 2 + s * rr(rng, 0.7, 1.1), rr(rng, 140, 225));
      }
    }
  });
  cell(CELL.small, () => {
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU + rng() * 0.6, len = rr(rng, 150, 235);
      const ex = 256 + Math.cos(a) * len, ey = 256 + Math.sin(a) * len;
      twig(256, 256, ex, ey, 3, 80);
      for (let q = 1; q < 14; q++) {
        const t = q / 14, x = 256 + (ex - 256) * t, y = 256 + (ey - 256) * t;
        drawLeaf(c, x, y, rr(rng, 30, 42), rr(rng, 15, 20), a + Math.PI / 2 + (q % 2 ? 1 : -1) * rr(rng, 0.6, 1.2), rr(rng, 140, 245));
      }
    }
  });
  cell(CELL.frond, () => {
    twig(256, 506, 256, 14, 9, 120);
    for (let q = 0; q < 46; q++) {
      const t = q / 46, y = 500 - t * 480, len = 215 * Math.sin(Math.PI * (0.12 + t * 0.86)) + 20;
      for (const s of [-1, 1]) drawLeaf(c, 256, y, len, 9, s * rr(rng, 0.85, 1.1), rr(rng, 150, 240));
    }
  });
  cell(CELL.fern, () => {
    twig(256, 506, 256, 20, 5, 110);
    for (let q = 0; q < 34; q++) {
      const t = q / 34, y = 498 - t * 470, len = 150 * (1 - t) ** 0.8 + 10;
      for (const s of [-1, 1]) drawLeaf(c, 256, y, len, 10 + 6 * (1 - t), s * (1.35 - t * 0.3), rr(rng, 150, 240));
    }
  });
  const blades = (n: number, x0: number, x1: number, hMin: number, hMax: number, w: number) => {
    for (let i = 0; i < n; i++) {
      const x = rr(rng, x0, x1), h = rr(rng, hMin, hMax), bend = rr(rng, -110, 110), s = rr(rng, 130, 245);
      c.fillStyle = `rgb(${s},${s},${s})`;
      c.beginPath(); c.moveTo(x - w, 508);
      c.quadraticCurveTo(x + bend * 0.3, 508 - h * 0.6, x + bend, 508 - h);
      c.quadraticCurveTo(x + bend * 0.3 + w, 508 - h * 0.6, x + w, 508); c.fill();
    }
  };
  cell(CELL.grass, () => blades(70, 60, 452, 150, 480, 6));
  cell(CELL.plume, () => {
    blades(26, 170, 342, 150, 330, 6);
    for (let k = 0; k < 4; k++) {
      const x = rr(rng, 150, 362), top = rr(rng, 30, 110);
      twig(x, 508, x + rr(rng, -20, 20), top + 120, 4, 150);
      for (let q = 0; q < 80; q++) {
        const t = rng(), y = top + t * 170, wdt = 34 * Math.sin(Math.PI * clamp(t + 0.08, 0, 1));
        c.strokeStyle = `rgba(250,246,236,${rr(rng, 0.35, 0.9)})`; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(x, y + 12); c.lineTo(x + rr(rng, -wdt, wdt), y - 14); c.stroke();
      }
    }
  });
  cell(CELL.reed, () => {
    blades(34, 130, 382, 260, 500, 6);
    for (let k = 0; k < 5; k++) {
      const x = rr(rng, 150, 362), top = rr(rng, 40, 140);
      twig(x, 508, x, top, 5, 130);
      c.fillStyle = 'rgb(105,82,60)'; c.beginPath(); c.ellipse(x, top + 40, 11, 44, 0, 0, TAU); c.fill();
    }
  });
  cell(CELL.willow, () => {
    for (let k = 0; k < 11; k++) {
      const x = 40 + k * 43 + rr(rng, -12, 12), len = rr(rng, 360, 495);
      twig(x, 6, x + rr(rng, -14, 14), len, 2.5, 110);
      for (let q = 1; q < 26; q++) drawLeaf(c, x, (q / 26) * len, rr(rng, 38, 52), 7, Math.PI + (q % 2 ? 1 : -1) * rr(rng, 0.3, 0.6), rr(rng, 150, 240));
    }
  });
  cell(CELL.wildflower, () => {
    blades(16, 140, 372, 90, 220, 5);
    for (let k = 0; k < 11; k++) {
      const x = rr(rng, 70, 442), top = rr(rng, 60, 330);
      twig(x, 508, x + rr(rng, -16, 16), top, 3, 70);
      for (let p = 0; p < 6; p++) drawLeaf(c, x, top, 30, 14, (p / 6) * TAU, rr(rng, 225, 255));
      c.fillStyle = 'rgb(120,110,70)'; c.beginPath(); c.arc(x, top, 7, 0, TAU); c.fill();
    }
  });
  cell(CELL.rosette, () => {
    for (let k = 0; k < 22; k++) drawLeaf(c, 256 + rr(rng, -30, 30), 500, rr(rng, 300, 470), rr(rng, 22, 34), rr(rng, -1.15, 1.15), rr(rng, 130, 240));
  });
  cell(CELL.lily, () => {
    c.fillStyle = 'rgb(205,205,205)'; c.beginPath(); c.arc(256, 256, 236, 0.12, TAU - 0.12); c.lineTo(256, 256); c.fill();
    c.strokeStyle = 'rgb(250,250,250)'; c.lineWidth = 16; c.beginPath(); c.arc(256, 256, 228, 0.12, TAU - 0.12); c.stroke();
    c.strokeStyle = 'rgba(90,90,90,0.4)'; c.lineWidth = 3;
    for (let k = 0; k < 22; k++) { const a = 0.12 + (k / 22) * (TAU - 0.24); c.beginPath(); c.moveTo(256, 256); c.lineTo(256 + Math.cos(a) * 220, 256 + Math.sin(a) * 220); c.stroke(); }
  });

  // DataTexture: los píxeles transparentes conservan un gris medio para que el mipmapping no oscurezca bordes
  const img = c.getImageData(0, 0, S, S).data, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const src = y * S * 4, dst = (S - 1 - y) * S * 4;
    for (let x = 0; x < S * 4; x += 4) {
      const a = img[src + x + 3];
      if (a < 8) { data[dst + x] = 165; data[dst + x + 1] = 165; data[dst + x + 2] = 165; data[dst + x + 3] = 0; }
      else { data[dst + x] = img[src + x]; data[dst + x + 1] = img[src + x + 1]; data[dst + x + 2] = img[src + x + 2]; data[dst + x + 3] = a; }
    }
  }
  void cv;
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

function cellUV(i: number): [number, number, number, number] {
  const p = 0.012, col = i % GRID, row = Math.floor(i / GRID);
  return [col / GRID + p, 1 - (row + 1) / GRID + p, (col + 1) / GRID - p, 1 - row / GRID - p];
}

// ---------------------------------------------------------------- buffers
export class Buf {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; wind: number[] = []; idx: number[] = [];
  get count() { return this.pos.length / 3; }
  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: RGB, w = 0) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); this.col.push(c[0], c[1], c[2]); this.wind.push(w);
  }
  /** Tubo a lo largo de `pts` con radios `rad`. */
  tube(pts: THREE.Vector3[], rad: number[], sides: number, c: RGB, uRep = 1) {
    const base = this.count, t = new V3(), N = new V3(), B = new V3(), d = new V3(), p = new V3();
    let acc = 0;
    for (let k = 0; k < pts.length; k++) {
      t.subVectors(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]).normalize();
      const ref = Math.abs(t.y) > 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0);
      N.crossVectors(t, ref).normalize(); B.crossVectors(t, N);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * TAU;
        d.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
        p.copy(pts[k]).addScaledVector(d, rad[k]);
        this.vert(p, d, (s / sides) * uRep, acc * 0.45, c);
      }
      if (k < pts.length - 1) acc += pts[k].distanceTo(pts[k + 1]);
    }
    const row = sides + 1;
    for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < sides; s++) {
      const a = base + k * row + s, b = a + 1, cc = a + row, dd = cc + 1;
      this.idx.push(a, b, cc, b, dd, cc);
    }
  }
  /** Cuadrilátero texturado: `o` es el centro del borde inferior, `right` y `up` ya escalados. */
  card(o: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, cell: number, c: RGB, n: THREE.Vector3, wind0 = 0.3, wind1 = 1) {
    const [u0, v0, u1, v1] = cellUV(cell), b = this.count, p = new V3();
    this.vert(p.copy(o).addScaledVector(right, -0.5), n, u0, v0, c, wind0);
    this.vert(p.copy(o).addScaledVector(right, 0.5), n, u1, v0, c, wind0);
    this.vert(p.copy(o).addScaledVector(right, 0.5).add(up), n, u1, v1, c, wind1);
    this.vert(p.copy(o).addScaledVector(right, -0.5).add(up), n, u0, v1, c, wind1);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Tira arqueada (fronda) de `seg` tramos siguiendo `pts`. */
  strip(pts: THREE.Vector3[], width: number, cell: number, c: RGB) {
    const [u0, v0, u1, v1] = cellUV(cell), b = this.count, side = new V3(), t = new V3(), n = new V3(), p = new V3();
    for (let k = 0; k < pts.length; k++) {
      t.subVectors(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]).normalize();
      side.crossVectors(t, new V3(0, 1, 0)).normalize(); n.crossVectors(side, t).normalize();
      if (n.y < 0) n.negate();
      const f = k / (pts.length - 1), v = v0 + (v1 - v0) * f;
      this.vert(p.copy(pts[k]).addScaledVector(side, -width / 2), n, u0, v, c, f);
      this.vert(p.copy(pts[k]).addScaledVector(side, width / 2), n, u1, v, c, f);
      if (k < pts.length - 1) { const a = b + k * 2; this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setIndex(this.idx);
    return g;
  }
}

// ---------------------------------------------------------------- especies
export interface Spec {
  h: [number, number]; r: [number, number]; flare: number; bulge: number; twist: number;
  split: number; leader: boolean; branches: [number, number]; angle: [number, number]; len: [number, number];
  curl: number; sub: number; crown: 'round' | 'umbrella' | 'layer' | 'weep';
  cell: number; size: [number, number]; leaves: number; cluster: number; pal: RGB[];
  flower?: RGB; flowerRatio?: number; bark: 0 | 1 | 2; barkTint: RGB; variants?: number;
}
const G_SELVA: RGB[] = [[0.13, 0.36, 0.07], [0.17, 0.42, 0.08], [0.1, 0.3, 0.09], [0.22, 0.46, 0.09]];
const G_CHACO: RGB[] = [[0.26, 0.4, 0.1], [0.32, 0.42, 0.11], [0.22, 0.34, 0.1]];
const G_PAMPA: RGB[] = [[0.2, 0.38, 0.08], [0.26, 0.44, 0.09]];
const G_ANDINO: RGB[] = [[0.16, 0.36, 0.06], [0.24, 0.42, 0.06], [0.34, 0.5, 0.06], [0.9, 0.45, 0.05], [0.85, 0.24, 0.04], [0.8, 0.6, 0.07]];
const BROWN: RGB = [0.95, 0.85, 0.75], GREY: RGB = [1.15, 1.12, 1.05];

export const SPECIES: Record<string, Spec> = {
  timbo: { h: [10, 15], r: [0.34, 0.5], flare: 0.9, bulge: 0, twist: 0.1, split: 0.42, leader: false, branches: [5, 7], angle: [28, 62], len: [0.36, 0.5], curl: 0.1, sub: 3, crown: 'round', cell: CELL.broad, size: [1.5, 2.2], leaves: 7, cluster: 1.25, pal: G_SELVA, bark: 0, barkTint: BROWN },
  canafistula: { h: [12, 17], r: [0.32, 0.45], flare: 0.6, bulge: 0, twist: 0.08, split: 0.5, leader: false, branches: [5, 7], angle: [35, 72], len: [0.34, 0.46], curl: 0.05, sub: 3, crown: 'umbrella', cell: CELL.pinnate, size: [1.6, 2.3], leaves: 7, cluster: 1.3, pal: G_SELVA, flower: [1.3, 0.85, 0.04], flowerRatio: 0.3, bark: 0, barkTint: [0.75, 0.7, 0.68] },
  lapacho: { h: [8, 13], r: [0.24, 0.36], flare: 0.4, bulge: 0, twist: 0.12, split: 0.45, leader: false, branches: [5, 7], angle: [25, 60], len: [0.34, 0.45], curl: 0.12, sub: 3, crown: 'round', cell: CELL.broad, size: [1.3, 1.9], leaves: 6, cluster: 1.1, pal: G_SELVA, flower: [1.25, 0.28, 0.6], flowerRatio: 0.72, bark: 0, barkTint: [0.8, 0.76, 0.72] },
  jacaranda: { h: [8, 12], r: [0.22, 0.34], flare: 0.4, bulge: 0, twist: 0.14, split: 0.42, leader: false, branches: [5, 7], angle: [30, 65], len: [0.36, 0.46], curl: 0.08, sub: 3, crown: 'round', cell: CELL.pinnate, size: [1.4, 2.0], leaves: 6, cluster: 1.15, pal: G_SELVA, flower: [0.5, 0.26, 1.2], flowerRatio: 0.66, bark: 0, barkTint: [0.7, 0.68, 0.68] },
  ceibo: { h: [4.5, 7], r: [0.2, 0.3], flare: 0.5, bulge: 0, twist: 0.3, split: 0.38, leader: false, branches: [4, 6], angle: [35, 75], len: [0.4, 0.55], curl: 0.05, sub: 2, crown: 'round', cell: CELL.broad, size: [1.1, 1.6], leaves: 5, cluster: 0.9, pal: G_PAMPA, flower: [1.2, 0.05, 0.03], flowerRatio: 0.4, bark: 0, barkTint: [0.85, 0.8, 0.75] },
  paloBorracho: { h: [8, 12], r: [0.3, 0.42], flare: 0.2, bulge: 1.1, twist: 0.08, split: 0.55, leader: false, branches: [4, 6], angle: [40, 75], len: [0.32, 0.44], curl: 0.1, sub: 2, crown: 'umbrella', cell: CELL.broad, size: [1.3, 1.8], leaves: 5, cluster: 1.0, pal: G_CHACO, flower: [1.2, 0.5, 0.75], flowerRatio: 0.4, bark: 1, barkTint: [0.75, 1.05, 0.6] },
  algarrobo: { h: [6, 9.5], r: [0.26, 0.4], flare: 0.5, bulge: 0, twist: 0.3, split: 0.34, leader: false, branches: [5, 7], angle: [45, 80], len: [0.5, 0.7], curl: 0.06, sub: 3, crown: 'umbrella', cell: CELL.pinnate, size: [1.5, 2.1], leaves: 6, cluster: 1.2, pal: G_CHACO, bark: 1, barkTint: [0.75, 0.7, 0.65] },
  espinillo: { h: [3.2, 5], r: [0.12, 0.2], flare: 0.3, bulge: 0, twist: 0.35, split: 0.3, leader: false, branches: [4, 6], angle: [40, 78], len: [0.5, 0.7], curl: 0.05, sub: 2, crown: 'umbrella', cell: CELL.pinnate, size: [1.0, 1.5], leaves: 5, cluster: 0.8, pal: G_CHACO, flower: [1.2, 0.8, 0.05], flowerRatio: 0.38, bark: 1, barkTint: [0.6, 0.55, 0.5] },
  tala: { h: [5, 8], r: [0.2, 0.32], flare: 0.4, bulge: 0, twist: 0.34, split: 0.36, leader: false, branches: [5, 7], angle: [30, 70], len: [0.42, 0.58], curl: 0.08, sub: 3, crown: 'round', cell: CELL.small, size: [1.3, 1.9], leaves: 6, cluster: 1.05, pal: G_PAMPA, bark: 1, barkTint: [0.8, 0.76, 0.7] },
  ombu: { h: [8, 11], r: [0.75, 1.05], flare: 1.5, bulge: 0, twist: 0.12, split: 0.26, leader: false, branches: [6, 8], angle: [45, 82], len: [0.62, 0.85], curl: 0.1, sub: 3, crown: 'round', cell: CELL.broad, size: [1.8, 2.6], leaves: 7, cluster: 1.5, pal: G_PAMPA, bark: 0, barkTint: [1.0, 0.95, 0.88], variants: 2 },
  sauce: { h: [7, 10], r: [0.26, 0.38], flare: 0.5, bulge: 0, twist: 0.22, split: 0.42, leader: false, branches: [5, 7], angle: [35, 70], len: [0.4, 0.52], curl: -0.02, sub: 2, crown: 'weep', cell: CELL.willow, size: [2.6, 4.2], leaves: 5, cluster: 0.9, pal: [[0.28, 0.46, 0.1], [0.34, 0.52, 0.12]], bark: 0, barkTint: [0.8, 0.78, 0.72] },
  lenga: { h: [9, 15], r: [0.26, 0.4], flare: 0.5, bulge: 0, twist: 0.26, split: 0.36, leader: true, branches: [8, 11], angle: [62, 92], len: [0.3, 0.42], curl: 0.02, sub: 2, crown: 'layer', cell: CELL.small, size: [1.5, 2.3], leaves: 5, cluster: 0.9, pal: G_ANDINO, bark: 1, barkTint: GREY },
  nire: { h: [4, 7], r: [0.16, 0.26], flare: 0.4, bulge: 0, twist: 0.5, split: 0.3, leader: true, branches: [6, 8], angle: [55, 95], len: [0.42, 0.6], curl: 0.03, sub: 2, crown: 'layer', cell: CELL.small, size: [1.2, 1.8], leaves: 4, cluster: 0.75, pal: G_ANDINO, bark: 1, barkTint: [0.95, 0.92, 0.88] },
  coihue: { h: [15, 22], r: [0.4, 0.58], flare: 0.7, bulge: 0, twist: 0.08, split: 0.48, leader: true, branches: [8, 11], angle: [55, 85], len: [0.24, 0.34], curl: 0.04, sub: 2, crown: 'layer', cell: CELL.small, size: [1.8, 2.6], leaves: 5, cluster: 1.0, pal: G_ANDINO.slice(0, 3), bark: 1, barkTint: [0.85, 0.82, 0.78] },
  arrayan: { h: [5, 8], r: [0.18, 0.28], flare: 0.4, bulge: 0, twist: 0.42, split: 0.3, leader: false, branches: [4, 6], angle: [18, 50], len: [0.5, 0.66], curl: 0.1, sub: 3, crown: 'round', cell: CELL.small, size: [1.1, 1.6], leaves: 6, cluster: 0.85, pal: [[0.1, 0.28, 0.07], [0.14, 0.32, 0.08]], bark: 0, barkTint: [2.0, 0.85, 0.38] },
  araucaria: { h: [14, 20], r: [0.34, 0.46], flare: 0.4, bulge: 0, twist: 0.03, split: 0.66, leader: true, branches: [9, 12], angle: [78, 98], len: [0.22, 0.3], curl: 0.14, sub: 0, crown: 'layer', cell: CELL.needle, size: [1.7, 2.3], leaves: 4, cluster: 0.7, pal: [[0.08, 0.24, 0.08], [0.1, 0.28, 0.09]], bark: 1, barkTint: [0.7, 0.66, 0.62] },
};

export interface TreeGeo { wood: THREE.BufferGeometry; leaf: THREE.BufferGeometry; radius: number; height: number }

export function genTree(S: Spec, rng: Rng, opts: { hollowBase?: boolean } = {}): TreeGeo {
  const wood = new Buf(), leaf = new Buf();
  const h = rr(rng, S.h[0], S.h[1]), r0 = rr(rng, S.r[0], S.r[1]);
  const trunkH = S.leader ? h * 0.96 : h * S.split, nodes = S.leader ? 9 : 6;
  const path: THREE.Vector3[] = [], rad: number[] = [];
  const dir = new V3(rr(rng, -1, 1) * S.twist * 0.4, 1, rr(rng, -1, 1) * S.twist * 0.4).normalize();
  const p = new V3(0, -0.4, 0);
  for (let i = 0; i <= nodes; i++) {
    const t = i / nodes;
    path.push(p.clone());
    const taper = S.leader ? 1 - 0.9 * t : 1 - 0.38 * t;
    rad.push(r0 * (1 + S.flare * Math.exp(-t * 9)) * taper * (1 + S.bulge * Math.sin(Math.PI * clamp(t * 1.25, 0, 1)) ** 2));
    p.addScaledVector(dir, (trunkH + 0.4) / nodes);
    dir.x += rr(rng, -1, 1) * S.twist * 0.5; dir.z += rr(rng, -1, 1) * S.twist * 0.5; dir.normalize();
  }
  wood.tube(path, rad, 9, S.barkTint, 2);
  const at = (t: number) => {
    const f = clamp(t, 0, 1) * nodes, i = Math.min(nodes - 1, Math.floor(f));
    return { pos: path[i].clone().lerp(path[i + 1], f - i), r: rad[i] + (rad[i + 1] - rad[i]) * (f - i) };
  };
  const tips: { p: THREE.Vector3; d: THREE.Vector3 }[] = [];
  const limb = (o: THREE.Vector3, d0: THREE.Vector3, len: number, r: number, n: number, curl: number) => {
    const pts: THREE.Vector3[] = [], rs: number[] = [], d = d0.clone(), q = o.clone();
    for (let i = 0; i <= n; i++) {
      pts.push(q.clone()); rs.push(Math.max(0.025, r * (1 - 0.85 * (i / n))));
      q.addScaledVector(d, len / n);
      d.y += curl; d.x += rr(rng, -1, 1) * S.twist * 0.35; d.z += rr(rng, -1, 1) * S.twist * 0.35; d.normalize();
    }
    wood.tube(pts, rs, 5, S.barkTint, 1);
    return { pts, d };
  };
  const nb = Math.round(rr(rng, S.branches[0], S.branches[1]));
  const az0 = rng() * TAU;
  for (let b = 0; b < nb; b++) {
    const f = (b + 0.5) / nb;
    const t0 = S.leader ? S.split + (1 - S.split) * f * 0.97 : rr(rng, 0.82, 1);
    const o = at(S.leader ? t0 : t0);
    const az = az0 + b * 2.39996 + rr(rng, -0.3, 0.3);
    const ang = (rr(rng, S.angle[0], S.angle[1]) * Math.PI) / 180;
    const d = new V3(Math.sin(ang) * Math.cos(az), Math.cos(ang), Math.sin(ang) * Math.sin(az));
    const shrink = S.leader ? (S.cell === CELL.needle ? 0.75 + 0.5 * f : 1.15 - 0.75 * f) : 1;
    const len = rr(rng, S.len[0], S.len[1]) * h * shrink;
    const br = limb(o.pos, d, len, Math.max(0.05, o.r * 0.62), 4, S.curl);
    tips.push({ p: br.pts[4], d: br.d });
    for (let s = 0; s < S.sub; s++) {
      const k = 1 + (s % 3), sd = br.d.clone().applyAxisAngle(new V3(0, 1, 0), (s % 2 ? 1 : -1) * rr(rng, 0.5, 1.1));
      sd.y += 0.15; sd.normalize();
      const sb = limb(br.pts[k], sd, len * rr(rng, 0.38, 0.55), 0.05, 3, S.curl);
      tips.push({ p: sb.pts[3], d: sb.d });
    }
  }
  if (S.leader) tips.push({ p: path[nodes].clone(), d: new V3(0, 1, 0) });
  const center = new V3();
  for (const t of tips) center.add(t.p);
  center.multiplyScalar(1 / tips.length);
  let crownR = 0.5;
  for (const t of tips) crownR = Math.max(crownR, t.p.distanceTo(center));
  const base: RGB = S.pal[Math.floor(rng() * S.pal.length)];
  const up = new V3(0, 1, 0), o = new V3(), n = new V3(), right = new V3(), upv = new V3(), f = new V3();
  for (const tip of tips) {
    for (let l = 0; l < S.leaves; l++) {
      const s = rr(rng, S.size[0], S.size[1]);
      o.set(rr(rng, -1, 1), rr(rng, -1, 1) * (S.crown === 'umbrella' || S.crown === 'layer' ? 0.3 : 0.8), rr(rng, -1, 1)).multiplyScalar(S.cluster).add(tip.p);
      n.subVectors(o, center).normalize().multiplyScalar(0.75).addScaledVector(up, 0.55).normalize();
      const depth = smoothstep(0.15, 1, o.distanceTo(center) / crownR), hi = smoothstep(center.y - crownR, center.y + crownR, o.y);
      const ao = (0.5 + 0.5 * depth) * (0.72 + 0.28 * hi) * rr(rng, 0.85, 1.12);
      const isFlower = !!S.flower && rng() < (S.flowerRatio ?? 0) * (0.5 + hi);
      const cc: RGB = isFlower ? [S.flower![0] * ao, S.flower![1] * ao, S.flower![2] * ao] : [base[0] * ao, base[1] * ao, base[2] * ao];
      const cell = isFlower ? CELL.blossom : S.cell;
      if (S.crown === 'weep') {
        f.set(rr(rng, -1, 1), 0, rr(rng, -1, 1)).normalize();
        right.crossVectors(f, up).multiplyScalar(s * 0.34);
        // colgante: el borde superior de la textura queda en la rama
        leaf.card(o.clone().addScaledVector(up, -s), right, upv.set(0, s, 0), cell, cc, n, 1, 0.1);
      } else if (S.crown === 'layer') {
        f.set(rr(rng, -0.35, 0.35), 1, rr(rng, -0.35, 0.35)).normalize();
        right.set(rr(rng, -1, 1), 0, rr(rng, -1, 1)).normalize();
        upv.crossVectors(f, right).normalize().multiplyScalar(s);
        right.crossVectors(upv, f).normalize().multiplyScalar(s);
        leaf.card(o.clone().addScaledVector(upv, -0.5), right, upv, cell, cc, n, 0.6, 0.8);
      } else {
        f.set(rr(rng, -1, 1), rr(rng, -0.2, 1) + (S.crown === 'umbrella' ? 0.8 : 0), rr(rng, -1, 1)).normalize();
        right.crossVectors(f, new V3(rr(rng, -1, 1), rr(rng, -1, 1), rr(rng, -1, 1))).normalize();
        upv.crossVectors(right, f).normalize().multiplyScalar(s);
        right.multiplyScalar(s);
        leaf.card(o.clone().addScaledVector(upv, -0.5), right, upv, cell, cc, n, 0.6, 0.8);
      }
    }
  }
  void opts;
  return { wood: wood.geometry(), leaf: leaf.geometry(), radius: r0 * (1 + S.flare * 0.6), height: h };
}

function genPalm(rng: Rng): TreeGeo {
  const wood = new Buf(), leaf = new Buf();
  const h = rr(rng, 7, 11), path: THREE.Vector3[] = [], rad: number[] = [];
  const lean = rr(rng, -0.8, 0.8), lz = rr(rng, -0.8, 0.8);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    path.push(new V3(lean * t * t, -0.3 + (h + 0.3) * t, lz * t * t));
    rad.push(0.2 * (1 + 0.5 * Math.exp(-t * 8)) * (1 - 0.3 * t));
  }
  wood.tube(path, rad, 8, [0.95, 0.9, 0.8], 1);
  const top = path[8], nf = 15, col: RGB = [0.36, 0.66, 0.2];
  for (let k = 0; k < nf; k++) {
    const az = (k / nf) * TAU + rr(rng, -0.2, 0.2), el = rr(rng, 0.1, 1.15), len = rr(rng, 2.6, 3.6);
    const d = new V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)), q = top.clone(), pts: THREE.Vector3[] = [];
    for (let s = 0; s <= 6; s++) { pts.push(q.clone()); q.addScaledVector(d, len / 6); d.y -= 0.24; d.normalize(); }
    const sh = rr(rng, 0.8, 1.15);
    leaf.strip(pts, 1.25, CELL.frond, [col[0] * sh, col[1] * sh, col[2] * sh]);
  }
  return { wood: wood.geometry(), leaf: leaf.geometry(), radius: 0.3, height: h };
}

function genCardon(rng: Rng): TreeGeo {
  const wood = new Buf(), leaf = new Buf(), col: RGB = [0.55, 1.25, 0.5];
  const h = rr(rng, 3, 5.5), r = rr(rng, 0.18, 0.26);
  wood.tube([new V3(0, -0.3, 0), new V3(0, h * 0.5, 0), new V3(0, h, 0), new V3(0, h + 0.15, 0)], [r, r, r * 0.9, 0.03], 8, col, 3);
  const arms = Math.floor(rr(rng, 1, 4.9));
  for (let a = 0; a < arms; a++) {
    const az = rng() * TAU, y0 = rr(rng, 0.3, 0.6) * h, out = rr(rng, 0.45, 0.75), ah = rr(rng, 0.8, 2);
    const ox = Math.cos(az) * out, oz = Math.sin(az) * out;
    wood.tube([new V3(0, y0, 0), new V3(ox, y0 + 0.15, oz), new V3(ox, y0 + ah, oz), new V3(ox, y0 + ah + 0.12, oz)], [r * 0.7, r * 0.75, r * 0.7, 0.03], 7, col, 3);
  }
  leaf.card(new V3(0, h, 0), new V3(0.01, 0, 0), new V3(0, 0.01, 0), CELL.blossom, [1, 1, 1], new V3(0, 1, 0));
  return { wood: wood.geometry(), leaf: leaf.geometry(), radius: r + 0.1, height: h };
}

// plantas bajas: solo hojas
function genPlant(kind: string, rng: Rng): THREE.BufferGeometry {
  const b = new Buf(), up = new V3(0, 1, 0), W: RGB = [1, 1, 1];
  const cross = (cell: number, w: number, h: number, n = 2, tilt = 0) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI + rr(rng, -0.2, 0.2), right = new V3(Math.cos(a) * w, 0, Math.sin(a) * w);
      const upv = new V3(rr(rng, -tilt, tilt), 1, rr(rng, -tilt, tilt)).normalize().multiplyScalar(h);
      b.card(new V3(0, -0.04, 0), right, upv, cell, W, up, 0, 1);
    }
  };
  if (kind === 'fern') {
    for (let k = 0; k < 8; k++) {
      const az = (k / 8) * TAU + rr(rng, -0.25, 0.25), len = rr(rng, 0.9, 1.5), d = new V3(Math.cos(az) * 0.75, 0.75, Math.sin(az) * 0.75), q = new V3(0, 0.02, 0), pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 4; s++) { pts.push(q.clone()); q.addScaledVector(d, len / 4); d.y -= 0.32; d.normalize(); }
      b.strip(pts, 0.5, CELL.fern, W);
    }
  } else if (kind === 'cortadera') { cross(CELL.grass, 1.7, 1.25, 3, 0.2); cross(CELL.plume, 1.5, 2.3, 2, 0.12); }
  else if (kind === 'shrub') {
    for (let k = 0; k < 7; k++) {
      const o = new V3(rr(rng, -0.45, 0.45), rr(rng, 0.0, 0.7), rr(rng, -0.45, 0.45)), s = rr(rng, 0.9, 1.3);
      const f = new V3(rr(rng, -1, 1), rr(rng, 0, 1), rr(rng, -1, 1)).normalize(), right = new V3().crossVectors(f, up).normalize().multiplyScalar(s);
      b.card(o, right, new V3().crossVectors(right, f).normalize().multiplyScalar(s), k < 5 ? CELL.small : CELL.broad, W, o.clone().normalize().add(up).normalize(), 0.3, 0.8);
    }
  } else if (kind === 'rosette') cross(CELL.rosette, 1.3, 0.95, 3, 0.25);
  else if (kind === 'reed') cross(CELL.reed, 1.2, 2.0, 2, 0.08);
  else if (kind === 'flower') cross(CELL.wildflower, 0.7, 0.6, 2, 0.1);
  else cross(CELL.grass, 0.85, 0.55, 2, 0.15);
  return b.geometry();
}

// ---------------------------------------------------------------- siembra
const ZONE_TREES: Record<Zone, [string, number][]> = {
  selva: [['timbo', 3], ['canafistula', 2], ['lapacho', 2], ['jacaranda', 1.4], ['pindo', 2.6], ['ceibo', 0.8], ['paloBorracho', 0.6]],
  chaco: [['algarrobo', 3], ['paloBorracho', 2], ['espinillo', 1.5], ['timbo', 1], ['pindo', 0.7], ['lapacho', 0.6], ['cardon', 0.3]],
  atacama: [['cardon', 1]],
  pampa: [['tala', 2.5], ['ombu', 1], ['espinillo', 1], ['sauce', 0.7], ['ceibo', 0.6]],
  monte: [['algarrobo', 3], ['espinillo', 2], ['tala', 1], ['cardon', 0.3]],
  andino: [['lenga', 4], ['coihue', 2], ['nire', 1.6], ['arrayan', 1], ['araucaria', 1.4]],
  estepa: [['nire', 2], ['espinillo', 0.5]],
};
const ZONE_PLANTS: Record<Zone, [string, number, RGB][]> = {
  selva: [['fern', 3, [0.19, 0.36, 0.11]], ['shrub', 2, [0.17, 0.32, 0.10]], ['rosette', 1.2, [0.22, 0.36, 0.13]], ['flower', 0.8, [0.88, 0.28, 0.50]]],
  chaco: [['shrub', 2, [0.28, 0.34, 0.13]], ['rosette', 1.5, [0.28, 0.34, 0.17]], ['cortadera', 0.5, [0.39, 0.43, 0.20]], ['flower', 0.6, [0.94, 0.72, 0.11]]],
  atacama: [['rosette', 1, [0.33, 0.34, 0.20]], ['shrub', 0.4, [0.33, 0.31, 0.17]]],
  pampa: [['cortadera', 1.6, [0.41, 0.46, 0.20]], ['flower', 1.4, [0.94, 0.83, 0.17]], ['shrub', 0.6, [0.24, 0.34, 0.12]], ['flower', 0.8, [0.72, 0.39, 0.94]]],
  monte: [['shrub', 2.2, [0.29, 0.33, 0.13]], ['cortadera', 0.7, [0.44, 0.44, 0.22]], ['flower', 0.6, [0.99, 0.66, 0.11]]],
  andino: [['fern', 2.2, [0.20, 0.35, 0.10]], ['shrub', 1.6, [0.22, 0.35, 0.10]], ['flower', 1, [1.04, 0.25, 0.19]], ['flower', 0.7, [0.94, 0.88, 0.94]]],
  estepa: [['cortadera', 1.2, [0.52, 0.47, 0.23]], ['shrub', 1.4, [0.34, 0.34, 0.17]], ['flower', 0.4, [0.99, 0.83, 0.17]]],
};
const GRASS_TINT: Record<Zone, RGB> = {
  selva: [0.21, 0.50, 0.10], chaco: [0.35, 0.53, 0.14], atacama: [0.50, 0.56, 0.22], pampa: [0.38, 0.60, 0.14],
  monte: [0.41, 0.54, 0.17], andino: [0.35, 0.62, 0.11], estepa: [0.58, 0.64, 0.22],
};
function weighted<T>(rng: Rng, list: [T, number, ...any[]][]): number {
  let tot = 0; for (const e of list) tot += e[1];
  let r = rng() * tot;
  for (let i = 0; i < list.length; i++) { r -= list[i][1]; if (r <= 0) return i; }
  return list.length - 1;
}

export interface FloraOpts { quality: 'low' | 'high'; barks: THREE.Texture[]; sunDir: THREE.Vector3; sunColor: THREE.Color }

export class Flora {
  group = new THREE.Group();
  trunks: { x: number; z: number; r: number }[] = [];
  treeCount = 0; plantCount = 0;
  atlas = makeLeafAtlas();
  leafMat: THREE.MeshStandardMaterial; depthMat: THREE.MeshDepthMaterial; woodMats: THREE.MeshStandardMaterial[];
  uniforms = { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() } };

  constructor(private geo: Geo, private terrain: Terrain, private o: FloraOpts) {
    this.group.name = 'flora';
    this.uniforms.uSunDir.value.copy(o.sunDir); this.uniforms.uSunCol.value.copy(o.sunColor);
    for (const t of o.barks) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
    this.woodMats = o.barks.map((map) => new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.95 }));
    this.leafMat = new THREE.MeshStandardMaterial({ map: this.atlas, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82 });
    const wind = (sh: any) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWind;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
#else
  vec3 ip = modelMatrix[3].xyz;
#endif
float ph = ip.x * 0.37 + ip.z * 0.51 + position.y * 0.5 + position.x * 0.8;
transformed.x += sin(uTime * 1.5 + ph) * 0.05 * aWind;
transformed.z += cos(uTime * 1.2 + ph * 1.3) * 0.045 * aWind;
transformed.y += sin(uTime * 2.0 + ph * 0.7) * 0.02 * aWind;`);
    };
    this.leafMat.onBeforeCompile = (sh) => {
      wind(sh);
      sh.uniforms.uSunDir = this.uniforms.uSunDir; sh.uniforms.uSunCol = this.uniforms.uSunCol;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir; uniform vec3 uSunCol;')
        // normales "infladas": no se invierten en la cara trasera
        .replace('#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
float back = pow(clamp(dot(normalize(-vViewPosition), sunV), 0.0, 1.0), 3.0);
totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (0.03 + 0.5 * back);`);
    };
    this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.atlas, alphaTest: 0.42 });
    this.depthMat.onBeforeCompile = wind;
    this.plant();
  }

  private exclude(x: number, z: number) { return this.terrain.clear[this.geo.idx(x, z)] > 0.25; }
  private bare(x: number, z: number) { return this.terrain.bare[this.geo.idx(x, z)] === 1; }

  private plant() {
    const { geo, terrain } = this, low = this.o.quality === 'low', rng = mulberry32(2027);
    const gens: Record<string, TreeGeo[]> = {};
    const variants = (name: string) => {
      if (!gens[name]) {
        const n = SPECIES[name]?.variants ?? 3, list: TreeGeo[] = [];
        for (let v = 0; v < n; v++) list.push(name === 'pindo' ? genPalm(rng) : name === 'cardon' ? genCardon(rng) : genTree(SPECIES[name], rng));
        gens[name] = list;
      }
      return gens[name];
    };
    const inst: Record<string, { m: THREE.Matrix4; c: THREE.Color }[]> = {};
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new V3(0, 1, 0);
    const step = low ? 8.5 : 4.4;
    for (let z = geo.z0 + 2; z < geo.z0 + geo.h - 2; z += step) for (let x = geo.x0 + 2; x < geo.x0 + geo.w - 2; x += step) {
      const px = x + rr(rng, 0, step * 0.9), pz = z + rr(rng, 0, step * 0.9);
      if (geo.sample(geo.sdf, px, pz) < 1.6 || this.exclude(px, pz) || this.bare(px, pz)) continue;
      const rsd = geo.sample(geo.riverSd, px, pz);
      if (rsd < 1.3) continue;
      const y = terrain.heightAt(px, pz);
      if (y > 9.5) continue;
      const b = geo.biome(px, pz);
      if (rng() > b.density * 0.62 * (y > 6 ? 0.4 : 1)) continue;
      let list = ZONE_TREES[b.zone];
      if (rsd < 6 && (b.zone === 'pampa' || b.zone === 'chaco' || b.zone === 'monte')) list = [['sauce', 3], ['ceibo', 2], ...list];
      const lat = geo.lat(pz);
      let name = list[weighted(rng, list)][0];
      if (name === 'araucaria' && (lat > -36.5 || lat < -41)) name = 'lenga';
      const vs = variants(name), v = Math.floor(rng() * vs.length), key = `${name}:${v}`;
      const s = rr(rng, 0.8, 1.22);
      q.setFromAxisAngle(yAxis, rng() * TAU);
      m4.compose(new V3(px, y, pz), q, new V3(s, s * rr(rng, 0.92, 1.1), s));
      const tint = rr(rng, 0.86, 1.14);
      (inst[key] ??= []).push({ m: m4.clone(), c: new THREE.Color(tint, tint * rr(rng, 0.94, 1.06), tint * rr(rng, 0.9, 1.05)) });
      this.trunks.push({ x: px, z: pz, r: Math.max(0.28, vs[v].radius * s) });
      this.treeCount++;
    }
    for (const [key, list] of Object.entries(inst)) {
      const [name, v] = key.split(':'), tg = gens[name][+v];
      const bark = name === 'pindo' ? 2 : name === 'cardon' ? 1 : SPECIES[name].bark;
      const wood = new THREE.InstancedMesh(tg.wood, this.woodMats[bark], list.length);
      const leaf = new THREE.InstancedMesh(tg.leaf, this.leafMat, list.length);
      list.forEach((e, i) => { wood.setMatrixAt(i, e.m); leaf.setMatrixAt(i, e.m); wood.setColorAt(i, e.c); leaf.setColorAt(i, e.c); });
      wood.castShadow = leaf.castShadow = true; wood.receiveShadow = true;
      leaf.customDepthMaterial = this.depthMat;
      wood.name = `tronco:${key}`; leaf.name = `copa:${key}`;
      this.group.add(wood, leaf);
    }

    // sotobosque
    const plants: Record<string, { m: THREE.Matrix4; c: THREE.Color }[]> = {};
    const add = (kind: string, px: number, pz: number, s: number, c: RGB) => {
      q.setFromAxisAngle(yAxis, rng() * TAU);
      m4.compose(new V3(px, terrain.heightAt(px, pz), pz), q, new V3(s, s, s));
      const k = rr(rng, 0.8, 1.2);
      (plants[kind] ??= []).push({ m: m4.clone(), c: new THREE.Color(c[0] * k, c[1] * k, c[2] * k) });
      this.plantCount++;
    };
    const pstep = low ? 4.5 : 1.7;
    for (let z = geo.z0 + 2; z < geo.z0 + geo.h - 2; z += pstep) for (let x = geo.x0 + 2; x < geo.x0 + geo.w - 2; x += pstep) {
      const px = x + rr(rng, 0, pstep), pz = z + rr(rng, 0, pstep);
      if (geo.sample(geo.sdf, px, pz) < 1.2 || terrain.heightAt(px, pz) > 9 || this.bare(px, pz)) continue;
      const rsd = geo.sample(geo.riverSd, px, pz), b = geo.biome(px, pz);
      if (rsd < 0.3) continue;
      if (rsd < 2.2) { if (rng() < 0.55) add('reed', px, pz, rr(rng, 0.7, 1.15), [0.24, 0.4, 0.1]); continue; }
      if (this.exclude(px, pz)) { if (rng() < 0.12) add('flower', px, pz, rr(rng, 0.8, 1.3), [1.0, 0.8, 0.15]); continue; }
      if (rng() > 0.3 + 0.22 * Math.min(1.5, b.density)) continue;
      const e = ZONE_PLANTS[b.zone][weighted(rng, ZONE_PLANTS[b.zone])];
      add(e[0], px, pz, rr(rng, 0.75, 1.3), e[2]);
    }
    const gstep = low ? 3.2 : 0.8;
    for (let z = geo.z0 + 2; z < geo.z0 + geo.h - 2; z += gstep) for (let x = geo.x0 + 2; x < geo.x0 + geo.w - 2; x += gstep) {
      const px = x + rr(rng, 0, gstep), pz = z + rr(rng, 0, gstep);
      if (geo.sample(geo.sdf, px, pz) < 2 || geo.sample(geo.riverSd, px, pz) < 1 || terrain.heightAt(px, pz) > 8 || this.bare(px, pz)) continue;
      const b = geo.biome(px, pz);
      if (b.zone === 'atacama' || rng() > 0.62) continue;
      add('grass', px, pz, rr(rng, 0.6, 1.25), GRASS_TINT[b.zone]);
    }
    const prng = mulberry32(77);
    for (const [kind, list] of Object.entries(plants)) {
      const mesh = new THREE.InstancedMesh(genPlant(kind, prng), this.leafMat, list.length);
      list.forEach((e, i) => { mesh.setMatrixAt(i, e.m); mesh.setColorAt(i, e.c); });
      mesh.receiveShadow = true; mesh.castShadow = kind !== 'grass' && kind !== 'flower';
      mesh.customDepthMaterial = this.depthMat; mesh.name = `planta:${kind}`;
      this.group.add(mesh);
    }
  }

  /** Árbol suelto (no instanciado), p. ej. la Caña Fístula gigante. */
  single(spec: string | Spec, seed: number, scale = 1): THREE.Group {
    const S = typeof spec === 'string' ? SPECIES[spec] : spec;
    const tg = genTree(S, mulberry32(seed));
    const g = new THREE.Group();
    const wood = new THREE.Mesh(tg.wood, this.woodMats[S.bark]), leaf = new THREE.Mesh(tg.leaf, this.leafMat);
    wood.castShadow = leaf.castShadow = wood.receiveShadow = true; leaf.customDepthMaterial = this.depthMat;
    g.add(wood, leaf); g.scale.setScalar(scale);
    g.userData.radius = tg.radius * scale; g.userData.height = tg.height * scale;
    return g;
  }

  /** Plantas sueltas para decorar lugares (juncos, flores, helechos…). */
  scatter(kind: string, pts: [number, number, number, number][], color: RGB, seed = 5): THREE.InstancedMesh {
    const rng = mulberry32(seed), mesh = new THREE.InstancedMesh(genPlant(kind, rng), this.leafMat, pts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    pts.forEach(([x, y, z, s], i) => {
      q.setFromAxisAngle(new V3(0, 1, 0), rng() * TAU);
      mesh.setMatrixAt(i, m4.compose(new V3(x, y, z), q, new V3(s, s, s)));
      const k = rr(rng, 0.8, 1.2); mesh.setColorAt(i, new THREE.Color(color[0] * k, color[1] * k, color[2] * k));
    });
    mesh.customDepthMaterial = this.depthMat; mesh.castShadow = true;
    return mesh;
  }

  update(t: number) { this.uniforms.uTime.value = t; }
}
