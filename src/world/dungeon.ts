// Mazmorra de cinco cuartos bajo la casita de gnomos, armada con el kit modular de Blender
// (public/assets/dungeon/kit.glb): corredor de antorchas, puerta con llave y sala del tesoro.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Circle, GameScene, Interactable, pushOut } from '../core';
import { DUNGEON } from '../content/ideas';
import { TexLib } from './rooms';
import { Fire, flicker, sparkle } from '../fx';
import { TAU, makeCanvas } from '../util';

// E entrada · c corredor de antorchas · H sala de la puerta · a/K cripta de la llave · D puerta · T tesoro · S escalera
const MAP = [
  '#############',
  '#TTT#########',
  '#TTT##KKK####',
  '##D###KKK####',
  '#HHHHaKKK####',
  '#HHHH########',
  '#HHHH########',
  '###c#########',
  '###c#########',
  '###c#########',
  '###c#########',
  '###c#########',
  '###c#########',
  '##EEE########',
  '##EES########',
  '#############',
];
const CELL = 2, HEIGHT = 3, WALK = 'EcHKTaD';
const ROOM_OF: Record<string, number> = { E: 0, S: 0, c: 1, H: 2, D: 2, a: 3, K: 3, T: 4 };
const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S O
const DOOR_CELL: [number, number] = [2, 3];
/** antorchas: [columna, fila, dirección de la pared (0 N, 1 E, 2 S, 3 O)] */
const TORCHES: [number, number, number][] = [
  [2, 13, 3], [4, 13, 0], [3, 12, 3], [3, 11, 1], [3, 10, 3], [3, 9, 1], [3, 8, 3], [3, 7, 1],
  [1, 5, 3], [4, 5, 1], [1, 6, 2], [3, 4, 0], [7, 2, 0], [8, 4, 1], [1, 1, 3], [3, 1, 1],
];
const R = 0.3; // radio del jugador dentro de la mazmorra

export interface DungeonHooks {
  onKey(): void; onLocked(): void; onFound(): void; onTake(): void;
}

export class DungeonScene implements GameScene {
  id = 'mazmorra'; name = DUNGEON.name; indoor = true;
  scene = new THREE.Scene();
  interactables: Interactable[] = [];
  rooms = DUNGEON.rooms;
  hasKey = false; unlocked = false; found = false; cardTaken = false;
  doorOpen = 0; chestOpen = 0;
  fogDensity = 0.05;
  torches: { light: THREE.PointLight; fire: Fire; base: number; seed: number }[] = [];
  chestPos = new THREE.Vector3(4, 0.15, 1.75);
  private kit!: THREE.Object3D;
  private doorPivot = new THREE.Group(); private lidPivot = new THREE.Group();
  private key!: THREE.Object3D; private keyLight!: THREE.PointLight; private keySpark = sparkle();
  private card!: THREE.Mesh; private cardGlow!: THREE.Sprite;
  private solids: Circle[] = [];
  private uTime = { value: 0 };
  private doorIt!: Interactable; private keyIt!: Interactable; private cardIt!: Interactable;

  constructor(private hooks: DungeonHooks) {}

  static async load(lib: TexLib, hooks: DungeonHooks): Promise<DungeonScene> {
    const d = new DungeonScene(hooks);
    await lib.ready(['old_stone_wall', 'cobblestone_floor_04', 'brown_planks_09']);
    const gltf = await new GLTFLoader().loadAsync('assets/dungeon/kit.glb');
    d.kit = gltf.scene;
    d.kit.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const ph = /^ph_(.+?)(?:__([0-9a-f]{6}))?(?:\.\d+)?$/.exec(mat.name);
      if (ph) { mat.map = lib.get(ph[1]); mat.color.set(ph[2] ? `#${ph[2]}` : '#ffffff'); }
      mat.metalness = Math.min(mat.metalness, 0.3); mat.roughness = Math.max(mat.roughness, 0.45);
      mat.needsUpdate = true;
    });
    d.build();
    return d;
  }

  // ------------------------------------------------------------ grilla
  private ch(i: number, j: number) { return MAP[j]?.[i] ?? '#'; }
  private cellOf(x: number, z: number): [number, number] { return [Math.round(x / CELL), Math.round(z / CELL)]; }
  private open(i: number, j: number) {
    const c = this.ch(i, j);
    if (!WALK.includes(c)) return false;
    return !(c === 'D' && !this.unlocked);
  }
  /** índice del cuarto (0–4) en x,z; -1 si es roca */
  roomAt(x: number, z: number) { const [i, j] = this.cellOf(x, z); return ROOM_OF[this.ch(i, j)] ?? -1; }

  // ------------------------------------------------------------ construcción
  private piece(name: string): THREE.Object3D {
    const o = this.kit.getObjectByName(name);
    if (!o) throw new Error(`Falta la pieza "${name}" en el kit`);
    const c = o.clone(true); c.position.set(0, 0, 0);
    return c;
  }

  private build() {
    const sc = this.scene;
    sc.background = new THREE.Color(0x07090d);
    sc.fog = new THREE.FogExp2(0x07090d, this.fogDensity);
    sc.add(new THREE.HemisphereLight(0x3d4a66, 0x1a110b, 0.9));

    // piezas repetidas → instancias
    const inst: Record<string, THREE.Matrix4[]> = {};
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
    const put = (name: string, x: number, y: number, z: number, rot = 0, s = 1) => {
      q.setFromAxisAngle(yAxis, rot);
      (inst[name] ??= []).push(m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)).clone());
    };
    for (let j = 0; j < MAP.length; j++) for (let i = 0; i < MAP[j].length; i++) {
      const c = this.ch(i, j);
      if (c === '#') continue;
      const x = i * CELL, z = j * CELL;
      put('floor', x, 0, z);
      put('ceiling', x, HEIGHT, z, (i + j) % 2 ? Math.PI / 2 : 0);
      DIRS.forEach(([dx, dz], k) => {
        const n = this.ch(i + dx, j + dz), ex = x + dx, ez = z + dz, rot = dz ? 0 : Math.PI / 2;
        if (n === '#') { put(c === 'S' && k === 1 ? 'arch' : 'wall', ex, 0, ez, rot); return; }
        // entre cuartos distintos va un arco (una sola vez por borde)
        if ((k === 1 || k === 2) && c !== 'S' && n !== 'S' && n !== c) put('arch', ex, 0, ez, rot);
      });
    }
    // el vano de la escalera da a la oscuridad
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4), new THREE.MeshBasicMaterial({ color: 0x020203 }));
    dark.position.set(4 * CELL + 1.16, 1.2, 14 * CELL); dark.rotation.y = -Math.PI / 2; sc.add(dark);
    for (const [x, z] of [[3, 9], [7, 9]]) { put('pillar', x, 0, z); this.solids.push({ x, z, r: 0.34 }); }
    for (const [name, x, z, rot, s] of [['barrel', 12.7, 8.4, 0.3, 1], ['barrel', 15.3, 8.5, 1, 0.9], ['crate', 15.4, 4.5, 0.4, 1], ['crate', 12.6, 4.6, 0.1, 0.8], ['barrel', 4.7, 26.6, 0, 1], ['crate', 7.3, 26.6, 0.5, 0.9]] as [string, number, number, number, number][]) {
      put(name, x, 0, z, rot, s); this.solids.push({ x, z, r: 0.36 * s });
    }
    // antorchas con fuego y luz que parpadean
    TORCHES.forEach(([i, j, k], n) => {
      const [dx, dz] = DIRS[k], wx = i * CELL + dx * 0.85, wz = j * CELL + dz * 0.85, rot = Math.atan2(dx, dz);
      put('torch', wx, 1.55, wz, rot);
      const fx = wx - dx * 0.24, fz = wz - dz * 0.24;
      const fire = new Fire(0.2, { seed: n + 1 }); fire.group.position.set(fx, 2.03, fz); sc.add(fire.group);
      const light = new THREE.PointLight(0xff8a3a, 11, 9, 1.7); light.position.set(fx - dx * 0.12, 2.2, fz - dz * 0.12); sc.add(light);
      this.torches.push({ light, fire, base: 11, seed: n * 1.7 + 0.4 });
    });
    for (const [name, list] of Object.entries(inst)) {
      const src = this.piece(name);
      src.updateMatrixWorld(true);
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const im = new THREE.InstancedMesh(m.geometry, m.material, list.length);
        list.forEach((mat, n) => im.setMatrixAt(n, m4.multiplyMatrices(mat, m.matrixWorld)));
        im.name = `kit:${name}`; sc.add(im);
      });
    }

    // escalera de salida hacia la casita
    const stairs = this.piece('stairs'); stairs.position.set(4 * CELL, 0, 14 * CELL); stairs.rotation.y = -Math.PI / 2; sc.add(stairs);
    stairs.traverse((o) => { o.userData.interactId = 'salida-mazmorra'; });
    this.interactables.push({ id: 'salida-mazmorra', placeId: 'gnomos', name: 'Subir a la casita de gnomos', action: 'door', target: 'gnomos', object: stairs, pos: new THREE.Vector3(7.2, 0.9, 28), prompt: 'E — Subir a la casita de gnomos' });

    // puerta con cerradura: bisagra en la jamba oeste del arco entre la sala y el tesoro
    const door = this.piece('door');
    this.doorPivot.position.set(DOOR_CELL[0] * CELL - 0.63, 0, DOOR_CELL[1] * CELL + 1); this.doorPivot.add(door); sc.add(this.doorPivot);
    door.traverse((o) => { o.userData.interactId = 'puerta-mazmorra'; });
    this.doorIt = { id: 'puerta-mazmorra', placeId: 'gnomos', name: 'Puerta cerrada', action: 'use', object: this.doorPivot, pos: new THREE.Vector3(4, 1.3, 7), prompt: 'E — Abrir la puerta', onUse: () => this.hooks.onLocked() };

    // la llave, sobre un pedestal en la cripta
    const ped = this.piece('pedestal'); ped.position.set(14, 0, 3.5); sc.add(ped); this.solids.push({ x: 14, z: 3.5, r: 0.42 });
    for (const [cx, cz] of [[13.8, 3.35], [14.2, 3.4]]) {
      const cn = this.piece('candle'); cn.position.set(cx, 0.98, cz); sc.add(cn);
      const f = new Fire(0.06, { seed: cx }); f.group.position.set(cx, 1.14, cz); sc.add(f.group); this.torches.push({ light: new THREE.PointLight(0xff8a3a, 0, 1), fire: f, base: 0, seed: cx });
    }
    this.key = this.piece('key'); this.key.position.set(14, 1.32, 3.6); this.key.scale.setScalar(1.6); sc.add(this.key);
    this.key.traverse((o) => { o.userData.interactId = 'llave'; const m = o as THREE.Mesh; if (m.isMesh) { m.material = (m.material as THREE.MeshStandardMaterial).clone(); (m.material as THREE.MeshStandardMaterial).emissive.set(0x9a6a10); } });
    this.keyLight = new THREE.PointLight(0xffd070, 2.6, 4, 1.6); this.keyLight.position.set(14, 1.5, 3.8); sc.add(this.keyLight);
    this.keySpark.position.set(14, 1.62, 3.6); sc.add(this.keySpark);
    this.keyIt = { id: 'llave', placeId: 'gnomos', name: 'Llave de la mazmorra', action: 'use', object: this.key, pos: new THREE.Vector3(14, 1.32, 3.6), prompt: 'E — Tomar la llave', onUse: () => this.takeKey() };

    // sala del tesoro: tarima, cofre, velas y un rayo de luz
    const dais = this.piece('floor'); dais.position.set(4, 0.15, 1.75); dais.scale.set(0.9, 1, 0.62); sc.add(dais);
    const base = this.piece('chest_base'); base.position.copy(this.chestPos); sc.add(base);
    const lid = this.piece('chest_lid'); this.lidPivot.position.set(this.chestPos.x, this.chestPos.y + 0.4, this.chestPos.z - 0.275); this.lidPivot.add(lid); sc.add(this.lidPivot);
    this.solids.push({ x: 4, z: 1.75, r: 0.62 });
    for (const [cx, cz] of [[3.2, 2.2], [4.8, 2.2], [3.1, 1.4], [4.9, 1.4]]) {
      const cn = this.piece('candle'); cn.position.set(cx, 0.15, cz); sc.add(cn);
      const f = new Fire(0.06, { seed: cx + cz }); f.group.position.set(cx, 0.31, cz); sc.add(f.group); this.torches.push({ light: new THREE.PointLight(0xff8a3a, 0, 1), fire: f, base: 0, seed: cx });
    }
    const shine = new THREE.PointLight(0xffe2b0, 7, 7, 1.5); shine.position.set(4, 2.5, 2.1); sc.add(shine);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.1, 2.9, 20, 1, true).translate(0, 1.45, 0), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: this.uTime },
      vertexShader: 'varying vec2 vUv; varying vec3 vN, vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vN, vV;
void main() {
  float rim = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
  float a = rim * (0.8 + 0.2 * sin(vUv.x * 40.0 + uTime * 0.4)) * smoothstep(0.0, 0.2, vUv.y) * 0.22;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    }));
    beam.position.set(4, 0.1, 1.75); beam.renderOrder = 7; sc.add(beam);

    // la invitación: papel ahuesado con sello de lacre rojo oscuro
    const [cv, c] = makeCanvas(512, 360);
    c.fillStyle = '#efe6cf'; c.fillRect(0, 0, 512, 360);
    c.strokeStyle = '#8a6a3a'; c.lineWidth = 6; c.strokeRect(14, 14, 484, 332); c.lineWidth = 2; c.strokeRect(26, 26, 460, 308);
    c.fillStyle = '#3a2a1a'; c.textAlign = 'center'; c.font = 'italic 44px Georgia, serif'; c.fillText('Invitación', 256, 96);
    c.fillStyle = 'rgba(58,42,26,0.55)'; for (let k = 0; k < 4; k++) c.fillRect(110 + k * 8, 132 + k * 26, 292 - k * 16, 6);
    const seal = c.createRadialGradient(246, 262, 4, 256, 272, 46); seal.addColorStop(0, '#a3192a'); seal.addColorStop(0.7, '#6d0d1a'); seal.addColorStop(1, '#4a0812');
    c.fillStyle = seal; c.beginPath();
    for (let k = 0; k <= 40; k++) { const a = (k / 40) * TAU, r = 42 + 4 * Math.sin(a * 7); k ? c.lineTo(256 + Math.cos(a) * r, 272 + Math.sin(a) * r) : c.moveTo(256 + r, 272); }
    c.fill(); c.fillStyle = 'rgba(255,220,210,0.35)'; c.font = 'bold 30px Georgia, serif'; c.fillText('A·G', 256, 283);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.31), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    this.card.visible = false; this.card.userData.interactId = 'invitacion'; sc.add(this.card);
    const [gc, g2] = makeCanvas(64, 64), gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,236,190,0.9)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
    this.cardGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.7 }));
    this.cardGlow.scale.setScalar(1.3); this.cardGlow.visible = false; sc.add(this.cardGlow);
    this.cardIt = { id: 'invitacion', placeId: 'gnomos', name: 'Invitación', action: 'use', click: true, object: this.card, pos: new THREE.Vector3(4, 1.3, 1.9), prompt: 'Click o E — Tomar la invitación', onUse: () => this.takeCard() };
    this.syncInteractables();
  }

  private syncInteractables() {
    const base = this.interactables.filter((i) => i.id === 'salida-mazmorra');
    if (!this.unlocked) base.push(this.doorIt);
    if (!this.hasKey) base.push(this.keyIt);
    if (this.found && !this.cardTaken) base.push(this.cardIt);
    this.interactables = base;
    this.key.visible = this.keySpark.visible = !this.hasKey; this.keyLight.visible = !this.hasKey;
    this.card.visible = this.cardGlow.visible = this.found && !this.cardTaken;
  }

  // ------------------------------------------------------------ juego
  takeKey() {
    if (this.hasKey) return;
    this.hasKey = true; this.unlocked = true; // tomar la llave abre la puerta
    this.syncInteractables();
    this.hooks.onKey();
  }
  takeCard() {
    if (!this.found || this.cardTaken) return;
    this.cardTaken = true; this.syncInteractables();
    this.hooks.onTake();
  }
  /** Vuelve todo al inicio (la invitación se autodestruyó). */
  reset() { this.hasKey = this.unlocked = this.found = this.cardTaken = false; this.doorOpen = this.chestOpen = 0; this.syncInteractables(); }
  /** Quien ya tiene la invitación encuentra la puerta abierta y el cofre vacío. */
  restoreHeld() { this.hasKey = this.unlocked = this.found = this.cardTaken = true; this.doorOpen = this.chestOpen = 1; this.syncInteractables(); }

  // ------------------------------------------------------------ GameScene
  groundY() { return 0; }

  collide(p: THREE.Vector3) {
    for (let it = 0; it < 2; it++) {
      let [i, j] = this.cellOf(p.x, p.z);
      if (!this.open(i, j)) { // quedó dentro de un muro: vuelve a la celda libre más cercana
        let best = 1e9, bi = i, bj = j;
        for (let b = 0; b < MAP.length; b++) for (let a = 0; a < MAP[b].length; a++) if (this.open(a, b)) { const d = (a * CELL - p.x) ** 2 + (b * CELL - p.z) ** 2; if (d < best) { best = d; bi = a; bj = b; } }
        p.x = THREE.MathUtils.clamp(p.x, bi * CELL - 0.8, bi * CELL + 0.8); p.z = THREE.MathUtils.clamp(p.z, bj * CELL - 0.8, bj * CELL + 0.8);
        [i, j] = [bi, bj];
      }
      const cx = i * CELL, cz = j * CELL, lim = CELL / 2 - 0.15 - R, here = this.ch(i, j);
      for (const [dx, dz] of DIRS) {
        const n = this.ch(i + dx, j + dz), along = (p.x - cx) * dx + (p.z - cz) * dz;
        if (along <= lim) continue;
        const free = this.open(i + dx, j + dz);
        const lateral = dx ? p.z - cz : p.x - cx, jamb = 0.65 - R;
        if (free && (n === here || Math.abs(lateral) <= jamb)) {
          // dentro del vano de un arco no se puede salir de la abertura
          if (n !== here) { if (dx) p.z = cz + THREE.MathUtils.clamp(lateral, -jamb, jamb); else p.x = cx + THREE.MathUtils.clamp(lateral, -jamb, jamb); }
          continue;
        }
        if (dx) p.x = cx + dx * lim; else p.z = cz + dz * lim;
      }
      for (const c of this.solids) pushOut(p, c, R);
    }
  }

  /** Camino por centros de celda (BFS) entre dos puntos de la mazmorra. */
  route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const [si, sj] = this.cellOf(from.x, from.z);
    let [ti, tj] = this.cellOf(to.x, to.z);
    if (!this.open(ti, tj)) { // destino dentro de un muro (p. ej. la escalera): la celda libre vecina
      for (const [dx, dz] of DIRS) if (this.open(ti + dx, tj + dz)) { ti += dx; tj += dz; break; }
    }
    const key = (i: number, j: number) => j * 32 + i, prev = new Map<number, number>([[key(si, sj), -1]]), queue: [number, number][] = [[si, sj]];
    while (queue.length) {
      const [i, j] = queue.shift()!;
      if (i === ti && j === tj) break;
      for (const [dx, dz] of DIRS) { const a = i + dx, b = j + dz; if (this.open(a, b) && !prev.has(key(a, b))) { prev.set(key(a, b), key(i, j)); queue.push([a, b]); } }
    }
    const out: THREE.Vector3[] = [to.clone()];
    if (!prev.has(key(ti, tj))) return out;
    for (let k = key(ti, tj); k !== -1 && k !== key(si, sj); k = prev.get(k)!) out.push(new THREE.Vector3((k % 32) * CELL, 0, Math.floor(k / 32) * CELL));
    return out.reverse();
  }

  update(dt: number, t: number, cam: THREE.PerspectiveCamera) {
    this.uTime.value = t;
    for (const tc of this.torches) { tc.fire.update(t); tc.light.intensity = tc.base * flicker(t, tc.seed); }
    // la puerta gira sobre su bisagra cuando se consigue la llave
    this.doorOpen = Math.min(1, Math.max(0, this.doorOpen + (this.unlocked ? dt / 1.4 : -dt)));
    this.doorPivot.rotation.y = 1.75 * (this.doorOpen * this.doorOpen * (3 - 2 * this.doorOpen));
    // llegar al cofre lo abre y muestra "You found it!"
    const d = Math.hypot(cam.position.x - this.chestPos.x, cam.position.z - this.chestPos.z);
    if (!this.found && this.unlocked && this.roomAt(cam.position.x, cam.position.z) === 4 && d < 2.9) { this.found = true; this.syncInteractables(); this.hooks.onFound(); }
    this.chestOpen = Math.min(1, Math.max(0, this.chestOpen + (this.found ? dt / 1.2 : -1)));
    this.lidPivot.rotation.x = -1.9 * this.chestOpen;
    if (!this.hasKey) { this.key.rotation.y = t * 1.2; this.key.position.y = 1.32 + Math.sin(t * 2) * 0.04; this.keySpark.scale.setScalar(0.3 + 0.08 * Math.sin(t * 3)); }
    if (this.card.visible) {
      const k = this.chestOpen;
      this.card.position.set(this.chestPos.x, this.chestPos.y + 0.45 + 0.75 * k + Math.sin(t * 1.7) * 0.03, this.chestPos.z + 0.12);
      this.card.rotation.y = Math.sin(t * 0.8) * 0.5; this.cardGlow.position.copy(this.card.position);
      this.cardIt.pos.copy(this.card.position);
    }
  }

  entry() { return { pos: new THREE.Vector3(3 * CELL, 0, 14 * CELL), yaw: 0 }; }

  ambience(cam: THREE.Vector3) {
    // los bombos de ceremonia crecen al acercarse a la invitación
    const d = Math.hypot(cam.x - this.chestPos.x, cam.z - this.chestPos.z);
    return { water: 0, fire: 0.45, cave: 1, drums: 0.14 + 0.86 * Math.max(0, 1 - d / 27) ** 1.4 };
  }

  info() {
    return {
      rooms: this.rooms, hasKey: this.hasKey, unlocked: this.unlocked, doorOpen: this.doorOpen, found: this.found, chestOpen: this.chestOpen, cardTaken: this.cardTaken,
      torches: TORCHES.length, torchLight: this.torches.slice(0, TORCHES.length).map((t) => t.light.intensity), fog: this.fogDensity,
      pieces: [...new Set(this.scene.children.filter((c) => c.name.startsWith('kit:')).map((c) => c.name.slice(4)))],
    };
  }
}
