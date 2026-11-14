// Geografía del mundo: contorno del Cono Sur → máscaras, distancias y trazado de ríos.
// Convención: x = este, z = sur (norte es -z), 1 unidad = 1 metro. Grilla de 1 m.
import { chamfer, clamp, lerp, Noise } from '../util';

export type Zone = 'selva' | 'chaco' | 'atacama' | 'pampa' | 'monte' | 'andino' | 'estepa';

export interface OutlineData {
  k: number; latC: number; lonC: number; cos: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  countries: Record<string, number[][]>;
}

export interface River {
  id: string; name: string; main: boolean;
  /** pares x,z muestreados cada ~1 m, de la naciente a la desembocadura */
  pts: Float32Array;
  half: Float32Array;
  /** altura de la superficie del agua en cada muestra (la completa terrain.ts) */
  level: Float32Array;
  n: number;
}

interface RiverDef { id: string; name: string; main?: boolean; half: [number, number]; ll: [number, number][]; into?: string; phase: number }

// [lon, lat] — un río grande (análogo Paraná–Plata) y tres arroyos.
const RIVER_DEFS: RiverDef[] = [
  { id: 'parana', name: 'Río Grande', main: true, half: [3.2, 5.5], phase: 0.3,
    ll: [[-54.5, -25.5], [-55.8, -27.2], [-58.7, -27.4], [-59.7, -29.6], [-60.6, -31.6], [-60.5, -33.0], [-59.0, -33.9], [-57.9, -34.7], [-56.5, -35.6]] },
  { id: 'bermejo', name: 'Arroyo Bermejo', half: [1.1, 1.7], phase: 1.7, into: 'parana',
    ll: [[-65.2, -23.3], [-63.6, -24.5], [-61.8, -25.7], [-60.2, -26.6], [-58.9, -27.35]] },
  { id: 'uruguay', name: 'Arroyo Uruguay', half: [1.2, 1.9], phase: 4.1, into: 'parana',
    ll: [[-53.9, -27.2], [-55.9, -28.5], [-57.5, -30.2], [-58.0, -31.8], [-58.3, -33.2], [-58.6, -34.05]] },
  { id: 'negro', name: 'Arroyo Negro', half: [1.2, 1.9], phase: 2.6,
    ll: [[-71.0, -40.0], [-69.0, -39.2], [-67.0, -39.1], [-65.3, -39.7], [-63.8, -40.6], [-62.4, -41.3]] },
];

export class Geo {
  k: number; latC: number; lonC: number; cos: number;
  x0: number; z0: number; w: number; h: number;
  land: Uint8Array; main: Uint8Array; chile: Uint8Array;
  sdf: Float32Array; sdfMain: Float32Array; andes: Float32Array;
  riverSd!: Float32Array; riverLv!: Float32Array;
  rings: { country: string; pts: number[] }[] = [];
  rivers: River[] = [];
  bounds: OutlineData['bounds'];
  private noise = new Noise(21);

  constructor(data: OutlineData) {
    this.k = data.k; this.latC = data.latC; this.lonC = data.lonC; this.cos = data.cos;
    this.bounds = data.bounds;
    const M = 16;
    this.x0 = Math.floor(data.bounds.minX) - M;
    this.z0 = Math.floor(data.bounds.minZ) - M;
    this.w = Math.ceil(data.bounds.maxX - data.bounds.minX) + 2 * M;
    this.h = Math.ceil(data.bounds.maxZ - data.bounds.minZ) + 2 * M;
    const { w, h } = this, N = w * h;

    let land = new Uint8Array(N);
    this.chile = new Uint8Array(N);
    for (const [country, rings] of Object.entries(data.countries)) {
      for (const pts of rings) {
        this.rings.push({ country, pts });
        this.fill(pts, land);
        if (country === 'Chile') this.fill(pts, this.chile);
      }
    }
    // cierre morfológico: une estrechos y tapa rendijas entre países vecinos
    land = this.erode(this.dilate(this.dilate(land)));
    land = this.erode(land);
    // lagunas encerradas → tierra
    const sea = this.flood(land, 0, 0, 0);
    for (let i = 0; i < N; i++) if (!sea[i]) land[i] = 1;
    this.land = land;
    this.main = this.flood(land, this.ix(0), this.iz(0), 1);

    const inv = (m: Uint8Array) => { const o = new Uint8Array(N); for (let i = 0; i < N; i++) o[i] = m[i] ? 0 : 1; return o; };
    const signed = (m: Uint8Array) => {
      const dIn = chamfer(inv(m), w, h), dOut = chamfer(m, w, h);
      const s = new Float32Array(N);
      for (let i = 0; i < N; i++) s[i] = m[i] ? dIn[i] - 0.5 : -(dOut[i] - 0.5);
      return s;
    };
    this.sdf = signed(land);
    this.sdfMain = signed(this.main);

    // Cordillera: distancia al límite Chile–Argentina
    const border = new Uint8Array(N);
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const c = j * w + i;
      if (!land[c] || !this.chile[c]) continue;
      for (const o of [1, -1, w, -w]) if (land[c + o] && !this.chile[c + o]) { border[c] = 1; break; }
    }
    this.andes = chamfer(border, w, h);
    this.buildRivers();
  }

  ix(x: number) { return clamp(Math.round(x - this.x0), 0, this.w - 1); }
  iz(z: number) { return clamp(Math.round(z - this.z0), 0, this.h - 1); }
  idx(x: number, z: number) { return this.iz(z) * this.w + this.ix(x); }
  /** lon/lat → [x, z] en metros de mundo */
  ll(lon: number, lat: number): [number, number] { return [(lon - this.lonC) * this.cos * this.k, (this.latC - lat) * this.k]; }
  lat(z: number) { return this.latC - z / this.k; }
  lon(x: number) { return this.lonC + x / (this.cos * this.k); }

  sample(f: Float32Array, x: number, z: number): number {
    const fx = clamp(x - this.x0, 0, this.w - 1.001), fz = clamp(z - this.z0, 0, this.h - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, c = j * this.w + i;
    return lerp(lerp(f[c], f[c + 1], tx), lerp(f[c + this.w], f[c + this.w + 1], tx), tz);
  }
  isLand(x: number, z: number) { return this.sample(this.sdf, x, z) > 0; }

  /** Bioma y densidad de bosque (0..1.6) según latitud/longitud, como en el mapa de cobertura arbórea. */
  biome(x: number, z: number): { zone: Zone; density: number } {
    const lat = this.lat(z), lon = this.lon(x);
    const j = this.noise.fbm(x * 0.021, z * 0.021, 3) * 1.6;
    const chile = this.chile[this.idx(x, z)] === 1;
    const ad = this.sample(this.andes, x, z);
    if (lat + j * 0.5 > -30.5) {
      if ((chile && lat > -31) || (lon < -66.8 && lat > -28.5)) return { zone: 'atacama', density: 0.12 };
      if (lon + j > -61.2) return { zone: 'selva', density: 1.55 };
      return { zone: 'chaco', density: 0.95 };
    }
    if (lat + j * 0.5 > -38.8) {
      if (chile) return lat < -34 ? { zone: 'andino', density: 1.4 } : { zone: 'monte', density: 0.6 };
      if (ad < 20 && lat < -36) return { zone: 'andino', density: 1.5 };
      if (lon + j > -63.8) return { zone: 'pampa', density: 0.42 };
      return { zone: 'monte', density: 0.75 };
    }
    if (chile || ad < 24 + j * 3) return { zone: 'andino', density: 1.6 };
    return { zone: 'estepa', density: 0.34 };
  }

  private fill(pts: number[], mask: Uint8Array) {
    const n = pts.length / 2;
    let minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < n; i++) { minZ = Math.min(minZ, pts[i * 2 + 1]); maxZ = Math.max(maxZ, pts[i * 2 + 1]); }
    const j0 = Math.max(0, Math.ceil(minZ - this.z0)), j1 = Math.min(this.h - 1, Math.floor(maxZ - this.z0));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + j + 1e-4;
      xs.length = 0;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const az = pts[a * 2 + 1], bz = pts[b * 2 + 1];
        if ((az > z) !== (bz > z)) xs.push(pts[a * 2] + ((z - az) / (bz - az)) * (pts[b * 2] - pts[a * 2]));
      }
      xs.sort((p, q) => p - q);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil(xs[q] - this.x0)), i1 = Math.min(this.w - 1, Math.floor(xs[q + 1] - this.x0));
        for (let i = i0; i <= i1; i++) mask[j * this.w + i] = 1;
      }
    }
  }
  private dilate(m: Uint8Array) {
    const { w, h } = this, o = new Uint8Array(m);
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const c = j * w + i;
      if (!m[c] && (m[c - 1] || m[c + 1] || m[c - w] || m[c + w] || m[c - w - 1] || m[c - w + 1] || m[c + w - 1] || m[c + w + 1])) o[c] = 1;
    }
    return o;
  }
  private erode(m: Uint8Array) {
    const { w, h } = this, o = new Uint8Array(m);
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const c = j * w + i;
      if (m[c] && !(m[c - 1] && m[c + 1] && m[c - w] && m[c + w] && m[c - w - 1] && m[c - w + 1] && m[c + w - 1] && m[c + w + 1])) o[c] = 0;
    }
    return o;
  }
  /** celdas conectadas a (i0,j0) cuyo valor en `m` es `val` */
  private flood(m: Uint8Array, i0: number, j0: number, val: number) {
    const { w, h } = this, out = new Uint8Array(w * h), stack = [j0 * w + i0];
    if ((m[stack[0]] ? 1 : 0) !== val) return out;
    out[stack[0]] = 1;
    while (stack.length) {
      const c = stack.pop()!, i = c % w, j = (c - i) / w;
      const push = (d: number) => { if (!out[d] && (m[d] ? 1 : 0) === val) { out[d] = 1; stack.push(d); } };
      if (i > 0) push(c - 1); if (i < w - 1) push(c + 1); if (j > 0) push(c - w); if (j < h - 1) push(c + w);
    }
    return out;
  }

  private buildRivers() {
    const byId: Record<string, River> = {};
    for (const def of RIVER_DEFS) {
      const ctrl = def.ll.map(([lon, lat]) => this.ll(lon, lat));
      // Catmull-Rom denso
      const dense: [number, number][] = [];
      for (let s = 0; s < ctrl.length - 1; s++) {
        const p0 = ctrl[Math.max(0, s - 1)], p1 = ctrl[s], p2 = ctrl[s + 1], p3 = ctrl[Math.min(ctrl.length - 1, s + 2)];
        for (let q = 0; q < 24; q++) {
          const t = q / 24, t2 = t * t, t3 = t2 * t;
          const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
          dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
        }
      }
      dense.push(ctrl[ctrl.length - 1]);
      // remuestreo a 1 m
      const even: [number, number][] = [dense[0]];
      let carry = 0;
      for (let i = 1; i < dense.length; i++) {
        const [ax, az] = dense[i - 1], [bx, bz] = dense[i];
        const seg = Math.hypot(bx - ax, bz - az);
        let d = 1 - carry;
        while (d <= seg) { even.push([ax + ((bx - ax) * d) / seg, az + ((bz - az) * d) / seg]); d += 1; }
        carry = (carry + seg) % 1;
      }
      // meandros
      const total = even.length;
      const pts: [number, number][] = [];
      for (let i = 0; i < total; i++) {
        const a = even[Math.max(0, i - 1)], b = even[Math.min(total - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        const taper = Math.min(1, i / 12, (total - 1 - i) / 12);
        const off = (Math.sin(i * 0.11 + def.phase) * 1.7 + Math.sin(i * 0.043 + def.phase * 2) * 2.6) * taper * (def.main ? 1.3 : 0.8);
        pts.push([even[i][0] - (dz / l) * off, even[i][1] + (dx / l) * off]);
      }
      // corta al llegar al mar o al río principal
      let end = pts.length;
      const into = def.into ? byId[def.into] : null;
      const nearest = (p: [number, number]) => {
        let near = 1e9, at = 0;
        for (let q = 0; q < into!.n; q++) {
          const d = Math.hypot(into!.pts[q * 2] - p[0], into!.pts[q * 2 + 1] - p[1]);
          if (d < near) { near = d; at = q; }
        }
        return [near, at];
      };
      let joined = false;
      for (let i = 8; i < pts.length; i++) {
        if (this.sample(this.sdf, pts[i][0], pts[i][1]) < -3) { end = i + 1; break; }
        if (into && nearest(pts[i])[0] < 1.5) { end = i + 1; joined = true; break; }
      }
      if (into && !joined) {
        // no llegó a tocar el río principal: prolonga en línea recta hasta él
        const last = pts[end - 1], [dist, at] = nearest(last);
        const tx = into.pts[at * 2], tz = into.pts[at * 2 + 1];
        for (let s = 1; s <= Math.ceil(dist); s++) pts.splice(end - 1 + s, 0, [lerp(last[0], tx, s / Math.ceil(dist)), lerp(last[1], tz, s / Math.ceil(dist))]);
        end += Math.ceil(dist);
      }
      const n = end;
      const r: River = { id: def.id, name: def.name, main: !!def.main, n, pts: new Float32Array(n * 2), half: new Float32Array(n), level: new Float32Array(n) };
      for (let i = 0; i < n; i++) {
        r.pts[i * 2] = pts[i][0]; r.pts[i * 2 + 1] = pts[i][1];
        r.half[i] = lerp(def.half[0], def.half[1], i / (n - 1)) * Math.min(1, 0.35 + i / 14);
      }
      byId[def.id] = r;
      this.rivers.push(r);
    }
  }
}
