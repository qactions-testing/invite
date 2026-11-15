// El gato tuxedo que acompaña al jugador: negro con pecho, hocico, "corbata" y patitas blancas,
// y una coronita de oro flotando con 3 granates y 3 diamantes alternados (cada 60°).
// Hecho en código con primitivas; camina, trota, se queda quieto y se sienta según lo que haga el jugador.
import * as THREE from 'three';
import { GameScene } from './core';
import { Player } from './player';

const V3 = THREE.Vector3;
const BLACK = 0x18181a, WHITE = 0xf1eee6, PINK = 0xe7a1a8;

export type Gait = 'quieto' | 'camina' | 'trota';

export class Cat {
  group = new THREE.Group();
  /** posición en el suelo y rumbo (radianes, 0 = mirando a +z) */
  pos = new V3(); heading = 0;
  gait: Gait = 'quieto';
  /** 0 parado … 1 sentado */
  sit = 0;
  speed = 0;
  gems: { kind: 'granate' | 'diamante'; angle: number }[] = [];
  private body = new THREE.Group(); private head = new THREE.Group(); private crown = new THREE.Group();
  private legs: { pivot: THREE.Group; front: boolean; side: number }[] = [];
  private tail: THREE.Group[] = [];
  private phase = 0; private idleT = 0; private target = new V3(); private hasTarget = false;
  private prev = new V3();

  constructor() {
    const std = (color: number, rough = 0.75, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
    const black = std(BLACK, 0.7), white = std(WHITE, 0.8), pink = std(PINK, 0.6);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = false) => {
      const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; parent.add(o); return o;
    };
    this.group.name = 'gato';
    this.group.scale.setScalar(1.15); // un poco más grande que un gato real, para que se lea a unos metros

    // cuerpo: pivote en los hombros (al sentarse baja la cadera)
    this.body.position.set(0, 0.168, 0.1);
    this.group.add(this.body);
    const torso = mesh(new THREE.CapsuleGeometry(0.078, 0.17, 6, 12), black, this.body, 0, 0.03, -0.1, true);
    torso.rotation.x = Math.PI / 2;
    // pecho y "corbata" blancos
    mesh(new THREE.SphereGeometry(1, 14, 10), white, this.body, 0, 0.0, 0.03).scale.set(0.058, 0.075, 0.055);
    mesh(new THREE.SphereGeometry(1, 12, 8), white, this.body, 0, -0.045, -0.05).scale.set(0.05, 0.03, 0.09);

    // cabeza
    this.head.position.set(0, 0.095, 0.075);
    this.body.add(this.head);
    const skull = mesh(new THREE.SphereGeometry(0.072, 18, 14), black, this.head, 0, 0.035, 0.02, true);
    skull.scale.set(1.05, 0.92, 0.95);
    mesh(new THREE.SphereGeometry(1, 14, 10), white, this.head, 0, 0.012, 0.07).scale.set(0.046, 0.032, 0.03); // hocico
    mesh(new THREE.SphereGeometry(1, 10, 8), white, this.head, 0, -0.012, 0.055).scale.set(0.03, 0.022, 0.03); // pera
    mesh(new THREE.SphereGeometry(1, 10, 8), white, this.head, 0, 0.055, 0.075).scale.set(0.013, 0.04, 0.012); // franja de la frente
    mesh(new THREE.SphereGeometry(0.0085, 8, 6), pink, this.head, 0, 0.026, 0.1); // nariz
    const eyeM = std(0xc9c24a, 0.25, { emissive: 0x3a3510 }), pupilM = std(0x050505, 0.3);
    for (const s of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.0135, 10, 8), eyeM, this.head, s * 0.029, 0.05, 0.072);
      mesh(new THREE.SphereGeometry(1, 8, 6), pupilM, this.head, s * 0.029, 0.05, 0.084).scale.set(0.004, 0.011, 0.004);
      const ear = mesh(new THREE.ConeGeometry(0.03, 0.06, 4), black, this.head, s * 0.043, 0.098, 0.005, true);
      ear.rotation.set(-0.15, Math.PI / 4, s * -0.32);
      const inner = mesh(new THREE.ConeGeometry(0.017, 0.035, 4), pink, this.head, s * 0.041, 0.094, 0.016);
      inner.rotation.set(-0.15, Math.PI / 4, s * -0.32);
    }
    // bigotes
    const wv: number[] = [];
    for (const s of [-1, 1]) for (const dy of [-0.006, 0.002, 0.01]) wv.push(s * 0.03, 0.015, 0.088, s * 0.1, 0.015 + dy * 2.2, 0.075);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3));
    this.head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xf6f3ea, transparent: true, opacity: 0.8 })));

    // patas: negras con media blanca y almohadilla; las delanteras cuelgan de la raíz, las traseras del cuerpo
    const legGeo = new THREE.CylinderGeometry(0.019, 0.016, 0.1, 8).translate(0, -0.05, 0);
    const sockGeo = new THREE.CylinderGeometry(0.0175, 0.019, 0.062, 8).translate(0, -0.131, 0);
    const pawGeo = new THREE.SphereGeometry(0.023, 10, 6).scale(1, 0.55, 1.25).translate(0, -0.163, 0.006);
    const addLeg = (parent: THREE.Object3D, x: number, y: number, z: number, front: boolean, side: number) => {
      const pivot = new THREE.Group(); pivot.position.set(x, y, z); parent.add(pivot);
      mesh(legGeo, black, pivot, 0, 0, 0, true); mesh(sockGeo, white, pivot); mesh(pawGeo, white, pivot);
      this.legs.push({ pivot, front, side });
    };
    for (const s of [-1, 1]) addLeg(this.group, s * 0.042, 0.168, 0.1, true, s);
    for (const s of [-1, 1]) addLeg(this.body, s * 0.046, -0.004, -0.2, false, s);

    // cola: seis segmentos encadenados
    let parent: THREE.Object3D = this.body;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.035 : 0.045, i === 0 ? -0.265 : 0);
      seg.rotation.x = i === 0 ? -2.2 : 0.18;
      const r0 = 0.017 - i * 0.0012;
      mesh(new THREE.CylinderGeometry(r0 * 0.9, r0, 0.048, 7).translate(0, 0.024, 0), black, seg, 0, 0, 0, i < 3);
      parent.add(seg); this.tail.push(seg); parent = seg;
    }

    // coronita: anillo de oro con 3 granates y 3 diamantes alternados, flotando sobre la cabeza
    this.crown.position.set(0, 0.165, 0.02);
    this.head.add(this.crown);
    const gold = std(0xf3c24a, 0.22, { metalness: 1, emissive: 0x5a3a00, emissiveIntensity: 0.6 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.0075, 10, 40), gold);
    ring.rotation.x = Math.PI / 2; this.crown.add(ring);
    const garnet = std(0x9b0f24, 0.12, { emissive: 0x3d0008, metalness: 0.1 });
    const diamond = std(0xf2f8ff, 0.04, { emissive: 0x3a4250, metalness: 0.2 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2, kind = k % 2 ? 'diamante' : 'granate';
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(kind === 'granate' ? 0.0105 : 0.0115, 0), kind === 'granate' ? garnet : diamond);
      gem.position.set(Math.cos(a) * 0.045, 0.006, Math.sin(a) * 0.045); gem.scale.y = 1.35;
      this.crown.add(gem);
      this.gems.push({ kind, angle: Math.round((a * 180) / Math.PI) });
    }
  }

  /**
   * Luz propia: las salas están horneadas (su luz vive en texturas que solo afectan a la sala), así que adentro
   * el gato no recibía luz y se veía negro. Con el reflejo del cielo del bosque en sus materiales se ve igual en todas partes.
   */
  hasEnv = false;
  setEnvironment(env: THREE.Texture) {
    const mats = new Set<THREE.MeshStandardMaterial>();
    this.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.isMeshStandardMaterial) mats.add(m); });
    for (const m of mats) { m.envMap = env; m.envMapIntensity = 1.15; m.needsUpdate = true; }
    this.hasEnv = true;
  }

  /** Ubica al gato junto al jugador (al empezar, tras un viaje o un cambio de escena). */
  snap(player: Player, scene: GameScene, canStand: (x: number, z: number) => boolean) {
    scene.scene.add(this.group);
    const t = this.pickTarget(player, scene, canStand);
    this.pos.copy(t); this.prev.copy(t); this.target.copy(t); this.hasTarget = true;
    this.heading = player.yaw + Math.PI; // mirando hacia el jugador
    this.sit = 0; this.idleT = 0; this.speed = 0; this.gait = 'quieto';
    this.place();
  }

  /** Lugar ideal: adelante y a la derecha del jugador, donde se lo ve en la parte baja de la pantalla. */
  private pickTarget(player: Player, scene: GameScene, canStand: (x: number, z: number) => boolean): THREE.Vector3 {
    const s = Math.sin(player.yaw), c = Math.cos(player.yaw), fx = -s, fz = -c, rx = c, rz = -s;
    const ahead = scene.indoor ? 1.7 : 2.8;
    for (const [d, side] of [[ahead, 0.9], [ahead, -0.9], [ahead * 0.6, 0.7], [1.2, -0.6], [0.9, 0.5]]) {
      const p = new V3(player.pos.x + fx * d + rx * side, 0, player.pos.z + fz * d + rz * side);
      if (!canStand(p.x, p.z)) continue;
      const q = p.clone(); scene.collide(q, 0.15);
      if (q.distanceTo(p) < 0.25) return q.setY(scene.groundY(q.x, q.z));
    }
    const p = new V3(player.pos.x + rx * 0.6, 0, player.pos.z + rz * 0.6); scene.collide(p, 0.15);
    return p.setY(scene.groundY(p.x, p.z));
  }

  update(dt: number, t: number, player: Player, scene: GameScene, canStand: (x: number, z: number) => boolean) {
    if (dt <= 0) { this.place(); return; }
    const px = player.pos.x, pz = player.pos.z;
    // ¿sigue bien ubicado? (a la vista, ni muy cerca ni muy lejos); si no, busca un lugar nuevo
    const dx = this.pos.x - px, dz = this.pos.z - pz, dist = Math.hypot(dx, dz);
    if (dist > 14) { this.snap(player, scene, canStand); return; }
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (dist || 1))));
    const far = scene.indoor ? 3.2 : 5, near = 0.9;
    const [ix, iz] = player.moveInput(), moving = player.enabled && (ix !== 0 || iz !== 0);
    if (!this.hasTarget || dist > far || dist < near || ang > 0.95 || moving) {
      this.target.copy(this.pickTarget(player, scene, canStand)); this.hasTarget = true;
    }
    // va hacia su lugar: rápido si está lejos, al paso si está cerca
    const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z, td = Math.hypot(tx, tz);
    const maxV = Math.max(player.speed + 1.5, 4.5);
    const v = td < 0.08 ? 0 : Math.min(maxV, td * 2.6 + 0.4);
    this.prev.copy(this.pos);
    if (v > 0) {
      const step = Math.min(td, v * dt);
      this.pos.x += (tx / td) * step; this.pos.z += (tz / td) * step;
      scene.collide(this.pos, 0.15);
      this.turnTo(Math.atan2(tx, tz), dt * 7);
    } else {
      // quieto: de a poco se gira para mirarte
      this.turnTo(Math.atan2(px - this.pos.x, pz - this.pos.z), dt * 1.5);
    }
    this.pos.y = scene.groundY(this.pos.x, this.pos.z);
    const moved = Math.hypot(this.pos.x - this.prev.x, this.pos.z - this.prev.z) / dt;
    this.speed += (moved - this.speed) * Math.min(1, dt * 8);
    this.gait = this.speed < 0.25 ? 'quieto' : this.speed < 3.6 ? 'camina' : 'trota';
    this.idleT = this.gait === 'quieto' ? this.idleT + dt : 0;
    this.sit += ((this.idleT > 2.5 ? 1 : 0) - this.sit) * Math.min(1, dt * (this.idleT > 2.5 ? 2.2 : 6));
    this.animate(dt, t);
    this.place();
  }

  private turnTo(a: number, k: number) {
    const d = Math.atan2(Math.sin(a - this.heading), Math.cos(a - this.heading));
    this.heading += d * Math.min(1, k);
  }
  private place() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }

  private animate(dt: number, t: number) {
    const trot = this.gait === 'trota', walk = this.gait === 'camina';
    const freq = trot ? 3.4 : walk ? 1.4 + this.speed * 0.55 : 0;
    this.phase += dt * freq * Math.PI * 2;
    const amp = trot ? 0.75 : walk ? 0.45 : 0, sit = this.sit;
    for (const l of this.legs) {
      // paso: diagonales opuestas; trote/galope: pares delantero y trasero desfasados
      const ph = trot ? this.phase + (l.front ? 0 : Math.PI * 0.6) + (l.side > 0 ? 0.25 : 0) : this.phase + (l.front === (l.side > 0) ? 0 : Math.PI);
      let rx = Math.sin(ph) * amp;
      if (!l.front) rx = rx * (1 - sit) + -0.95 * sit; // sentado: patas traseras plegadas hacia adelante, sobre el suelo
      if (l.front) rx = rx * (1 - sit) + 0.12 * sit;
      l.pivot.rotation.x = rx;
    }
    // sentado: el cuerpo gira sobre los hombros y la cadera baja al suelo; la cabeza se mantiene derecha
    const bob = trot ? Math.abs(Math.sin(this.phase)) * 0.018 : walk ? Math.abs(Math.sin(this.phase)) * 0.006 : 0;
    this.body.rotation.x = -0.62 * sit + (trot ? Math.sin(this.phase) * 0.06 : 0);
    this.body.position.y = 0.168 + bob + 0.012 * sit;
    const breath = 1 + Math.sin(t * 2.2) * 0.015 * (1 - Math.min(1, this.speed));
    this.body.scale.set(breath, breath, 1);
    this.head.rotation.x = 0.62 * sit + (walk ? Math.sin(this.phase * 2) * 0.03 : 0);
    this.head.rotation.y = this.gait === 'quieto' ? Math.sin(t * 0.37) * 0.35 : 0;
    // cola: ondula; trotando se estira hacia atrás
    this.tail.forEach((seg, i) => {
      if (i === 0) seg.rotation.x = -2.2 + (trot ? 0.6 : 0) + sit * 0.5;
      seg.rotation.z = Math.sin(t * (trot ? 4 : 1.6) - i * 0.6) * (0.12 + i * 0.03);
    });
    // coronita: gira lenta y flota
    this.crown.rotation.y = t * 0.6;
    this.crown.position.y = 0.165 + Math.sin(t * 1.8) * 0.006;
  }
}
