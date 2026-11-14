// Tipos compartidos entre escenas, jugador y UI.
import * as THREE from 'three';

export interface Interactable {
  id: string;
  placeId: string;
  name: string;
  /** read: abre el lector · door: cambia de escena */
  action: 'read' | 'door';
  message?: string;
  /** escena destino para action 'door' */
  target?: string;
  object: THREE.Object3D;
  /** punto de interés (para mirar y caminar hasta él) */
  pos: THREE.Vector3;
}

export interface GameScene {
  id: string;
  name: string;
  indoor: boolean;
  scene: THREE.Scene;
  interactables: Interactable[];
  groundY(x: number, z: number): number;
  /** empuja `p` fuera de obstáculos (modifica x/z) */
  collide(p: THREE.Vector3, r: number): void;
  update(dt: number, t: number, cam: THREE.PerspectiveCamera, viewH: number): void;
  /** posición de llegada viniendo desde otra escena (o null = inicio) */
  entry(from: string | null): { pos: THREE.Vector3; yaw: number };
  /** parámetros que usa el audio ambiente */
  ambience?(cam: THREE.Vector3): { water: number; fire: number; cave: number };
}

export type Circle = { x: number; z: number; r: number };

/** Empuja un punto fuera de un círculo. */
export function pushOut(p: THREE.Vector3, c: Circle, r: number) {
  const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
  if (d < min) {
    if (d < 1e-5) { p.x = c.x + min; return; }
    p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min;
  }
}

/** Hash espacial de círculos (troncos, rocas). */
export class CircleHash {
  private cells = new Map<number, Circle[]>();
  constructor(private size = 4) {}
  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }
  add(c: Circle) {
    const i0 = Math.floor((c.x - c.r) / this.size), i1 = Math.floor((c.x + c.r) / this.size);
    const j0 = Math.floor((c.z - c.r) / this.size), j1 = Math.floor((c.z + c.r) / this.size);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(c);
    }
  }
  resolve(p: THREE.Vector3, r: number) {
    const i0 = Math.floor((p.x - r) / this.size), i1 = Math.floor((p.x + r) / this.size);
    const j0 = Math.floor((p.z - r) / this.size), j1 = Math.floor((p.z + r) / this.size);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = this.cells.get(this.key(i, j));
      if (list) for (const c of list) pushOut(p, c, r);
    }
  }
  hit(x: number, z: number, r: number): boolean {
    const list = this.cells.get(this.key(Math.floor(x / this.size), Math.floor(z / this.size)));
    if (list) for (const c of list) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    return false;
  }
}
