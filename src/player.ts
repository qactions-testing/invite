// Jugador en primera persona (1 m/s), entrada de teclado/mouse, auto-caminata y pathfinding A*.
import * as THREE from 'three';
import { GameScene } from './core';
import { Geo } from './world/geo';

const MOVE: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
export const isMoveKey = (code: string) => code in MOVE;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  pos = new THREE.Vector3();
  yaw = 0; pitch = 0;
  readonly eye = 1.62; readonly radius = 0.36;
  /** caminar: 3 m/s · trotar (Shift o botón Trotar): 6 m/s */
  readonly walkSpeed = 3.0; readonly runSpeed = 6.0;
  get speed() { return this.run || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? this.runSpeed : this.walkSpeed; }
  keys = new Set<string>();
  /** joystick táctil: dirección unitaria [derecha, adelante] o [0, 0] */
  stick: [number, number] = [0, 0];
  /** botón Trotar (táctil): alterna el trote */
  run = false;
  /** falso mientras hay un panel abierto */
  enabled = true;
  walked = 0;
  private bobT = 0; private bob = 0;
  // auto-caminata
  private path: THREE.Vector3[] | null = null; private idx = 0;
  private face: THREE.Vector3 | null = null; private onArrive: (() => void) | null = null;
  private stuckT = 0; private stuckRef = new THREE.Vector3(); private stop = 1.5;

  get auto() { return this.path !== null || this.face !== null; }

  moveInput(): [number, number] {
    let x = 0, f = 0;
    for (const k of this.keys) { const m = MOVE[k]; if (m) { x += m[0]; f += m[1]; } }
    if (!x && !f && (this.stick[0] || this.stick[1])) return this.stick;
    return [Math.sign(x), Math.sign(f)];
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.45, 1.45);
  }

  /** Camina por `points` y al llegar mira hacia `face`. `stop` = distancia a la que frena del último punto. */
  walkPath(points: THREE.Vector3[], face: THREE.Vector3 | null, onArrive: (() => void) | null, stop = 1.5) {
    this.path = points.length ? points : null; this.idx = 0; this.face = face; this.onArrive = onArrive; this.stop = stop;
    this.stuckT = 0; this.stuckRef.copy(this.pos);
    if (!this.path && !face) { onArrive?.(); this.onArrive = null; }
  }
  cancelAuto() { this.path = null; this.face = null; this.onArrive = null; }

  update(dt: number, gs: GameScene) {
    let mx = 0, mz = 0;
    if (this.path) {
      const last = this.idx >= this.path.length - 1, tgt = this.path[this.idx];
      const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < (last ? this.stop : 0.55)) {
        if (last) this.path = null; else this.idx++;
      } else {
        mx = dx / d; mz = dz / d;
        const want = Math.atan2(-mx, -mz);
        this.yaw += THREE.MathUtils.clamp(wrap(want - this.yaw), -2.4 * dt, 2.4 * dt);
        this.pitch += (-0.05 - this.pitch) * Math.min(1, dt * 2);
        // destrabe: si casi no avanza en 2.5 s, salta al siguiente punto
        this.stuckT += dt;
        if (this.stuckT > 2.5) {
          if (this.stuckRef.distanceTo(this.pos) < 0.5) { if (last) this.path = null; else this.idx++; }
          this.stuckT = 0; this.stuckRef.copy(this.pos);
        }
      }
    } else if (this.face) {
      const dx = this.face.x - this.pos.x, dz = this.face.z - this.pos.z, dy = this.face.y - (this.pos.y + this.eye);
      const wy = Math.atan2(-dx, -dz), wp = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.2, 1.2);
      const ey = wrap(wy - this.yaw), ep = wp - this.pitch;
      this.yaw += THREE.MathUtils.clamp(ey, -2.6 * dt, 2.6 * dt);
      this.pitch += THREE.MathUtils.clamp(ep, -2.0 * dt, 2.0 * dt);
      if (Math.abs(ey) < 0.02 && Math.abs(ep) < 0.02) { this.face = null; const cb = this.onArrive; this.onArrive = null; cb?.(); }
    } else if (this.onArrive) { const cb = this.onArrive; this.onArrive = null; cb(); }
    else if (this.enabled) {
      const [ix, iz] = this.moveInput();
      if (ix || iz) {
        const l = Math.hypot(ix, iz), s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        // adelante = (-sin, -cos); derecha = (cos, -sin)
        mx = ((-s * iz + c * ix) / l); mz = ((-c * iz - s * ix) / l);
      }
    }
    if (mx || mz) {
      const ox = this.pos.x, oz = this.pos.z;
      this.pos.x += mx * this.speed * dt; this.pos.z += mz * this.speed * dt;
      gs.collide(this.pos, this.radius);
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      this.walked += moved; this.bobT += moved;
    }
    this.pos.y = gs.groundY(this.pos.x, this.pos.z);
    const targetBob = mx || mz ? Math.sin(this.bobT * 5.2) * 0.022 : 0;
    this.bob += (targetBob - this.bob) * Math.min(1, dt * 10);
  }

  apply(cam: THREE.PerspectiveCamera) {
    cam.position.set(this.pos.x, this.pos.y + this.eye + this.bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

/** Grilla de navegación de 2 m sobre la tierra firme del bosque. */
export class Nav {
  readonly cell = 2;
  w: number; h: number; x0: number; z0: number;
  walk: Uint8Array; cost: Float32Array;

  constructor(geo: Geo, heightAt: (x: number, z: number) => number, blocked: (x: number, z: number) => boolean) {
    this.x0 = geo.x0; this.z0 = geo.z0;
    this.w = Math.floor(geo.w / this.cell); this.h = Math.floor(geo.h / this.cell);
    this.walk = new Uint8Array(this.w * this.h); this.cost = new Float32Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = this.x0 + (i + 0.5) * this.cell, z = this.z0 + (j + 0.5) * this.cell, c = j * this.w + i;
      const ok = geo.sample(geo.sdfMain, x, z) > 1.4 && !blocked(x, z);
      this.walk[c] = ok ? 1 : 0;
      if (!ok) continue;
      const hgt = heightAt(x, z), slope = Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;
      this.cost[c] = 1 + slope * 2.2 + (geo.sample(geo.riverSd, x, z) < 0.2 ? 2.2 : 0) + (hgt > 8 ? 2 : 0);
    }
  }
  /** ¿Se puede pararse en (x, z)? (tierra firme, sin troncos ni agua) */
  walkable(x: number, z: number) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walk[j * this.w + i] === 1;
  }
  private ci(x: number) { return Math.min(this.w - 1, Math.max(0, Math.floor((x - this.x0) / this.cell))); }
  private cj(z: number) { return Math.min(this.h - 1, Math.max(0, Math.floor((z - this.z0) / this.cell))); }
  private nearest(x: number, z: number): number {
    const i0 = this.ci(x), j0 = this.cj(z);
    for (let r = 0; r < 14; r++) {
      let best = -1, bd = 1e9;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= this.w || j >= this.h || !this.walk[j * this.w + i]) continue;
        const d = (i - i0) ** 2 + (j - j0) ** 2;
        if (d < bd) { bd = d; best = j * this.w + i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  private los(a: number, b: number): boolean {
    const ai = a % this.w, aj = (a - ai) / this.w, bi = b % this.w, bj = (b - bi) / this.w;
    const n = Math.max(Math.abs(bi - ai), Math.abs(bj - aj)) * 2;
    for (let s = 1; s < n; s++) {
      const c = Math.round(aj + ((bj - aj) * s) / n) * this.w + Math.round(ai + ((bi - ai) * s) / n);
      if (!this.walk[c] || this.cost[c] > 2.4) return false;
    }
    return true;
  }

  /** A* de (ax,az) a (bx,bz). Devuelve puntos [x,z] en metros de mundo, o null. */
  find(ax: number, az: number, bx: number, bz: number): [number, number][] | null {
    const start = this.nearest(ax, az), goal = this.nearest(bx, bz);
    if (start < 0 || goal < 0) return null;
    const N = this.w * this.h, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const gi = goal % this.w, gj = (goal - gi) / this.w;
    const heur = (c: number) => { const i = c % this.w, j = (c - i) / this.w, dx = Math.abs(i - gi), dz = Math.abs(j - gj); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    const heap: number[] = [], f = new Float32Array(N);
    const push = (c: number) => { heap.push(c); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l; if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } }
      return top;
    };
    g[start] = 0; f[start] = heur(start); push(start);
    while (heap.length) {
      const c = pop();
      if (c === goal) break;
      if (closed[c]) continue;
      closed[c] = 1;
      const i = c % this.w, j = (c - i) / this.w;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
        const n = nj * this.w + ni;
        if (!this.walk[n] || closed[n]) continue;
        if (di && dj && (!this.walk[j * this.w + ni] || !this.walk[nj * this.w + i])) continue;
        const ng = g[c] + (di && dj ? 1.4142 : 1) * this.cost[n];
        if (ng < g[n]) { g[n] = ng; from[n] = c; f[n] = ng + heur(n); push(n); }
      }
    }
    if (from[goal] < 0 && goal !== start) return null;
    const cells: number[] = [];
    for (let c = goal; c >= 0; c = from[c]) { cells.push(c); if (c === start) break; }
    cells.reverse();
    // suavizado por línea de visión
    const out: number[] = [cells[0]];
    for (let a = 0; a < cells.length - 1;) {
      let b = Math.min(cells.length - 1, a + 14);
      while (b > a + 1 && !this.los(cells[a], cells[b])) b--;
      out.push(cells[b]); a = b;
    }
    return out.map((c) => { const i = c % this.w, j = (c - i) / this.w; return [this.x0 + (i + 0.5) * this.cell, this.z0 + (j + 0.5) * this.cell] as [number, number]; });
  }
}
