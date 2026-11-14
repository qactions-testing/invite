// Escena del bosque: terreno, agua, flora, atmósfera, los tres espacios naturales
// y los exteriores (con puerta) de las tres salas.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Circle, CircleHash, GameScene, Interactable, pushOut } from '../core';
import { PLACES, SPAWN_LL } from '../content/ideas';
import { Geo, OutlineData } from './geo';
import { Terrain } from './terrain';
import { Water } from './water';
import { Buf, CELL, Flora, SPECIES } from './flora';
import { Atmosphere, SkyData } from './atmosphere';
import { TexLib, applyBaked, loadLightmap } from './rooms';
import { Fire, Portraits, Puffs, puffTexture, sparkle } from '../fx';
import { Nav } from '../player';
import { TAU, makeCanvas, mulberry32, rr } from '../util';

const V3 = THREE.Vector3;
interface CaveMeta { lightK: number; corridor: Circle[]; shell: Circle[]; solids?: Circle[]; glows?: [number, number, number][]; shaft?: [number, number, number] }
interface DoorSpot { pos: THREE.Vector3; yaw: number }

export class ForestScene implements GameScene {
  id = 'bosque'; name = 'Bosque del Cono Sur'; indoor = false;
  scene = new THREE.Scene();
  interactables: Interactable[] = [];
  geo!: Geo; terrain!: Terrain; water = new Water(); flora!: Flora; atmo!: Atmosphere; nav!: Nav;
  placePos: Record<string, { x: number; z: number }> = {};
  doors: Record<string, DoorSpot> = {};
  spawn = { pos: new V3(), yaw: 0 };
  fire!: Fire; portraits!: Portraits;
  pond = { x: 0, z: 0, r: 7.5, level: 0 };
  fishCount = 0;
  private hash = new CircleHash(4);
  private solids: Circle[] = [];
  private cave: { x: number; z: number; meta: CaveMeta } | null = null;
  private updaters: ((dt: number, t: number, cam: THREE.Vector3) => void)[] = [];
  private sparkles: THREE.Sprite[] = [];
  private rockMat!: THREE.MeshStandardMaterial;
  private rng = mulberry32(606);

  static async create(renderer: THREE.WebGLRenderer, lib: TexLib, quality: 'low' | 'high', progress: (p: number, t: string) => void): Promise<ForestScene> {
    const f = new ForestScene();
    progress(0.05, 'Trazando el Cono Sur…');
    const [outline, sky, skyTex] = await Promise.all([
      fetch('assets/outline.json').then((r) => r.json() as Promise<OutlineData>),
      fetch('assets/sky/sky.json').then((r) => r.json() as Promise<SkyData>),
      new THREE.TextureLoader().loadAsync('assets/sky/sky.jpg'),
      lib.ready(['forest_leaves_02', 'leafy_grass', 'cliff_side', 'coast_sand_01', 'mossy_rock', 'bark_brown_02', 'pine_bark', 'palm_tree_bark',
        'brown_planks_09', 'plastered_wall_04', 'clay_roof_tiles_02', 'old_stone_wall']),
    ]);
    progress(0.3, 'Levantando la cordillera…');
    await tick();
    f.geo = new Geo(outline);
    f.terrain = new Terrain(f.geo);
    for (const p of PLACES) { const [x, z] = f.geo.ll(p.ll[0], p.ll[1]); f.placePos[p.id] = { x, z }; }
    const [sx, sz] = f.geo.ll(SPAWN_LL[0], SPAWN_LL[1]);

    // claros y lagunas (antes de construir la malla y sembrar)
    const P = f.placePos, T = f.terrain;
    f.pond = { x: P.estanque.x, z: P.estanque.z, r: 7.5, level: T.stampPond(P.estanque.x, P.estanque.z, 7.5, 1.15) };
    T.stampFlat(P.fogata.x, P.fogata.z, 6.5, 7);
    T.stampFlat(P.cueva.x, P.cueva.z, 10, 5);
    T.stampFlat(P.cana.x, P.cana.z, 8, 7);
    T.stampFlat(P.abuelas.x, P.abuelas.z, 8.5, 6);
    T.stampFlat(P.gnomos.x, P.gnomos.z, 6.5, 6);
    T.stampFlat(sx, sz, 4.5, 8);
    // donde no debe crecer nada: agua del estanque, fogón, construcciones y la roca de la cueva
    T.stampBare(P.estanque.x, P.estanque.z, 7.9);
    T.stampBare(P.fogata.x, P.fogata.z, 1.4);
    T.stampBare(P.cana.x, P.cana.z, 3.0); T.stampBare(P.abuelas.x, P.abuelas.z, 4.4); T.stampBare(P.gnomos.x, P.gnomos.z, 2.4);
    for (const [dx, dz, r] of [[-2.2, -0.4, 8.6], [2.0, 0.6, 4.2], [5.6, 0.9, 3.8], [8.6, 0.2, 3.2]]) T.stampBare(P.cueva.x + dx, P.cueva.z + dz, r);

    f.scene.add(T.build({ forest: lib.get('forest_leaves_02'), grass: lib.get('leafy_grass'), rock: lib.get('cliff_side'), sand: lib.get('coast_sand_01') }));
    f.scene.add(f.water.sea(f.geo), f.water.rivers(f.geo));
    progress(0.45, 'Encendiendo el atardecer…');
    await tick();
    f.atmo = new Atmosphere(f.scene, renderer, sky, skyTex, f.geo, quality);
    f.water.shared.uSunDir.value.copy(f.atmo.sunVisual);
    f.water.shared.uFogColor.value.copy(f.atmo.fogColor);
    f.water.shared.uFogDensity.value = (f.scene.fog as THREE.FogExp2).density;
    progress(0.55, 'Sembrando árboles nativos…');
    await tick();
    f.flora = new Flora(f.geo, T, { quality, barks: [lib.get('bark_brown_02'), lib.get('pine_bark'), lib.get('palm_tree_bark')], sunDir: f.atmo.sunVisual, sunColor: f.atmo.sunColor });
    f.scene.add(f.flora.group);
    for (const t of f.flora.trunks) f.hash.add(t);
    f.rockMat = new THREE.MeshStandardMaterial({ map: lib.get('mossy_rock'), roughness: 1 });

    progress(0.75, 'Armando los lugares…');
    await tick();
    f.spawn.pos.set(sx, T.heightAt(sx, sz), sz);
    f.buildPond();
    f.buildFire();
    await f.buildCave(lib);
    f.buildCana(lib, sx, sz);
    f.buildCottage(lib, sx, sz);
    f.buildGnomeHouse(lib, sx, sz);
    f.scatterRocks();

    // de entrada se mira hacia la fogata, con el sol de costado
    f.spawn.yaw = Math.atan2(-(P.fogata.x - sx), -(P.fogata.z - sz));
    f.nav = new Nav(f.geo, (x, z) => T.heightAt(x, z), (x, z) => f.blocked(x, z));
    progress(0.95, 'Soltando los pájaros…');
    return f;
  }

  // ------------------------------------------------------------ helpers
  private y(x: number, z: number) { return this.terrain.heightAt(x, z); }
  private solid(x: number, z: number, r: number) { const c = { x, z, r }; this.solids.push(c); this.hash.add(c); }
  private blocked(x: number, z: number): boolean {
    for (const c of this.solids) if (c.r > 0.6 && Math.hypot(x - c.x, z - c.z) < c.r + 0.7) return true;
    if (this.cave) {
      const lx = x - this.cave.x, lz = z - this.cave.z;
      const inShell = this.cave.meta.shell.some((c) => Math.hypot(lx - c.x, lz - c.z) < c.r + 0.6);
      if (inShell && !this.cave.meta.corridor.some((c) => Math.hypot(lx - c.x, lz - c.z) < c.r - 0.5)) return true;
    }
    return false;
  }
  private addRead(placeId: string, objId: string, object: THREE.Object3D, pos: THREE.Vector3) {
    const def = PLACES.find((p) => p.id === placeId)!.objects.find((o) => o.id === objId)!;
    object.traverse((c) => { c.userData.interactId = objId; });
    this.interactables.push({ id: objId, placeId, name: def.name, action: 'read', message: def.message, object, pos });
    const s = sparkle(); s.position.copy(pos).add(new V3(0, 0.3, 0)); this.scene.add(s); this.sparkles.push(s);
  }
  private addDoor(room: string, object: THREE.Object3D, pos: THREE.Vector3, out: THREE.Vector3) {
    const place = PLACES.find((p) => p.id === room)!;
    object.traverse((c) => { c.userData.interactId = `puerta-${room}`; });
    this.interactables.push({ id: `puerta-${room}`, placeId: room, name: place.name, action: 'door', target: room, object, pos });
    const at = pos.clone().addScaledVector(out, 1.7);
    at.y = this.y(at.x, at.z);
    this.doors[room] = { pos: at, yaw: Math.atan2(-out.x, -out.z) };
  }
  private rock(size: number, seed: number, flat = 0.7): THREE.Mesh {
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.getAttribute('position'), r = mulberry32(seed);
    const k = [rr(r, 0, 9), rr(r, 0, 9), rr(r, 0, 9)];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 1 + 0.2 * Math.sin(x * 3.1 + k[0]) * Math.cos(z * 2.7 + k[1]) + 0.12 * Math.sin(y * 5.3 + k[2]);
      p.setXYZ(i, x * d * size, y * d * size * flat, z * d * size * rr(r, 0.98, 1.02));
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.rockMat);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  private warmPane(w: number, h: number): THREE.Mesh {
    const [cv, c] = makeCanvas(64, 64), g = c.createRadialGradient(32, 36, 4, 32, 32, 44);
    g.addColorStop(0, '#fff0b8'); g.addColorStop(1, '#f09a3a');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    c.strokeStyle = '#3b2412'; c.lineWidth = 5; c.strokeRect(2, 2, 60, 60);
    c.beginPath(); c.moveTo(32, 0); c.lineTo(32, 64); c.moveTo(0, 32); c.lineTo(64, 32); c.stroke();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(2.2, 1.9, 1.5) }));
  }
  /** Puerta de tablas con marco; mira hacia +z local. */
  private door(lib: TexLib, w: number, h: number, tint = 0xffffff, round = false): THREE.Group {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ map: lib.get('brown_planks_09'), color: tint, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2616, roughness: 0.9 });
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.09), wood); leaf.position.y = h / 2; g.add(leaf);
    if (round) { const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.09, 20, 1, false, 0, Math.PI), wood); top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.y = h; g.add(top); }
    for (const s of [-1, 1]) { const j = new THREE.Mesh(new THREE.BoxGeometry(0.14, h + 0.1, 0.2), dark); j.position.set(s * (w / 2 + 0.07), h / 2, 0); g.add(j); }
    if (round) { const arch = new THREE.Mesh(new THREE.TorusGeometry(w / 2 + 0.07, 0.075, 8, 20, Math.PI), dark); arch.position.y = h; g.add(arch); }
    else { const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.34, 0.16, 0.22), dark); lintel.position.y = h + 0.08; g.add(lintel); }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.9, roughness: 0.3 }));
    knob.position.set(w * 0.32, h * 0.48, 0.08); g.add(knob);
    g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    return g;
  }
  private face(g: THREE.Object3D, x: number, z: number, tx: number, tz: number): THREE.Vector3 {
    const out = new V3(tx - x, 0, tz - z).normalize();
    g.position.set(x, this.y(x, z), z); g.rotation.y = Math.atan2(out.x, out.z);
    return out;
  }

  // ------------------------------------------------------------ Estanque de los Peces
  private buildPond() {
    const { x, z, r, level } = this.pond, rng = this.rng;
    this.scene.add(this.water.pond(x, level, z, r + 0.7));
    // peces nadando en círculos (el movimiento ocurre en el vertex shader)
    const body = new THREE.SphereGeometry(1, 8, 6).scale(0.13, 0.24, 0.6).toNonIndexed();
    const pos = Array.from(body.getAttribute('position').array as Float32Array), nor = Array.from(body.getAttribute('normal').array as Float32Array);
    const tri = (a: number[], b: number[], c: number[]) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) nor.push(1, 0.2, 0); };
    tri([0, 0, -0.5], [0, 0.3, -1.0], [0, -0.3, -1.0]); tri([0, 0.2, 0.2], [0, 0.42, -0.15], [0, 0.2, -0.3]);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const n = 30, orb = new Float32Array(n * 4), col = new Float32Array(n * 3), size = new Float32Array(n);
    const pal = [[1.0, 0.4, 0.02], [1.0, 0.66, 0.08], [0.5, 0.58, 0.68], [0.85, 0.12, 0.03], [0.16, 0.13, 0.1], [0.9, 0.82, 0.62]];
    for (let i = 0; i < n; i++) {
      orb.set([rr(rng, 1.3, r - 1.8), rr(rng, 0.35, 0.8) * (i % 6 === 0 ? -1 : 1), rng() * TAU, -rr(rng, 0.14, 0.42)], i * 4);
      col.set(pal[i % pal.length], i * 3); size[i] = rr(rng, 0.6, 1.05);
    }
    fg.setAttribute('iOrb', new THREE.InstancedBufferAttribute(orb, 4)); fg.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 3)); fg.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 1));
    const fish = new THREE.InstancedMesh(fg, new THREE.ShaderMaterial({
      side: THREE.DoubleSide, uniforms: { uTime: this.water.shared.uTime, uCenter: { value: new V3(x, level, z) } },
      vertexShader: `attribute vec4 iOrb; attribute vec3 iCol; attribute float iSize; uniform float uTime; uniform vec3 uCenter; varying vec3 vCol; varying float vL;
void main() {
  float ang = iOrb.z + uTime * iOrb.y / iOrb.x, dir = sign(iOrb.y);
  vec3 p = position * iSize;
  p.x += sin(uTime * 8.0 * abs(iOrb.y) + iOrb.z * 5.0 - position.z * 4.5) * 0.09 * iSize * smoothstep(0.35, -1.0, position.z);
  vec2 tng = vec2(-sin(ang), cos(ang)) * dir, nrm = vec2(tng.y, -tng.x);
  vec3 w = uCenter + vec3(cos(ang) * iOrb.x, iOrb.w + sin(uTime * 0.6 + iOrb.z) * 0.05, sin(ang) * iOrb.x);
  w.xz += tng * p.z + nrm * p.x; w.y += p.y;
  vCol = iCol; vL = 0.55 + 0.45 * max(normal.y, 0.0) + 0.25 * step(0.2, position.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`,
      fragmentShader: `varying vec3 vCol; varying float vL; void main() { gl_FragColor = vec4(mix(vCol * vL, vec3(0.08, 0.3, 0.26), 0.22), 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
    }), n);
    fish.frustumCulled = false; fish.name = 'peces'; this.scene.add(fish); this.fishCount = n;

    // irupés
    const lb = new Buf();
    lb.card(new V3(0, 0, -0.5), new V3(1, 0, 0), new V3(0, 0, 1), CELL.lily, [1, 1, 1], new V3(0, 1, 0), 0, 0);
    const lilies = new THREE.InstancedMesh(lb.geometry(), this.flora.leafMat, 12), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 12; i++) {
      const a = rng() * TAU, d = rr(rng, 1.2, r - 1.6), s = rr(rng, 0.8, 1.5);
      q.setFromAxisAngle(new V3(0, 1, 0), rng() * TAU);
      lilies.setMatrixAt(i, m4.compose(new V3(x + Math.cos(a) * d, level + 0.02, z + Math.sin(a) * d), q, new V3(s, 1, s)));
      lilies.setColorAt(i, new THREE.Color(0.14 * rr(rng, 0.8, 1.2), 0.36, 0.1));
    }
    lilies.renderOrder = 4; this.scene.add(lilies);
    const reeds: [number, number, number, number][] = [];
    for (let i = 0; i < 70; i++) { const a = rng() * TAU, d = rr(rng, r - 0.7, r + 1.3), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; reeds.push([px, Math.max(level - 0.1, this.y(px, pz)), pz, rr(rng, 0.7, 1.2)]); }
    this.scene.add(this.flora.scatter('reed', reeds, [0.24, 0.4, 0.1], 11));

    const ids = ['piedra-ronda', 'piedra-musgo', 'piedra-irupe'];
    const toSpawn = Math.atan2(this.spawn.pos.z - z, this.spawn.pos.x - x) || 2.2;
    ids.forEach((id, i) => {
      const a = toSpawn + 2.2 + (i - 1) * 0.75, d = r + 1.9, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, s = 0.5 + i * 0.09;
      const rock = this.rock(s, 40 + i, 0.75); rock.position.set(px, this.y(px, pz) + s * 0.35, pz); this.scene.add(rock);
      this.solid(px, pz, s * 0.95);
      this.addRead('estanque', id, rock, new V3(px, this.y(px, pz) + s * 0.95, pz));
    });
  }

  // ------------------------------------------------------------ Fogata de los Novios
  private buildFire() {
    const { x, z } = this.placePos.fogata, y = this.y(x, z), rng = this.rng;
    const g = new THREE.Group(); g.position.set(x, y, z); this.scene.add(g);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU, s = rr(rng, 0.2, 0.28), rk = this.rock(s, 70 + i, 0.8);
      rk.position.set(Math.cos(a) * 0.95, s * 0.4, Math.sin(a) * 0.95); g.add(rk);
    }
    const char = new THREE.MeshStandardMaterial({ color: 0x1c130c, roughness: 1 });
    for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 7), char); l.rotation.set(1.2, (i / 4) * TAU, 0); l.position.y = 0.28; g.add(l); }
    this.fire = new Fire(1.7, { light: 34, seed: 3 }); g.add(this.fire.group);
    this.portraits = new Portraits(2.3); this.portraits.mesh.position.y = 0.55; g.add(this.portraits.mesh);
    this.solid(x, z, 1.15);
    const bark = this.flora.woodMats[0];
    const seat = (a: number, id: string | null) => {
      const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 2.3, 12), bark);
      lg.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(lg.geometry.getAttribute('position').count * 3).fill(0.9), 3));
      const px = Math.cos(a) * 3.0, pz = Math.sin(a) * 3.0;
      lg.rotation.set(Math.PI / 2, 0, a); lg.position.set(px, 0.3, pz); lg.castShadow = lg.receiveShadow = true; g.add(lg);
      for (const k of [-0.7, 0, 0.7]) this.solid(x + px - Math.sin(a) * k, z + pz + Math.cos(a) * k, 0.42);
      if (id) this.addRead('fogata', id, lg, new V3(x + px, y + 0.7, z + pz));
    };
    seat(0.5, 'tronco-agustina'); seat(2.6, 'tronco-gonzalo'); seat(4.5, null);
    const st = this.rock(0.42, 91, 0.8); st.position.set(Math.cos(3.6) * 1.75, 0.16, Math.sin(3.6) * 1.75); g.add(st);
    this.solid(x + st.position.x, z + st.position.z, 0.42);
    this.addRead('fogata', 'piedra-fogon', st, new V3(x + st.position.x, y + 0.55, z + st.position.z));
    this.updaters.push((dt, t, cam) => { this.fire.update(t); this.portraits.update(dt, t, cam); });
  }

  // ------------------------------------------------------------ Cueva de las Amatistas
  private async buildCave(lib: TexLib) {
    const { x, z } = this.placePos.cueva, y = this.y(x, z);
    try {
      const meta: CaveMeta = await (await fetch('assets/rooms/cueva.json')).json();
      const [gltf, lm] = await Promise.all([new GLTFLoader().loadAsync('assets/rooms/cueva.glb'), loadLightmap('assets/rooms/cueva_lm.webp')]);
      const outer = new THREE.MeshStandardMaterial({ map: lib.get('cliff_side'), roughness: 1, color: 0xa39c92 });
      applyBaked(gltf.scene, lib, lm, null, { value: 0 }, meta.lightK, (m) => m.name.startsWith('cave_out'));
      gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name.startsWith('cave_out')) { m.material = outer; m.castShadow = m.receiveShadow = true; } });
      gltf.scene.position.set(x, y + 0.03, z);
      this.scene.add(gltf.scene); gltf.scene.updateMatrixWorld(true);
      this.cave = { x, z, meta };
      for (const c of meta.solids ?? []) this.solid(x + c.x, z + c.z, c.r);
      // resplandor violeta de cada drusa
      const [gc, g2] = makeCanvas(64, 64), gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(210,150,255,0.9)'); gr.addColorStop(0.35, 'rgba(150,70,255,0.3)'); gr.addColorStop(1, 'rgba(120,40,255,0)');
      g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
      const glowTex = new THREE.CanvasTexture(gc), glows: THREE.Sprite[] = [];
      for (const [gx, gy, gz] of meta.glows ?? []) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.6 }));
        sp.position.set(x + gx, y + gy, z + gz); sp.scale.setScalar(1.7); sp.renderOrder = 6; this.scene.add(sp); glows.push(sp);
      }
      this.updaters.push((_dt, t) => glows.forEach((sp, i) => { sp.material.opacity = 0.42 + 0.2 * Math.sin(t * 1.3 + i * 2.1); }));
      if (meta.shaft) {
        // rayo de luz que baja por la claraboya
        const [hx, hy, hz] = meta.shaft, beam = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.5, hy, 24, 1, true).translate(0, hy / 2, 0), new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: this.water.shared.uTime },
          vertexShader: 'varying vec2 vUv; varying vec3 vN, vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
          fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vN, vV;
void main() {
  float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float streak = 0.75 + 0.25 * sin(vUv.x * 60.0 + uTime * 0.3) * sin(vUv.x * 23.0 - uTime * 0.2);
  float a = rim * streak * smoothstep(0.0, 0.25, vUv.y) * (0.35 + 0.65 * vUv.y) * 0.16;
  gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
        }));
        beam.position.set(x + hx, y, z + hz); beam.renderOrder = 7; this.scene.add(beam);
      }
      gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).name === 'amatista') (m.material as THREE.MeshBasicMaterial).color.multiplyScalar(1.9); });
      gltf.scene.traverse((o) => {
        const raw: string = (o.userData?.name as string) || o.name;
        if (!raw.startsWith('I_') || ((o.parent?.userData?.name as string) || o.parent?.name || '').startsWith('I_')) return;
        const box = new THREE.Box3().setFromObject(o), c = box.getCenter(new V3());
        this.addRead('cueva', raw.slice(2), o, new V3(c.x, Math.min(box.max.y, y + 1.9), c.z));
      });
    } catch (e) { console.warn('cueva: sin modelo horneado todavía', e); }
  }

  // ------------------------------------------------------------ exteriores de las salas
  private buildCana(lib: TexLib, sx: number, sz: number) {
    const { x, z } = this.placePos.cana;
    const spec = { ...SPECIES.canafistula, h: [15, 15] as [number, number], r: [0.82, 0.82] as [number, number], flare: 1.15, twist: 0.04, branches: [9, 9] as [number, number], leaves: 9, size: [2.0, 2.8] as [number, number], flowerRatio: 0.42 };
    const tree = this.flora.single(spec, 2027, 2.0);
    tree.position.set(x, this.y(x, z), z); this.scene.add(tree);
    this.solid(x, z, 2.5);
    const d = this.door(lib, 1.25, 2.15, 0xc9a070, true);
    const out = this.face(d, x, z, sx, sz);
    d.position.addScaledVector(out, 2.42);
    const pane = this.warmPane(0.7, 0.7); pane.position.set(0, 3.2, 0.12); d.add(pane);
    const glow = new THREE.PointLight(0xffb060, 9, 9, 1.8); glow.position.set(0, 2.6, 0.9); d.add(glow);
    for (let i = 0; i < 2; i++) { const st = this.rock(0.55, 120 + i, 0.25); st.position.set(0, 0.02, 0.6 + i * 0.75); d.add(st); }
    this.scene.add(d);
    this.addDoor('cana', d, d.position.clone().add(new V3(0, 1.2, 0)), out);
  }

  private buildCottage(lib: TexLib, sx: number, sz: number) {
    const { x, z } = this.placePos.abuelas, W = 6.4, D = 5.2, H = 2.7;
    const g = new THREE.Group(), out = this.face(g, x, z, sx, sz);
    const rep = (id: string, u: number, v: number) => { const t = lib.get(id).clone(); t.repeat.set(u, v); t.needsUpdate = true; return t; };
    const plaster = new THREE.MeshStandardMaterial({ map: rep('plastered_wall_04', 3, 1.4), color: 0xf4e8d2, roughness: 0.95 });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), plaster); walls.position.y = H / 2; g.add(walls);
    const tiles = new THREE.MeshStandardMaterial({ map: rep('clay_roof_tiles_02', 3, 2), roughness: 0.9 });
    const rise = 1.7, half = D / 2 + 0.45, len = Math.hypot(half, rise);
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.14, len), tiles);
      r.position.set(0, H + rise / 2 - 0.05, (s * half) / 2); r.rotation.x = s * Math.atan2(rise, half); g.add(r);
      const gb = new THREE.BufferGeometry();
      gb.setAttribute('position', new THREE.Float32BufferAttribute([s * W / 2, H, -D / 2, s * W / 2, H, D / 2, s * W / 2, H + rise * (D / 2) / half, 0], 3));
      gb.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 0.6], 2));
      gb.setIndex(s > 0 ? [0, 2, 1] : [0, 1, 2]); gb.computeVertexNormals();
      g.add(new THREE.Mesh(gb, plaster));
    }
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 0.7), new THREE.MeshStandardMaterial({ map: lib.get('old_stone_wall'), roughness: 1 }));
    chim.position.set(1.9, H + 1.3, -0.8); g.add(chim);
    const d = this.door(lib, 1.0, 2.0, 0x8fb0a0); d.position.set(-1.0, 0, D / 2 + 0.03); g.add(d);
    for (const wx of [0.9, 2.3]) { const p = this.warmPane(0.9, 0.9); p.position.set(wx, 1.55, D / 2 + 0.02); g.add(p); }
    const side = this.warmPane(0.9, 0.9); side.position.set(-W / 2 - 0.02, 1.55, 0.4); side.rotation.y = -Math.PI / 2; g.add(side);
    const step = this.rock(0.7, 131, 0.2); step.position.set(-1.0, 0.02, D / 2 + 0.7); g.add(step);
    const lamp = new THREE.PointLight(0xffb060, 7, 8, 1.8); lamp.position.set(-1.0, 2.3, D / 2 + 0.9); g.add(lamp);
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material as THREE.Material).type.includes('Basic')) { m.castShadow = m.receiveShadow = true; } });
    this.scene.add(g); g.updateMatrixWorld(true);
    // colisión: tres círculos a lo largo de la casa
    const ax = new V3(1, 0, 0).applyAxisAngle(new V3(0, 1, 0), g.rotation.y);
    for (const k of [-1.9, 0, 1.9]) this.solid(x + ax.x * k, z + ax.z * k, D / 2 + 0.1);
    const smoke = new Puffs(puffTexture(), [chim.getWorldPosition(new V3()).add(new V3(0, 1.0, 0))], { rate: 1.3, life: 5, rise: 0.55, size: [0.4, 2.2], sway: 0.5, opacity: 0.3, color: 0xd8cfc4 }, 14);
    this.scene.add(smoke.group); this.updaters.push((dt) => smoke.update(dt));
    const dp = d.getWorldPosition(new V3());
    this.addDoor('abuelas', d, dp.clone().add(new V3(0, 1.1, 0)), out);
    // maceteros con flores a los lados de la puerta
    const fl: [number, number, number, number][] = [];
    for (let i = 0; i < 16; i++) { const p = new V3(rr(this.rng, -W / 2, W / 2), 0, D / 2 + rr(this.rng, 0.3, 1.1)).applyMatrix4(g.matrixWorld); if (Math.abs(p.x - dp.x) + Math.abs(p.z - dp.z) > 1) fl.push([p.x, this.y(p.x, p.z), p.z, rr(this.rng, 0.8, 1.3)]); }
    this.scene.add(this.flora.scatter('flower', fl, [1.1, 0.2, 0.25], 21));
  }

  private buildGnomeHouse(lib: TexLib, sx: number, sz: number) {
    const { x, z } = this.placePos.gnomos, rng = this.rng;
    const g = new THREE.Group(), out = this.face(g, x, z, sx, sz);
    const stone = lib.get('old_stone_wall').clone(); stone.repeat.set(4, 1); stone.needsUpdate = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.95, 1.75, 22), new THREE.MeshStandardMaterial({ map: stone, roughness: 1 }));
    base.position.y = 0.875; g.add(base);
    // techo de hongo rojo con pintas blancas
    const [cv, c] = makeCanvas(512, 256);
    const gr = c.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#d8301f'); gr.addColorStop(1, '#9c1a12');
    c.fillStyle = gr; c.fillRect(0, 0, 512, 256); c.fillStyle = '#fff6e6';
    for (let i = 0; i < 46; i++) { c.beginPath(); c.ellipse(rng() * 512, rr(rng, 10, 215), rr(rng, 9, 22), rr(rng, 7, 15), 0, 0, TAU); c.fill(); }
    const capTex = new THREE.CanvasTexture(cv); capTex.colorSpace = THREE.SRGBColorSpace; capTex.wrapS = THREE.RepeatWrapping;
    const prof = [[0.01, 4.05], [0.6, 3.98], [1.4, 3.6], [2.15, 3.0], [2.7, 2.3], [2.9, 1.82], [2.72, 1.62], [1.7, 1.72]].map(([r, h]) => new THREE.Vector2(r, h));
    const cap = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.62, side: THREE.DoubleSide }));
    g.add(cap);
    const d = this.door(lib, 0.82, 1.0, 0x6fae5a, true); d.position.set(0, 0, 1.86); g.add(d);
    for (const a of [-0.95, 0.95]) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.27, 18), (this.warmPane(1, 1).material as THREE.Material));
      p.position.set(Math.sin(a) * 1.84, 1.05, Math.cos(a) * 1.84); p.rotation.y = a; g.add(p);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 8, 18), new THREE.MeshStandardMaterial({ color: 0x3a2616 })); ring.position.copy(p.position); ring.rotation.y = a; g.add(ring);
    }
    const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.3, 8), new THREE.MeshStandardMaterial({ map: stone, roughness: 1 }));
    chim.position.set(-1.1, 3.75, -0.5); chim.rotation.z = 0.2; g.add(chim);
    const lamp = new THREE.PointLight(0xffb060, 6, 7, 1.8); lamp.position.set(0.9, 1.6, 2.5); g.add(lamp);
    // cartel
    const [sc, s2] = makeCanvas(256, 96); s2.fillStyle = '#7a5230'; s2.fillRect(0, 0, 256, 96); s2.strokeStyle = '#4a2f18'; s2.lineWidth = 8; s2.strokeRect(4, 4, 248, 88);
    s2.fillStyle = '#fff1cf'; s2.font = 'italic 600 38px Georgia, serif'; s2.textAlign = 'center'; s2.fillText('Gnomos', 128, 62);
    const signT = new THREE.CanvasTexture(sc); signT.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), new THREE.MeshStandardMaterial({ map: signT, roughness: 0.9, side: THREE.DoubleSide })); sign.position.set(1.75, 0.95, 2.7); sign.rotation.y = -0.35; g.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.0, 6), new THREE.MeshStandardMaterial({ color: 0x4a2f18 })); post.position.set(1.75, 0.45, 2.68); g.add(post);
    // honguitos
    const stemM = new THREE.MeshStandardMaterial({ color: 0xf3e9d4, roughness: 0.9 }), capM = new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.6 });
    for (let i = 0; i < 9; i++) {
      const a = rng() * TAU, dd = rr(rng, 2.6, 4.6), s = rr(rng, 0.14, 0.34);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.3, s * 0.4, s * 1.4, 8), stemM); st.position.set(Math.cos(a) * dd, s * 0.7, Math.sin(a) * dd); g.add(st);
      const cp = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 8, 0, TAU, 0, Math.PI / 2), capM); cp.position.set(st.position.x, s * 1.35, st.position.z); cp.scale.y = 0.75; g.add(cp);
    }
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material as THREE.Material).type.includes('Basic')) { m.castShadow = m.receiveShadow = true; } });
    this.scene.add(g); g.updateMatrixWorld(true);
    this.solid(x, z, 2.05);
    const smoke = new Puffs(puffTexture(), [chim.getWorldPosition(new V3()).add(new V3(0, 0.7, 0))], { rate: 1.1, life: 4.5, rise: 0.5, size: [0.25, 1.5], sway: 0.4, opacity: 0.3, color: 0xd8cfc4 }, 12);
    this.scene.add(smoke.group); this.updaters.push((dt) => smoke.update(dt));
    this.addDoor('gnomos', d, d.getWorldPosition(new V3()).add(new V3(0, 0.7, 0)), out);
  }

  private scatterRocks() {
    const rng = mulberry32(909), geo = this.geo;
    for (let i = 0; i < 260; i++) {
      const x = rr(rng, geo.bounds.minX, geo.bounds.maxX), z = rr(rng, geo.bounds.minZ, geo.bounds.maxZ);
      if (geo.sample(geo.sdf, x, z) < 1.5 || this.terrain.clear[geo.idx(x, z)] > 0.1) continue;
      const near = geo.sample(geo.andes, x, z) < 22 || geo.sample(geo.riverSd, x, z) < 4;
      if (!near && rng() > 0.25) continue;
      const s = rr(rng, 0.3, near ? 1.5 : 0.8), rk = this.rock(s, 1000 + i, rr(rng, 0.55, 0.9));
      rk.position.set(x, this.y(x, z) + s * 0.25, z); rk.rotation.y = rng() * TAU; this.scene.add(rk);
      if (s > 0.6) this.solid(x, z, s * 0.85);
    }
  }

  // ------------------------------------------------------------ GameScene
  groundY(x: number, z: number) { return this.terrain.heightAt(x, z); }

  collide(p: THREE.Vector3, r: number) {
    const g = this.geo;
    for (let it = 0; it < 2; it++) {
      const sd = g.sample(g.sdfMain, p.x, p.z), lim = 1.0;
      if (sd < lim) {
        const gx = g.sample(g.sdfMain, p.x + 1, p.z) - g.sample(g.sdfMain, p.x - 1, p.z), gz = g.sample(g.sdfMain, p.x, p.z + 1) - g.sample(g.sdfMain, p.x, p.z - 1), l = Math.hypot(gx, gz) || 1;
        p.x += (gx / l) * (lim - sd); p.z += (gz / l) * (lim - sd);
      }
      this.hash.resolve(p, r);
      if (this.cave) {
        const lx = p.x - this.cave.x, lz = p.z - this.cave.z, { shell, corridor } = this.cave.meta;
        const inside = shell.find((c) => Math.hypot(lx - c.x, lz - c.z) < c.r + r);
        if (inside && !corridor.some((c) => Math.hypot(lx - c.x, lz - c.z) <= c.r - r)) {
          // vuelve al pasillo más cercano o sale de la roca, lo que quede más cerca
          let best = 1e9, bx = lx, bz = lz;
          for (const c of corridor) {
            const d = Math.hypot(lx - c.x, lz - c.z), over = d - (c.r - r);
            if (over < best) { best = over; const k = (c.r - r) / (d || 1); bx = c.x + (lx - c.x) * k; bz = c.z + (lz - c.z) * k; }
          }
          const d = Math.hypot(lx - inside.x, lz - inside.z), exit = inside.r + r - d;
          if (exit < best) { const k = (inside.r + r) / (d || 1); bx = inside.x + (lx - inside.x) * k; bz = inside.z + (lz - inside.z) * k; }
          p.x = this.cave.x + bx; p.z = this.cave.z + bz;
        }
      }
    }
  }

  update(dt: number, t: number, cam: THREE.PerspectiveCamera, viewH: number) {
    this.water.update(t); this.flora.update(t);
    this.atmo.update(dt, t, cam, viewH);
    for (const u of this.updaters) u(dt, t, cam.position);
    this.sparkles.forEach((s, i) => { s.scale.setScalar(0.3 + 0.1 * Math.sin(t * 2.4 + i * 1.7)); s.material.rotation = t * 0.4 + i; });
  }

  entry(from: string | null) {
    const d = from ? this.doors[from] : null;
    return d ? { pos: d.pos.clone(), yaw: d.yaw } : { pos: this.spawn.pos.clone(), yaw: this.spawn.yaw };
  }

  inCave(x: number, z: number): boolean {
    if (!this.cave) return false;
    const lx = x - this.cave.x, lz = z - this.cave.z;
    return this.cave.meta.shell.some((c) => Math.hypot(lx - c.x, lz - c.z) < c.r) && this.cave.meta.corridor.some((c) => Math.hypot(lx - c.x, lz - c.z) < c.r);
  }

  ambience(cam: THREE.Vector3) {
    const g = this.geo, f = this.placePos.fogata;
    const river = Math.max(0, 1 - Math.max(0, g.sample(g.riverSd, cam.x, cam.z)) / 16);
    const pond = Math.max(0, 1 - Math.max(0, Math.hypot(cam.x - this.pond.x, cam.z - this.pond.z) - this.pond.r) / 12) * 0.6;
    const sea = Math.max(0, 1 - g.sample(g.sdf, cam.x, cam.z) / 14) * 0.8;
    return { water: Math.max(river, pond, sea), fire: Math.max(0, 1 - Math.hypot(cam.x - f.x, cam.z - f.z) / 13), cave: this.inCave(cam.x, cam.z) ? 1 : 0 };
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
