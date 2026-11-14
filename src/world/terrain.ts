// Terreno: grilla de alturas de 1 m (cordillera, llanura, costas, cauces) y su malla.
import * as THREE from 'three';
import { Geo } from './geo';
import { Noise, clamp, lerp, smoothstep } from '../util';

export const SEA_LEVEL = 0;

export class Terrain {
  H: Float32Array;
  /** 1 = claro despejado (sin árboles, pasto) */
  clear: Float32Array;
  /** 1 = sin vegetación alguna (agua, construcciones, piso de la cueva) */
  bare: Uint8Array;
  mesh!: THREE.Mesh;
  private noise = new Noise(7);

  constructor(public geo: Geo) {
    const { w, h } = geo;
    this.H = new Float32Array(w * h);
    this.clear = new Float32Array(w * h);
    this.bare = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.H[j * w + i] = this.base(geo.x0 + i, geo.z0 + j);
    this.carveRivers();
  }

  private base(x: number, z: number): number {
    const g = this.geo, n = this.noise;
    const sd = g.sample(g.sdf, x, z);
    if (sd <= 0) return -Math.min(4, -sd * 0.32) - 0.05;
    const coast = smoothstep(0, 9, sd);
    const plains = 0.7 + 0.8 * (n.fbm(x * 0.018, z * 0.018, 3) * 0.5 + 0.5) + 0.3 * n.fbm(x * 0.07, z * 0.07, 2);
    const ad = g.sample(g.andes, x, z);
    const lat = g.lat(z);
    const amp = lerp(15, 6.5, smoothstep(-40, -52, lat)) * (0.78 + 0.3 * n.n(z * 0.045, 3.1));
    let ridge = amp * Math.exp(-((ad / 6.2) ** 2)) + 2.6 * Math.exp(-((ad / 15) ** 2));
    ridge *= 1 + 0.22 * n.fbm(x * 0.12, z * 0.12, 3);
    // sierras y lomas sueltas [lon, lat, radio m, alto m]
    let hills = 0;
    for (const [lon, lat0, r, a] of HILLS) {
      const [hx, hz] = g.ll(lon, lat0);
      hills += a * Math.exp(-(((x - hx) ** 2 + (z - hz) ** 2) / (r * r)));
    }
    return 0.06 + coast * (plains + ridge + hills);
  }

  private carveRivers() {
    const g = this.geo, { w, h } = g;
    g.riverSd = new Float32Array(w * h).fill(999);
    g.riverLv = new Float32Array(w * h);
    const byId: Record<string, (typeof g.rivers)[number]> = {};
    for (const r of g.rivers) {
      // nivel del agua: de la desembocadura hacia arriba, nunca decrece
      let mouth = SEA_LEVEL + 0.02;
      const lx = r.pts[(r.n - 1) * 2], lz = r.pts[(r.n - 1) * 2 + 1];
      if (g.sample(g.sdf, lx, lz) > 0) {
        // desemboca en otro río: toma su nivel
        let best = 1e9;
        for (const o of Object.values(byId)) for (let q = 0; q < o.n; q++) {
          const d = Math.hypot(o.pts[q * 2] - lx, o.pts[q * 2 + 1] - lz);
          if (d < best) { best = d; mouth = o.level[q]; }
        }
      }
      r.level[r.n - 1] = mouth;
      for (let i = r.n - 2; i >= 0; i--) {
        const b = this.heightAt(r.pts[i * 2], r.pts[i * 2 + 1]);
        r.level[i] = Math.max(r.level[i + 1], Math.min(b - 0.5, r.level[i + 1] + 0.12));
      }
      byId[r.id] = r;
      for (let i = 0; i < r.n; i++) {
        const px = r.pts[i * 2], pz = r.pts[i * 2 + 1], R = r.half[i] + 9;
        const i0 = Math.max(0, Math.floor(px - R - g.x0)), i1 = Math.min(w - 1, Math.ceil(px + R - g.x0));
        const j0 = Math.max(0, Math.floor(pz - R - g.z0)), j1 = Math.min(h - 1, Math.ceil(pz + R - g.z0));
        for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
          const d = Math.hypot(g.x0 + ii - px, g.z0 + j - pz) - r.half[i], c = j * w + ii;
          if (d < g.riverSd[c]) { g.riverSd[c] = d; g.riverLv[c] = r.level[i]; }
        }
      }
    }
    for (let c = 0; c < w * h; c++) {
      const sd = g.riverSd[c];
      if (sd > 8) continue;
      const L = g.riverLv[c];
      if (sd <= 0) this.H[c] = Math.min(this.H[c], L - 0.12 - 0.7 * smoothstep(0, 1.6, -sd));
      else this.H[c] = lerp(L + 0.1 + sd * 0.07, Math.max(this.H[c], L + 0.1), smoothstep(0, 8, sd));
    }
  }

  heightAt(x: number, z: number): number { return this.geo.sample(this.H, x, z); }

  /** Aplana un claro circular y devuelve su altura. */
  stampFlat(x: number, z: number, r: number, fall = 6, clearing = true, height?: number): number {
    const g = this.geo;
    let sum = 0, cnt = 0;
    this.disk(x, z, r, (c) => { sum += this.H[c]; cnt++; });
    const target = height ?? sum / Math.max(1, cnt);
    this.disk(x, z, r + fall, (c, d) => {
      const t = smoothstep(r, r + fall, d);
      this.H[c] = lerp(target, this.H[c], t);
      if (clearing) this.clear[c] = Math.max(this.clear[c], 1 - t);
    });
    void g;
    return target;
  }

  /** Excava una laguna; devuelve el nivel del agua. */
  stampPond(x: number, z: number, r: number, depth: number): number {
    const ground = this.stampFlat(x, z, r + 3, 7);
    const level = ground - 0.18;
    this.disk(x, z, r + 1.2, (c, d) => {
      const t = smoothstep(r + 1.2, r - 1.5, d);
      this.H[c] = lerp(ground, level - depth * (0.35 + 0.65 * smoothstep(r, 0, d)), t);
    });
    return level;
  }

  /** Marca un disco donde no crece nada. */
  stampBare(x: number, z: number, r: number) { this.disk(x, z, r, (c) => { this.bare[c] = 1; }); }

  private disk(x: number, z: number, R: number, fn: (c: number, d: number) => void) {
    const g = this.geo;
    const i0 = Math.max(0, Math.floor(x - R - g.x0)), i1 = Math.min(g.w - 1, Math.ceil(x + R - g.x0));
    const j0 = Math.max(0, Math.floor(z - R - g.z0)), j1 = Math.min(g.h - 1, Math.ceil(z + R - g.z0));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(g.x0 + i - x, g.z0 + j - z);
      if (d <= R) fn(j * g.w + i, d);
    }
  }

  build(tex: { forest: THREE.Texture; grass: THREE.Texture; rock: THREE.Texture; sand: THREE.Texture }): THREE.Mesh {
    const g = this.geo, { w, h } = g, n = this.noise;
    const pos = new Float32Array(w * h * 3), splat = new Float32Array(w * h * 4), col = new Float32Array(w * h * 3);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = j * w + i, x = g.x0 + i, z = g.z0 + j, y = this.H[c];
      pos[c * 3] = x; pos[c * 3 + 1] = y; pos[c * 3 + 2] = z;
      const hx = this.H[j * w + Math.min(w - 1, i + 1)] - this.H[j * w + Math.max(0, i - 1)];
      const hz = this.H[Math.min(h - 1, j + 1) * w + i] - this.H[Math.max(0, j - 1) * w + i];
      const slope = Math.hypot(hx, hz) * 0.5;
      const sd = g.sdf[c], rsd = g.riverSd[c];
      const b = g.biome(x, z);
      let sand = Math.max(smoothstep(2.6, 0.2, sd), smoothstep(1.6, -0.2, rsd), b.zone === 'atacama' ? 0.75 : 0, b.zone === 'estepa' ? 0.25 : 0);
      let rock = Math.max(smoothstep(0.5, 0.95, slope), smoothstep(7, 11, y) * 0.8);
      rock = clamp(rock, 0, 1) * (1 - sand * 0.6);
      const open = Math.max(this.clear[c], 1 - smoothstep(0.45, 1.0, b.density + 0.25 * n.n(x * 0.05, z * 0.05)));
      const rest = Math.max(0, 1 - sand - rock);
      splat[c * 4] = rest * (1 - open); splat[c * 4 + 1] = rest * open; splat[c * 4 + 2] = rock; splat[c * 4 + 3] = sand;
      // tinte por latitud + variación macro
      const lat = g.lat(z), m = 1 + 0.14 * n.fbm(x * 0.03 + 9, z * 0.03, 2);
      const north = smoothstep(-33, -27, lat), south = smoothstep(-37, -43, lat);
      let r = lerp(1.0, 0.8, north), gg = lerp(1.0, 1.02, north), bb = lerp(0.86, 0.74, north);
      r = lerp(r, 1.08, south); gg = lerp(gg, 1.04, south); bb = lerp(bb, 0.7, south);
      const snow = smoothstep(11.5, 14.5, y + 1.5 * n.n(x * 0.2, z * 0.2));
      col[c * 3] = lerp(r * m, 2.1, snow); col[c * 3 + 1] = lerp(gg * m, 2.15, snow); col[c * 3 + 2] = lerp(bb * m, 2.3, snow);
    }
    const index: number[] = [];
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      if (g.sdf[a] < -13 && g.sdf[b] < -13 && g.sdf[c] < -13 && g.sdf[d] < -13) continue;
      index.push(a, c, b, b, c, d);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setIndex(index);
    geom.computeVertexNormals();

    for (const t of Object.values(tex)) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tForest = { value: tex.forest }; sh.uniforms.tGrass = { value: tex.grass };
      sh.uniforms.tRock = { value: tex.rock }; sh.uniforms.tSand = { value: tex.sand };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tForest, tGrass, tRock, tSand;
varying vec4 vSplat; varying vec3 vWPos;
vec3 detail(sampler2D t, vec2 uv, float s) { return mix(texture2D(t, uv * s).rgb, texture2D(t, uv * s * 0.23 + 0.37).rgb, 0.4); }`)
        .replace('#include <map_fragment>', `
vec2 tuv = vWPos.xz;
vec3 terr = detail(tForest, tuv, 0.27) * vSplat.x * vec3(0.92, 1.0, 0.78)
          + detail(tGrass, tuv, 0.33) * vSplat.y * vec3(0.95, 1.25, 0.7)
          + detail(tRock, tuv, 0.16) * vSplat.z * 1.05
          + detail(tSand, tuv, 0.3) * vSplat.w * vec3(1.15, 1.08, 0.95);
diffuseColor.rgb *= terr / max(0.001, vSplat.x + vSplat.y + vSplat.z + vSplat.w);`);
    };
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terreno';
    return this.mesh;
  }
}

// [lon, lat, radio (m), alto (m)]
const HILLS: [number, number, number, number][] = [
  [-64.9, -31.6, 7, 3.2], // Sierras de Córdoba
  [-66.0, -33.2, 5, 2.2], // San Luis
  [-54.9, -26.8, 9, 2.6], // Misiones
  [-62.0, -38.1, 4.5, 1.9], // Ventania
  [-59.1, -37.4, 4, 1.4], // Tandilia
  [-56.0, -33.0, 8, 1.6], // cuchillas uruguayas
  [-66.5, -24.5, 9, 3.4], // Puna
];
