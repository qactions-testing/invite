// Atmósfera del bosque: cielo de atardecer (Poly Haven), sol con sombras, niebla dorada,
// polvo y semillas voladoras, y aves sudamericanas.
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Geo } from './geo';
import { TAU, makeCanvas, mulberry32, rr } from '../util';

export interface SkyData { id: string; sunDir: [number, number, number]; ev?: number }

/** Azimut del sol en el mundo: oeste-noroeste (x = este, z = sur). */
const SUN_AZ = Math.atan2(-0.42, -0.9);
const LIGHT_ELEVATION = (17 * Math.PI) / 180;

export class Atmosphere {
  sunDir = new THREE.Vector3(); // hacia el sol (luz, algo más alta que el disco visible)
  sunVisual = new THREE.Vector3();
  sunColor = new THREE.Color(1.0, 0.6, 0.3);
  fogColor = new THREE.Color(0.72, 0.52, 0.36);
  light: THREE.DirectionalLight;
  dome: THREE.Mesh;
  dust: THREE.Points; seeds: THREE.Points;
  birds: Birds;
  private uni = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3() }, uPx: { value: 1 } };

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, sky: SkyData, skyTex: THREE.Texture, geo: Geo, quality: 'low' | 'high') {
    const [sx, sy, sz] = sky.sunDir;
    const delta = Math.atan2(sz, sx) - SUN_AZ; // rotación mundo → espacio del HDRI
    const el = Math.asin(sy);
    this.sunVisual.set(Math.cos(el) * Math.cos(SUN_AZ), Math.sin(el), Math.cos(el) * Math.sin(SUN_AZ));
    this.sunDir.set(Math.cos(LIGHT_ELEVATION) * Math.cos(SUN_AZ), Math.sin(LIGHT_ELEVATION), Math.cos(LIGHT_ELEVATION) * Math.sin(SUN_AZ));
    this.uni.uSun.value.copy(this.sunVisual);

    skyTex.colorSpace = THREE.SRGBColorSpace; skyTex.generateMipmaps = false;
    skyTex.minFilter = skyTex.magFilter = THREE.LinearFilter; skyTex.wrapS = THREE.RepeatWrapping;
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { tSky: { value: skyTex }, uRot: { value: delta }, uGain: { value: 1.35 } },
      vertexShader: `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform sampler2D tSky; uniform float uRot, uGain; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir); float c = cos(uRot), s = sin(uRot);
  d = vec3(d.x * c - d.z * s, max(d.y, -0.02), d.x * s + d.z * c);
  vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  vec3 col = texture2D(tSky, uv).rgb;
  gl_FragColor = vec4(col * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    }));
    this.dome.renderOrder = -10; this.dome.frustumCulled = false; this.dome.name = 'cielo';
    scene.add(this.dome);

    scene.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.0085);
    new RGBELoader().load('assets/sky/sky_1k.hdr', (hdr) => {
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromEquirectangular(hdr).texture;
      scene.environmentRotation.set(0, delta, 0);
      scene.environmentIntensity = 0.42;
      hdr.dispose(); pm.dispose();
    });

    this.light = new THREE.DirectionalLight(this.sunColor, 3.6);
    this.light.name = 'sol';
    if (quality === 'high') {
      this.light.castShadow = true;
      this.light.shadow.mapSize.set(2048, 2048);
      const c = this.light.shadow.camera;
      c.left = c.bottom = -46; c.right = c.top = 46; c.near = 1; c.far = 320;
      this.light.shadow.bias = -0.0004; this.light.shadow.normalBias = 0.06;
    }
    scene.add(this.light, this.light.target);
    scene.add(new THREE.HemisphereLight(0x86a6e0, 0x5a4a30, 0.14));

    // sol visible (para el bloom)
    const [gc, g] = makeCanvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,236,190,0.9)'); gr.addColorStop(0.4, 'rgba(255,170,90,0.22)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: new THREE.Color(1.6, 1.15, 0.65) }));
    glow.scale.setScalar(300); glow.position.copy(this.sunVisual).multiplyScalar(1500); glow.renderOrder = -9;
    this.dome.add(glow);

    this.dust = this.makePoints(quality === 'low' ? 250 : 1100, 26, 0.05, 'dust');
    this.seeds = this.makePoints(quality === 'low' ? 40 : 150, 34, 0.2, 'seed');
    scene.add(this.dust, this.seeds);
    this.birds = new Birds(geo, quality === 'low' ? 30 : 96, this.sunDir, this.sunColor, this.fogColor);
    scene.add(this.birds.mesh);
  }

  private makePoints(n: number, box: number, size: number, kind: 'dust' | 'seed'): THREE.Points {
    const rng = mulberry32(kind === 'dust' ? 5 : 6), pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = rng(); pos[i * 3 + 1] = rng(); pos[i * 3 + 2] = rng(); seed[i] = rng(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    let map: THREE.Texture | null = null;
    if (kind === 'seed') {
      // semilla voladora ("panadero"): vilano radial con la semilla colgando
      const [cv, c] = makeCanvas(128, 128);
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.6;
      for (let k = 0; k < 26; k++) { const a = (k / 26) * TAU; c.beginPath(); c.moveTo(64, 58); c.lineTo(64 + Math.cos(a) * 46, 58 + Math.sin(a) * 46); c.stroke(); }
      c.fillStyle = 'rgba(255,255,255,0.9)';
      for (let k = 0; k < 26; k++) { const a = (k / 26) * TAU; c.beginPath(); c.arc(64 + Math.cos(a) * 46, 58 + Math.sin(a) * 46, 2.4, 0, TAU); c.fill(); }
      c.fillStyle = 'rgba(120,90,60,1)'; c.beginPath(); c.ellipse(64, 66, 3, 6, 0, 0, TAU); c.fill();
      void cv; map = new THREE.CanvasTexture(cv);
    }
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: kind === 'dust' ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { ...this.uni, uBox: { value: box }, uSize: { value: size }, tMap: { value: map }, uKind: { value: kind === 'dust' ? 0 : 1 } },
      vertexShader: `attribute float aSeed; uniform float uTime, uBox, uSize, uPx, uKind; uniform vec3 uCam, uSun;
varying float vGlow, vSeed, vFade;
void main() {
  vec3 drift = uKind < 0.5
    ? vec3(sin(uTime * 0.11 + aSeed * 40.0) * 0.8 + uTime * 0.05, sin(uTime * 0.17 + aSeed * 70.0) * 0.5, cos(uTime * 0.13 + aSeed * 50.0) * 0.8)
    : vec3(uTime * (0.35 + aSeed * 0.3), sin(uTime * 0.4 + aSeed * 30.0) * 0.9 - uTime * 0.02, sin(uTime * 0.23 + aSeed * 60.0) * 1.4);
  vec3 p = mod(position * uBox + drift - uCam, uBox) - uBox * 0.5 + uCam;
  if (uKind > 0.5) p.y = uCam.y - 1.2 + mod(position.y * 9.0 + drift.y, 9.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = uSize * (0.6 + aSeed) * uPx / max(d, 0.3);
  vec3 toP = normalize(p - uCam);
  vGlow = pow(max(dot(toP, uSun), 0.0), 6.0);
  vSeed = aSeed; vFade = smoothstep(uBox * 0.5, uBox * 0.3, d) * smoothstep(0.3, 1.2, d);
}`,
      fragmentShader: `uniform sampler2D tMap; uniform float uKind, uTime; varying float vGlow, vSeed, vFade;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  if (uKind < 0.5) {
    float a = smoothstep(0.5, 0.0, length(q));
    gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * (0.35 + 3.2 * vGlow), a * a * vFade * (0.25 + 0.75 * vSeed));
  } else {
    float r = uTime * 0.3 * (vSeed - 0.5) + vSeed * 6.28, c = cos(r), s = sin(r);
    vec4 t = texture2D(tMap, vec2(q.x * c - q.y * s, q.x * s + q.y * c) + 0.5);
    gl_FragColor = vec4(t.rgb * vec3(1.0, 0.94, 0.84) * (0.8 + 1.6 * vGlow), t.a * vFade);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 5; pts.name = kind === 'dust' ? 'polvo' : 'semillas';
    return pts;
  }

  update(dt: number, t: number, cam: THREE.PerspectiveCamera, viewportH: number) {
    this.uni.uTime.value = t; this.uni.uCam.value.copy(cam.position);
    this.uni.uPx.value = viewportH / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this.dome.position.copy(cam.position);
    const tx = Math.round(cam.position.x / 2) * 2, tz = Math.round(cam.position.z / 2) * 2;
    this.light.target.position.set(tx, 0, tz);
    this.light.position.set(tx, 0, tz).addScaledVector(this.sunDir, 150);
    this.birds.update(dt, t, cam.position);
  }
}

// ---------------------------------------------------------------- aves
interface BirdKind { name: string; back: number; belly: number; head: number; beak: number; scale: number; flap: number; glide: number; alt: [number, number]; radius: [number, number]; speed: number; zone: (lat: number, lon: number) => boolean; n: number }
const BIRDS: BirdKind[] = [
  { name: 'hornero', back: 0x9a5a2c, belly: 0xd9b48a, head: 0x8a4d24, beak: 0x4a3a2a, scale: 0.26, flap: 15, glide: 0.1, alt: [4, 10], radius: [6, 16], speed: 5, zone: (lat) => lat > -40 && lat < -27, n: 14 },
  { name: 'benteveo', back: 0x6b5632, belly: 0xf2d21f, head: 0x1c1c1c, beak: 0x1a1a1a, scale: 0.3, flap: 13, glide: 0.15, alt: [5, 13], radius: [8, 20], speed: 6, zone: (lat) => lat > -40, n: 14 },
  { name: 'cardenal', back: 0x8d939a, belly: 0xf1f1ee, head: 0xd21c1c, beak: 0xe8e2d0, scale: 0.24, flap: 16, glide: 0.1, alt: [3, 9], radius: [5, 12], speed: 5, zone: (lat) => lat > -38 && lat < -26, n: 10 },
  { name: 'loro barranquero', back: 0x4f6b2a, belly: 0xe0b020, head: 0x3f5a2a, beak: 0x333333, scale: 0.42, flap: 11, glide: 0.2, alt: [8, 18], radius: [14, 30], speed: 8, zone: (lat) => lat < -34, n: 14 },
  { name: 'tucán', back: 0x121212, belly: 0xf4f0e6, head: 0x121212, beak: 0xff8a1a, scale: 0.5, flap: 9, glide: 0.35, alt: [10, 18], radius: [12, 26], speed: 7, zone: (lat, lon) => lat > -29 && lon > -62, n: 10 },
  { name: 'picaflor', back: 0x1f9a5c, belly: 0xd9efe0, head: 0x1a6fd0, beak: 0x222222, scale: 0.11, flap: 55, glide: 0, alt: [1.2, 3.5], radius: [1.5, 4], speed: 2.4, zone: (lat) => lat > -42, n: 12 },
  { name: 'carpintero gigante', back: 0x151515, belly: 0x1b1b1b, head: 0xd01818, beak: 0x777777, scale: 0.4, flap: 12, glide: 0.25, alt: [5, 12], radius: [8, 18], speed: 6, zone: (lat, lon) => lat < -38 && lon < -68, n: 8 },
  { name: 'cóndor', back: 0x151515, belly: 0x1c1c1c, head: 0xd8c8c0, beak: 0xe8e0d0, scale: 2.6, flap: 1.2, glide: 0.94, alt: [32, 52], radius: [28, 50], speed: 7, zone: (lat, lon) => lon < -66 && lat < -22, n: 8 },
  { name: 'tero', back: 0x8a8f8a, belly: 0xf3f3f3, head: 0x222222, beak: 0xd04040, scale: 0.34, flap: 10, glide: 0.2, alt: [3, 9], radius: [10, 22], speed: 7, zone: (lat, lon) => lat < -31 && lat > -39 && lon > -64, n: 6 },
];

export class Birds {
  mesh: THREE.InstancedMesh;
  kinds: string[] = [];
  private b: { ax: number; az: number; alt: number; rx: number; rz: number; w: number; ph: number; k: BirdKind; follow: boolean; ox: number; oz: number }[] = [];
  private uTime = { value: 0 };

  constructor(private geo: Geo, count: number, sunDir: THREE.Vector3, sunColor: THREE.Color, fogColor: THREE.Color) {
    const rng = mulberry32(31);
    // modelo: +z adelante, +y arriba, alas sobre x
    const pos: number[] = [], nor: number[] = [], tone: number[] = [], flap: number[] = [];
    const tri = (a: number[], b: number[], c: number[], tn: number, fl: number[]) => {
      const u = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), v = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]), n = u.cross(v).normalize();
      for (const [p, f] of [[a, fl[0]], [b, fl[1]], [c, fl[2]]] as [number[], number][]) { pos.push(p[0], p[1], p[2]); nor.push(n.x, n.y, n.z); tone.push(tn); flap.push(f); }
    };
    const body = new THREE.SphereGeometry(1, 7, 5).scale(0.3, 0.3, 0.95).toNonIndexed(), bp = body.getAttribute('position'), bn = body.getAttribute('normal');
    for (let i = 0; i < bp.count; i++) { pos.push(bp.getX(i), bp.getY(i), bp.getZ(i)); nor.push(bn.getX(i), bn.getY(i), bn.getZ(i)); tone.push(bn.getY(i) < -0.15 ? 1 : 0); flap.push(0); }
    const head = new THREE.SphereGeometry(0.27, 6, 5).translate(0, 0.14, 0.92).toNonIndexed(), hp = head.getAttribute('position'), hn = head.getAttribute('normal');
    for (let i = 0; i < hp.count; i++) { pos.push(hp.getX(i), hp.getY(i), hp.getZ(i)); nor.push(hn.getX(i), hn.getY(i), hn.getZ(i)); tone.push(2); flap.push(0); }
    tri([-0.07, 0.14, 1.12], [0.07, 0.14, 1.12], [0, 0.08, 1.55], 3, [0, 0, 0]);
    tri([0, 0.2, 1.12], [-0.07, 0.14, 1.12], [0, 0.08, 1.55], 3, [0, 0, 0]);
    tri([0.07, 0.14, 1.12], [0, 0.2, 1.12], [0, 0.08, 1.55], 3, [0, 0, 0]);
    tri([-0.16, 0.02, -0.8], [0.16, 0.02, -0.8], [0.3, 0.04, -1.6], 0, [0, 0, 0]);
    tri([-0.16, 0.02, -0.8], [0.3, 0.04, -1.6], [-0.3, 0.04, -1.6], 0, [0, 0, 0]);
    for (const s of [-1, 1]) {
      tri([s * 0.2, 0.1, 0.5], [s * 0.2, 0.1, -0.35], [s * 1.75, 0.1, -0.25], 0, [0, 0, 1.55]);
      tri([s * 0.2, 0.1, 0.5], [s * 1.75, 0.1, -0.25], [s * 1.2, 0.1, 0.42], 0, [0, 1.55, 1.0]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aTone', new THREE.Float32BufferAttribute(tone, 1));
    g.setAttribute('aFlap', new THREE.Float32BufferAttribute(flap, 1));

    const total = BIRDS.reduce((s, k) => s + k.n, 0);
    const cols = [0, 1, 2, 3].map(() => new Float32Array(count * 3)), par = new Float32Array(count * 3);
    let i = 0;
    for (const k of BIRDS) {
      const n = Math.max(1, Math.round((k.n / total) * count));
      for (let q = 0; q < n && i < count; q++, i++) {
        // busca un punto de anclaje dentro de la zona de la especie
        let ax = 0, az = 0;
        for (let tries = 0; tries < 60; tries++) {
          ax = rr(rng, geo.bounds.minX, geo.bounds.maxX); az = rr(rng, geo.bounds.minZ, geo.bounds.maxZ);
          if (geo.isLand(ax, az) && k.zone(geo.lat(az), geo.lon(ax))) break;
        }
        const follow = k.glide < 0.5 && q % 3 === 0; // un tercio acompaña al caminante
        this.b.push({ ax, az, alt: rr(rng, k.alt[0], k.alt[1]), rx: rr(rng, k.radius[0], k.radius[1]), rz: rr(rng, k.radius[0], k.radius[1]), w: (k.speed / rr(rng, k.radius[0], k.radius[1])) * (rng() < 0.5 ? -1 : 1), ph: rng() * TAU, k, follow, ox: rr(rng, -22, 22), oz: rr(rng, -22, 22) });
        [k.back, k.belly, k.head, k.beak].forEach((hex, c) => { const col = new THREE.Color(hex); cols[c].set([col.r, col.g, col.b], i * 3); });
        par.set([k.flap, rng() * TAU, k.glide], i * 3);
        this.kinds.push(k.name);
      }
    }
    count = i;
    ['iBack', 'iBelly', 'iHead', 'iBeak'].forEach((n, c) => g.setAttribute(n, new THREE.InstancedBufferAttribute(cols[c], 3)));
    g.setAttribute('iPar', new THREE.InstancedBufferAttribute(par, 3));
    const m = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: this.uTime, uSunDir: { value: sunDir }, uSunCol: { value: sunColor }, uFogColor: { value: fogColor }, uFogDensity: { value: 0.0085 } },
      vertexShader: `attribute float aTone, aFlap; attribute vec3 iBack, iBelly, iHead, iBeak, iPar; uniform float uTime;
varying vec3 vCol, vN; varying float vDist;
void main() {
  vec3 p = position;
  float beat = sin(uTime * iPar.x + iPar.y), amp = mix(1.05, 0.12, iPar.z);
  float ang = beat * amp + 0.15;
  p.y += aFlap * sin(ang); p.x *= mix(1.0, cos(ang), step(0.001, aFlap));
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vCol = aTone < 0.5 ? iBack : aTone < 1.5 ? iBelly : aTone < 2.5 ? iHead : iBeak;
  vec4 mv = viewMatrix * wp; vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `uniform vec3 uSunDir, uSunCol, uFogColor; uniform float uFogDensity; varying vec3 vCol, vN; varying float vDist;
void main() {
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 col = vCol * (vec3(0.42, 0.46, 0.55) + uSunCol * 1.6 * max(dot(n, uSunDir), 0.0) + 0.2 * max(n.y, 0.0));
  col = mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    this.mesh = new THREE.InstancedMesh(g, m, count);
    this.mesh.frustumCulled = false; this.mesh.name = 'aves';
  }

  update(dt: number, t: number, cam: THREE.Vector3) {
    this.uTime.value = t;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
    this.b.forEach((b, i) => {
      if (b.follow) { const k = Math.min(1, dt * 0.12); b.ax += (cam.x + b.ox - b.ax) * k; b.az += (cam.z + b.oz - b.az) * k; }
      const th = b.ph + t * b.w, c = Math.cos(th), sn = Math.sin(th);
      const ground = 0;
      p.set(b.ax + c * b.rx, ground + b.alt + Math.sin(th * 2.3 + b.ph) * (b.k.glide > 0.5 ? 2.5 : 0.9), b.az + sn * b.rz);
      const vx = -sn * b.rx * b.w, vz = c * b.rz * b.w;
      e.set(0, Math.atan2(vx, vz), -Math.sign(b.w) * 0.35 * (1 - b.k.glide * 0.5), 'YXZ');
      q.setFromEuler(e); s.setScalar(b.k.scale);
      this.mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
