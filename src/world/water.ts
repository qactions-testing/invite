// Agua: mar, ríos (cintas con flujo) y lagunas. Normales animadas, fresnel y destellos de sol.
import * as THREE from 'three';
import { Geo } from './geo';
import { mulberry32 } from '../util';

/** Mapa de normales teselable hecho con suma de ondas senoidales de frecuencia entera. */
export function makeWaterNormals(size = 256): THREE.DataTexture {
  const rng = mulberry32(99), waves: number[][] = [];
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((rng() * 2 - 1) * 11), ky = Math.round((rng() * 2 - 1) * 11);
    const k = Math.hypot(kx, ky) || 1;
    waves.push([kx, ky, 0.55 / k ** 0.9, rng() * 6.283]);
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let dx = 0, dy = 0;
    for (const [kx, ky, a, p] of waves) {
      const c = Math.cos(6.283185 * (kx * u + ky * v) + p) * a;
      dx += c * kx; dy += c * ky;
    }
    const nx = -dx * 0.16, ny = -dy * 0.16, l = Math.hypot(nx, ny, 1);
    const i = (y * size + x) * 4;
    data[i] = (nx / l * 0.5 + 0.5) * 255; data[i + 1] = (ny / l * 0.5 + 0.5) * 255; data[i + 2] = (1 / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export interface WaterOpts {
  mode: 'sea' | 'ribbon' | 'pond';
  deep: number; shallow: number; opacity: [number, number]; sdf?: THREE.Texture; sdfRect?: THREE.Vector4;
}

const VERT = /* glsl */ `
attribute float aDepth;
varying vec3 vW; varying vec2 vUv; varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz; vUv = uv; vDepth = aDepth;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */ `
uniform float uTime, uMode, uFogDensity; uniform vec2 uOpacity; uniform vec4 uSdfRect;
uniform vec3 uSunDir, uSunCol, uDeep, uShallow, uSky, uHorizon, uFogColor;
uniform sampler2D tN, tSdf;
varying vec3 vW; varying vec2 vUv; varying float vDepth;
void main() {
  vec2 c1, c2; float depth = vDepth, foam = 0.0;
  if (uMode > 0.5 && uMode < 1.5) { // cinta de río: v corre aguas abajo
    c1 = vec2(vUv.x * 0.21, (vUv.y - uTime * 0.55) * 0.13);
    c2 = vec2(vUv.x * 0.47 + 0.3, (vUv.y - uTime * 0.9) * 0.31);
  } else {
    c1 = vW.xz * 0.085 + uTime * vec2(0.012, 0.021);
    c2 = vW.xz * 0.27 - uTime * vec2(0.031, 0.017);
  }
  if (uMode < 0.5) {
    float sd = texture2D(tSdf, (vW.xz - uSdfRect.xy) / uSdfRect.zw).r;
    depth = smoothstep(0.5, -11.0, sd);
    float w = texture2D(tN, vW.xz * 0.12 + uTime * 0.02).r;
    foam = smoothstep(-1.6, -0.2, sd + sin(uTime * 0.9 + w * 9.0) * 0.5) * smoothstep(0.9, 0.2, sd) * (0.45 + 0.55 * w);
  }
  vec3 n1 = texture2D(tN, c1).xyz * 2.0 - 1.0, n2 = texture2D(tN, c2).xyz * 2.0 - 1.0;
  vec3 N = normalize(vec3(n1.x + n2.x * 0.7, 2.4, n1.y + n2.y * 0.7));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.45, R.y));
  // ríos y lagunas: a ángulo rasante reflejan el bosque oscuro, no el cielo
  if (uMode > 0.5) { sky = mix(vec3(0.035, 0.075, 0.04), sky * 0.75, smoothstep(0.22, 0.75, R.y)); fres *= 0.8; }
  float sd = max(dot(R, uSunDir), 0.0);
  vec3 sun = uSunCol * (pow(sd, 900.0) * 14.0 + pow(sd, 90.0) * 0.9 + pow(sd, 12.0) * 0.12);
  vec3 body = mix(uShallow, uDeep, depth);
  vec3 col = mix(body, sky, fres) + sun;
  col = mix(col, vec3(0.95, 0.97, 0.95), foam * 0.7);
  float alpha = clamp(mix(uOpacity.x, uOpacity.y, depth) + fres * (uMode > 1.5 ? 0.3 : 0.6) + foam, 0.0, 1.0);
  if (uMode > 0.5) alpha *= smoothstep(0.0, 0.3, vDepth);
  float dist = length(cameraPosition - vW);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Water {
  normals = makeWaterNormals();
  materials: THREE.ShaderMaterial[] = [];
  shared = {
    uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.8, 0.55) },
    uSky: { value: new THREE.Color(0.2, 0.34, 0.6) }, uHorizon: { value: new THREE.Color(0.85, 0.58, 0.36) },
    uFogColor: { value: new THREE.Color(0.7, 0.7, 0.7) }, uFogDensity: { value: 0.006 },
  };

  material(o: WaterOpts): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: {
        ...this.shared,
        uMode: { value: o.mode === 'sea' ? 0 : o.mode === 'ribbon' ? 1 : 2 },
        uDeep: { value: new THREE.Color(o.deep) }, uShallow: { value: new THREE.Color(o.shallow) },
        uOpacity: { value: new THREE.Vector2(o.opacity[0], o.opacity[1]) },
        tN: { value: this.normals }, tSdf: { value: o.sdf ?? null }, uSdfRect: { value: o.sdfRect ?? new THREE.Vector4(0, 0, 1, 1) },
      },
    });
    this.materials.push(m);
    return m;
  }

  sea(geo: Geo): THREE.Mesh {
    const data = new Float32Array(geo.w * geo.h);
    data.set(geo.sdf);
    const sdf = new THREE.DataTexture(data, geo.w, geo.h, THREE.RedFormat, THREE.FloatType);
    sdf.magFilter = sdf.minFilter = THREE.LinearFilter; sdf.needsUpdate = true;
    const g = new THREE.PlaneGeometry(5000, 5000, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(4).fill(1), 1));
    const m = new THREE.Mesh(g, this.material({ mode: 'sea', deep: 0x0b3552, shallow: 0x2fb7a6, opacity: [0.5, 0.97], sdf,
      sdfRect: new THREE.Vector4(geo.x0, geo.z0, geo.w - 1, geo.h - 1) }));
    m.position.y = 0; m.renderOrder = 2; m.name = 'mar';
    return m;
  }

  rivers(geo: Geo): THREE.Group {
    const group = new THREE.Group(); group.name = 'rios';
    for (const r of geo.rivers) {
      const pos: number[] = [], uv: number[] = [], dep: number[] = [], idx: number[] = [];
      for (let i = 0; i < r.n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(r.n - 1, i + 1);
        const dx = r.pts[b * 2] - r.pts[a * 2], dz = r.pts[b * 2 + 1] - r.pts[a * 2 + 1], l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l, hw = r.half[i] + 0.9, y = r.level[i] + 0.015;
        const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
        pos.push(x - nx * hw, y, z - nz * hw, x, y, z, x + nx * hw, y, z + nz * hw);
        uv.push(-hw, i, 0, i, hw, i);
        dep.push(0, 1, 0);
        if (i < r.n - 1) { const o = i * 3; idx.push(o, o + 1, o + 3, o + 1, o + 4, o + 3, o + 1, o + 2, o + 4, o + 2, o + 5, o + 4); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, this.material({ mode: 'ribbon', deep: r.main ? 0x1d5a4f : 0x236a5c, shallow: 0x6fb39a, opacity: [0.55, 0.9] }));
      mesh.renderOrder = 3; mesh.name = r.id;
      group.add(mesh);
    }
    return group;
  }

  pond(x: number, y: number, z: number, radius: number): THREE.Mesh {
    const seg = 48, rings = 6;
    const pos: number[] = [0, 0, 0], dep: number[] = [1], idx: number[] = [], uv: number[] = [0, 0];
    for (let r = 1; r <= rings; r++) for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2, rad = (r / rings) * radius;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad); uv.push(Math.cos(a) * rad, Math.sin(a) * rad);
      dep.push(1 - (r / rings) ** 2);
    }
    for (let s = 0; s < seg; s++) idx.push(0, 1 + ((s + 1) % seg), 1 + s);
    for (let r = 1; r < rings; r++) for (let s = 0; s < seg; s++) {
      const a = 1 + (r - 1) * seg + s, b = 1 + (r - 1) * seg + ((s + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, this.material({ mode: 'pond', deep: 0x0f3f3a, shallow: 0x6fb89c, opacity: [0.2, 0.5] }));
    mesh.position.set(x, y, z); mesh.renderOrder = 3; mesh.name = 'laguna';
    return mesh;
  }

  update(t: number) { this.shared.uTime.value = t; }
}
