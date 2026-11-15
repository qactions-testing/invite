// Efectos: fuego que parpadea, retratos en las llamas, corazones/humo/vapor y destellos.
import * as THREE from 'three';
import { TAU, makeCanvas, mulberry32 } from './util';

/** Parpadeo de fuego: ~0.5–1.1, suma de senos incomensurables. */
export const flicker = (t: number, seed = 0) =>
  0.78 + 0.14 * Math.sin(t * 9.1 + seed) + 0.1 * Math.sin(t * 17.3 + seed * 2.1) + 0.08 * Math.sin(t * 31.7 + seed * 0.7);

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.7) + 0.2 * vnoise(p * 4.3 + 9.1); }`;
const TAIL = `\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n`;

export class Fire {
  group = new THREE.Group();
  light: THREE.PointLight | null = null;
  /** intensidad actual 0.5–1.1, para tests y audio */
  level = 1;
  private uTime = { value: 0 };
  private glow: THREE.Sprite;
  private base: number;

  constructor(size = 1, opts: { light?: number; seed?: number } = {}) {
    const seed = opts.seed ?? 1;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: this.uTime, uSeed: { value: seed } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime, uSeed; varying vec2 vUv; ${NOISE}
void main() {
  float y = vUv.y, x = vUv.x - 0.5;
  float n = fbm(vec2(vUv.x * 3.2 + uSeed * 7.0, y * 2.6 - uTime * 1.7));
  x += (n - 0.5) * 0.22 * y;
  float width = mix(0.36, 0.02, pow(y, 0.8));
  float body = smoothstep(width, width * 0.25, abs(x));
  float lick = smoothstep(0.25, 0.8, n + (1.0 - y) * 0.9 - 0.42);
  float f = body * lick * smoothstep(0.0, 0.07, y);
  vec3 col = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.68, 0.14), smoothstep(0.2, 0.7, f));
  col = mix(col, vec3(1.0, 0.96, 0.78), smoothstep(0.72, 1.0, f * (1.2 - y)));
  gl_FragColor = vec4(col * (0.85 + 0.6 * f), clamp(f * 1.25, 0.0, 1.0));${TAIL}
}`,
    });
    const geo = new THREE.PlaneGeometry(1.5 * size, 2.1 * size).translate(0, 1.0 * size, 0);
    for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(geo, mat); m.rotation.y = (k / 3) * Math.PI; m.renderOrder = 6; this.group.add(m); }

    // brasas que suben
    const n = 46, rng = mulberry32(seed * 13 + 1), pos = new Float32Array(n * 3), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = (rng() - 0.5) * 0.7 * size; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = (rng() - 0.5) * 0.7 * size; sd[i] = rng(); }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); eg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    const embers = new THREE.Points(eg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.uTime, uSize: { value: size } },
      vertexShader: `attribute float aSeed; uniform float uTime, uSize; varying float vA;
void main() {
  float life = fract(uTime * (0.18 + aSeed * 0.22) + aSeed * 17.0);
  vec3 p = position; p.y += life * 3.4 * uSize;
  p.x += sin(uTime * 2.0 + aSeed * 40.0) * 0.25 * life * uSize; p.z += cos(uTime * 1.7 + aSeed * 31.0) * 0.25 * life * uSize;
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.0 - life) * 26.0 * uSize / max(0.4, -mv.z); vA = 1.0 - life;
}`,
      fragmentShader: `varying float vA; void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * 3.0, smoothstep(0.5, 0.1, d) * vA);${TAIL} }`,
    }));
    embers.frustumCulled = false; embers.renderOrder = 7;
    this.group.add(embers);

    const [gc, g] = makeCanvas(96, 96), gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, 'rgba(255,190,90,0.9)'); gr.addColorStop(0.4, 'rgba(255,120,30,0.28)'); gr.addColorStop(1, 'rgba(255,90,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
    this.glow.position.y = 0.7 * size; this.glow.scale.setScalar(4.2 * size); this.glow.renderOrder = 5;
    this.group.add(this.glow);

    this.base = opts.light ?? 0;
    if (this.base > 0) {
      this.light = new THREE.PointLight(0xff8a3a, this.base, 22 * size, 1.6);
      this.light.position.y = 0.9 * size;
      this.group.add(this.light);
    }
    this.group.userData.seed = seed;
  }

  update(t: number) {
    this.uTime.value = t;
    this.level = flicker(t, this.group.userData.seed);
    this.glow.material.opacity = 0.22 + 0.16 * this.level;
    if (this.light) this.light.intensity = this.base * this.level;
  }
}

// ---------------------------------------------------------------- retratos de los novios
function drawCouple(): HTMLCanvasElement {
  const [cv, c] = makeCanvas(1024, 1024);
  const skin = '#e6b48c', hair = '#1d130d', white = '#fbf7ee', green = '#2f6b3f', vest = '#1f4a2c';
  const ell = (x: number, y: number, rx: number, ry: number, fill: string) => { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill(); };
  const limb = (x0: number, y0: number, x1: number, y1: number, w: number, col: string) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
  const face = (x: number, y: number) => {
    ell(x - 17, y - 2, 4.5, 6, '#2a1a12'); ell(x + 17, y - 2, 4.5, 6, '#2a1a12');
    c.strokeStyle = '#2a1a12'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - 25, y - 16); c.quadraticCurveTo(x - 17, y - 21, x - 9, y - 16); c.stroke();
    c.beginPath(); c.moveTo(x + 9, y - 16); c.quadraticCurveTo(x + 17, y - 21, x + 25, y - 16); c.stroke();
    c.strokeStyle = '#a1493a'; c.lineWidth = 3.5; c.beginPath(); c.arc(x, y + 14, 15, 0.2, Math.PI - 0.2); c.stroke();
    ell(x - 27, y + 12, 9, 6, 'rgba(230,110,100,0.4)'); ell(x + 27, y + 12, 9, 6, 'rgba(230,110,100,0.4)');
  };

  // ---- Agustina (izquierda): pelo morocho hasta el piso, vestido blanco tipo enagua de los 50
  const ax = 370, ankle = 912;
  c.fillStyle = hair; c.beginPath();
  // el pelo llega hasta los tobillos (no hasta el piso)
  c.moveTo(ax - 56, 250); c.bezierCurveTo(ax - 112, 420, ax - 122, 700, ax - 128, ankle - 14);
  c.quadraticCurveTo(ax, ankle + 16, ax + 122, ankle - 14); c.bezierCurveTo(ax + 118, 700, ax + 110, 420, ax + 56, 250);
  c.arc(ax, 250, 58, 0, Math.PI, true); c.fill();
  limb(ax - 22, 760, ax - 24, 935, 20, skin); limb(ax + 22, 760, ax + 24, 935, 20, skin);
  ell(ax - 28, 948, 22, 10, '#efe6d2'); ell(ax + 28, 948, 22, 10, '#efe6d2');
  // falda con vuelo y enagua de encaje
  c.fillStyle = white; c.beginPath(); c.moveTo(ax - 42, 468);
  c.bezierCurveTo(ax - 90, 560, ax - 150, 690, ax - 168, 770); c.lineTo(ax + 168, 770);
  c.bezierCurveTo(ax + 150, 690, ax + 90, 560, ax + 42, 468); c.closePath(); c.fill();
  for (let k = 0; k < 12; k++) ell(ax - 154 + k * 28, 772, 15, 13, '#fffdf6');
  c.strokeStyle = 'rgba(170,160,140,0.5)'; c.lineWidth = 2.5;
  for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(ax + k * 9, 480); c.quadraticCurveTo(ax + k * 30, 620, ax + k * 44, 762); c.stroke(); }
  // brazos, cuello y hombros
  limb(ax - 56, 345, ax - 82, 548, 19, skin); limb(ax + 56, 345, ax + 118, 520, 19, skin);
  c.fillStyle = skin; c.fillRect(ax - 13, 296, 26, 44); ell(ax, 346, 62, 20, skin);
  // corpiño con breteles finos
  c.fillStyle = white; c.beginPath(); c.moveTo(ax - 50, 372); c.quadraticCurveTo(ax - 25, 352, ax, 376); c.quadraticCurveTo(ax + 25, 352, ax + 50, 372);
  c.lineTo(ax + 42, 470); c.lineTo(ax - 42, 470); c.closePath(); c.fill();
  limb(ax - 34, 366, ax - 40, 334, 5, white); limb(ax + 34, 366, ax + 40, 334, 5, white);
  c.fillStyle = '#eadfc8'; c.fillRect(ax - 43, 462, 86, 10);
  ell(ax, 258, 45, 55, skin);
  c.fillStyle = hair; c.beginPath(); c.moveTo(ax, 200); c.bezierCurveTo(ax - 50, 198, ax - 56, 250, ax - 46, 300); c.lineTo(ax - 62, 300); c.bezierCurveTo(ax - 70, 230, ax - 44, 186, ax, 188);
  c.bezierCurveTo(ax + 44, 186, ax + 70, 230, ax + 62, 300); c.lineTo(ax + 46, 300); c.bezierCurveTo(ax + 56, 250, ax + 50, 198, ax, 200); c.fill();
  face(ax, 262);

  // ---- Gonzalo (derecha): traje verde con chaleco, camisa blanca holgada, zapatos de cuero marrones
  const gx = 668;
  limb(gx - 27, 580, gx - 30, 930, 46, green); limb(gx + 27, 580, gx + 30, 930, 46, green);
  ell(gx - 36, 952, 36, 14, '#6b3f1f'); ell(gx + 36, 952, 36, 14, '#6b3f1f');
  ell(gx - 44, 948, 10, 6, '#8a5a30'); ell(gx + 28, 948, 10, 6, '#8a5a30');
  // camisa holgada (mangas abullonadas asomando) y saco
  limb(gx - 82, 350, gx - 132, 520, 38, green); limb(gx + 82, 350, gx + 98, 575, 38, green);
  ell(gx - 136, 532, 22, 15, white); ell(gx + 99, 588, 22, 15, white);
  ell(gx - 140, 548, 12, 13, skin); ell(gx + 100, 606, 12, 13, skin);
  c.fillStyle = green; c.beginPath(); c.moveTo(gx - 84, 336); c.quadraticCurveTo(gx, 306, gx + 84, 336); c.lineTo(gx + 74, 612); c.lineTo(gx - 74, 612); c.closePath(); c.fill();
  c.fillStyle = vest; c.beginPath(); c.moveTo(gx - 36, 350); c.lineTo(gx + 36, 350); c.lineTo(gx + 34, 590); c.lineTo(gx, 606); c.lineTo(gx - 34, 590); c.closePath(); c.fill();
  c.fillStyle = white; c.beginPath(); c.moveTo(gx - 40, 322); c.lineTo(gx + 40, 322); c.lineTo(gx + 12, 430); c.lineTo(gx, 440); c.lineTo(gx - 12, 430); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(gx - 44, 318); c.lineTo(gx - 8, 334); c.lineTo(gx - 30, 368); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(gx + 44, 318); c.lineTo(gx + 8, 334); c.lineTo(gx + 30, 368); c.closePath(); c.fill();
  for (let k = 0; k < 4; k++) ell(gx, 462 + k * 34, 5, 5, '#d9b45a');
  c.strokeStyle = '#3d8550'; c.lineWidth = 7; c.beginPath(); c.moveTo(gx - 48, 330); c.lineTo(gx - 38, 470); c.moveTo(gx + 48, 330); c.lineTo(gx + 38, 470); c.stroke();
  c.fillStyle = skin; c.fillRect(gx - 14, 262, 28, 60);
  ell(gx, 222, 47, 57, skin);
  // pelo lacio y ondeado con flequillo
  c.fillStyle = hair; c.beginPath(); c.moveTo(gx - 54, 250);
  c.bezierCurveTo(gx - 66, 170, gx - 30, 150, gx, 152); c.bezierCurveTo(gx + 34, 150, gx + 66, 170, gx + 54, 250);
  c.bezierCurveTo(gx + 60, 262, gx + 52, 276, gx + 47, 282); c.lineTo(gx + 43, 214);
  c.quadraticCurveTo(gx + 30, 226, gx + 18, 210); c.quadraticCurveTo(gx + 6, 228, gx - 8, 212); c.quadraticCurveTo(gx - 22, 230, gx - 43, 216);
  c.lineTo(gx - 47, 282); c.bezierCurveTo(gx - 52, 276, gx - 60, 262, gx - 54, 250); c.fill();
  face(gx, 232);
  // manos tomadas
  ell(498, 532, 14, 12, skin);
  return cv;
}

export class Portraits {
  mesh: THREE.Mesh;
  /** 0 oculto … 1 visible */
  show = 0;
  /** si no es null, fuerza la visibilidad (tests / capturas) */
  force: number | null = null;
  private uni = { uTime: { value: 0 }, uShow: { value: 0 }, tMap: { value: null as THREE.Texture | null } };
  private wp = new THREE.Vector3();

  constructor(size = 2.6) {
    const tex = new THREE.CanvasTexture(drawCouple());
    tex.colorSpace = THREE.SRGBColorSpace;
    this.uni.tMap.value = tex;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).translate(0, size / 2, 0), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: this.uni,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tMap; uniform float uTime, uShow; varying vec2 vUv; ${NOISE}
void main() {
  float n = fbm(vec2(vUv.x * 3.0, vUv.y * 3.0 - uTime * 0.8));
  vec2 uv = vUv; uv.x += (n - 0.5) * 0.03 * (0.25 + vUv.y);
  vec4 t = texture2D(tMap, uv);
  float reveal = smoothstep(0.0, 0.35, uShow * 1.5 - vUv.y * 0.25 - n * 0.55);
  float edge = reveal * (1.0 - smoothstep(0.0, 0.5, uShow * 1.5 - vUv.y * 0.25 - n * 0.55 - 0.15));
  vec3 col = t.rgb * vec3(1.18, 1.02, 0.84) * 1.15 + vec3(1.0, 0.42, 0.08) * edge * 2.2;
  col += vec3(1.0, 0.5, 0.15) * 0.18 * (0.5 + 0.5 * sin(uTime * 7.0 + vUv.y * 9.0));
  gl_FragColor = vec4(col, t.a * reveal * 0.8);${TAIL}
}`,
    }));
    this.mesh.renderOrder = 8; this.mesh.name = 'retratos';
  }

  update(dt: number, t: number, cam: THREE.Vector3) {
    this.uni.uTime.value = t;
    // ciclo: aparece, se sostiene y se disuelve en el fuego
    const ph = (t % 18) / 18;
    const target = this.force ?? (ph < 0.72 ? 1 : 0);
    this.show += (target - this.show) * Math.min(1, dt * 0.9);
    this.uni.uShow.value = this.show;
    const p = this.mesh.getWorldPosition(this.wp);
    this.mesh.rotation.y = Math.atan2(cam.x - p.x, cam.z - p.z);
  }
}

// ---------------------------------------------------------------- partículas que suben (corazones, humo, vapor)
export function heartTexture(): THREE.Texture {
  const [cv, c] = makeCanvas(96, 96);
  const g = c.createRadialGradient(40, 36, 4, 48, 48, 50);
  g.addColorStop(0, '#ffc3d0'); g.addColorStop(0.5, '#ff4f7a'); g.addColorStop(1, '#c81e4a');
  c.fillStyle = g; c.beginPath(); c.moveTo(48, 84);
  c.bezierCurveTo(4, 52, 6, 12, 30, 12); c.bezierCurveTo(42, 12, 48, 22, 48, 30);
  c.bezierCurveTo(48, 22, 54, 12, 66, 12); c.bezierCurveTo(90, 12, 92, 52, 48, 84); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.ellipse(30, 30, 7, 10, -0.5, 0, TAU); c.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function puffTexture(): THREE.Texture {
  const [cv, c] = makeCanvas(64, 64), g = c.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
export interface PuffOpts { rate: number; life: number; rise: number; size: [number, number]; sway: number; opacity: number; color?: number; additive?: boolean }

export class Puffs {
  group = new THREE.Group();
  /** partículas vivas (tests) */
  alive = 0;
  private pool: { s: THREE.Sprite; age: number; life: number; o: THREE.Vector3; ph: number }[] = [];
  private acc = 0; private next = 0;
  private rng = mulberry32(8);

  constructor(tex: THREE.Texture, private emitters: THREE.Vector3[], private o: PuffOpts, n = 28) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: o.color ?? 0xffffff, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false }));
      s.visible = false; s.renderOrder = 9; this.group.add(s);
      this.pool.push({ s, age: 0, life: 0, o: new THREE.Vector3(), ph: 0 });
    }
  }
  update(dt: number) {
    this.acc += dt * this.o.rate * this.emitters.length;
    while (this.acc >= 1) {
      this.acc -= 1;
      const p = this.pool.find((q) => q.age >= q.life);
      if (!p) break;
      const e = this.emitters[this.next++ % this.emitters.length];
      p.o.copy(e); p.o.x += (this.rng() - 0.5) * 0.12; p.o.z += (this.rng() - 0.5) * 0.12;
      p.age = 0; p.life = this.o.life * (0.8 + 0.4 * this.rng()); p.ph = this.rng() * TAU; p.s.visible = true;
    }
    this.alive = 0;
    for (const p of this.pool) {
      if (p.age >= p.life) { p.s.visible = false; continue; }
      p.age += dt; this.alive++;
      const k = p.age / p.life;
      p.s.position.set(p.o.x + Math.sin(p.ph + p.age * 2.2) * this.o.sway * k, p.o.y + this.o.rise * p.age, p.o.z + Math.cos(p.ph * 1.3 + p.age * 1.7) * this.o.sway * k);
      p.s.scale.setScalar(this.o.size[0] + (this.o.size[1] - this.o.size[0]) * k);
      p.s.material.opacity = this.o.opacity * Math.min(1, k * 6) * (1 - k) ** 0.7;
    }
  }
}

/** Destello flotante que marca un objeto con mensaje. */
let sparkleTex: THREE.Texture | null = null;
export function sparkle(): THREE.Sprite {
  if (!sparkleTex) {
    const [cv, c] = makeCanvas(64, 64);
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.25, 'rgba(255,220,140,0.5)'); g.addColorStop(1, 'rgba(255,200,100,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    c.strokeStyle = 'rgba(255,252,235,0.95)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(32, 3); c.lineTo(32, 61); c.moveTo(3, 32); c.lineTo(61, 32); c.stroke();
    sparkleTex = new THREE.CanvasTexture(cv);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkleTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, color: new THREE.Color(1.6, 1.4, 1.0) }));
  s.scale.setScalar(0.3); s.renderOrder = 10; s.name = 'destello';
  return s;
}
