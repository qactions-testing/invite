// Salas horneadas en Blender: carga del GLB + lightmaps (capa estática y capa de fuego que parpadea).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GameScene, Interactable, pushOut } from '../core';
import { PLACES, PlaceDef } from '../content/ideas';
import { Fire, Puffs, flicker, heartTexture, puffTexture, sparkle } from '../fx';

/** Biblioteca de texturas difusas de Poly Haven, cacheadas por id. */
export class TexLib {
  private cache = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  get(id: string): THREE.Texture {
    let t = this.cache.get(id);
    if (!t) {
      t = this.loader.load(`assets/textures/${id}.webp`);
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
      this.cache.set(id, t);
    }
    return t;
  }
  async ready(ids: string[]) {
    await Promise.all(ids.map((id) => new Promise<void>((res) => {
      const t = this.loader.load(`assets/textures/${id}.webp`, () => res(), undefined, () => res());
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
      this.cache.set(id, t);
    })));
  }
}

export function loadLightmap(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.channel = 1; t.generateMipmaps = false;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    return t;
  });
}

/**
 * Reemplaza los materiales de un GLB por materiales "horneados" sin luces en tiempo real:
 * color = albedo × (lightmap estático + lightmap de fuego × parpadeo).
 * Materiales `ph_<id>` toman la textura de Poly Haven; los emisivos brillan sin lightmap.
 */
export function applyBaked(root: THREE.Object3D, lib: TexLib, lm: THREE.Texture, fireMap: THREE.Texture | null, uFire: { value: number }, K: number, skip?: (m: THREE.Mesh) => boolean) {
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (skip && skip(mesh))) return;
    const conv = (src: THREE.Material): THREE.Material => {
      let out = cache.get(src);
      if (out) return out;
      const s = src as THREE.MeshStandardMaterial;
      const em = s.emissive ? s.emissive.clone().multiplyScalar(s.emissiveIntensity ?? 1) : new THREE.Color(0);
      if (em.r + em.g + em.b > 0.05) {
        out = new THREE.MeshBasicMaterial({ color: em, side: s.side });
      } else {
        const m = new THREE.MeshBasicMaterial({ color: s.color ? s.color.clone() : new THREE.Color(1, 1, 1), side: s.side, transparent: s.transparent, opacity: s.opacity });
        // ph_<textura>[__rrggbb]: textura de Poly Haven con tinte opcional
        const ph = /^ph_(.+?)(?:__([0-9a-f]{6}))?(?:\.\d+)?$/.exec(src.name);
        if (ph) { m.map = lib.get(ph[1]); m.color.set(ph[2] ? `#${ph[2]}` : '#ffffff'); }
        if (mesh.geometry.getAttribute('uv1')) {
          m.lightMap = lm; m.lightMapIntensity = K * Math.PI;
          if (fireMap) m.onBeforeCompile = (sh) => {
            sh.uniforms.tFire = { value: fireMap }; sh.uniforms.uFire = uFire;
            sh.fragmentShader = sh.fragmentShader
              .replace('#include <common>', '#include <common>\nuniform sampler2D tFire; uniform float uFire;')
              .replace('reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;',
                'reflectedLight.indirectDiffuse += (lightMapTexel.rgb + texture2D(tFire, vLightMapUv).rgb * uFire) * lightMapIntensity * RECIPROCAL_PI;');
          };
        }
        out = m;
      }
      out.name = src.name;
      cache.set(src, out);
      return out;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
}

export interface RoomMeta {
  id: string; lightK: number; floorY: number;
  walk: { type: 'circle'; x: number; z: number; r: number } | { type: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: ({ x: number; z: number; r: number } | { minX: number; maxX: number; minZ: number; maxZ: number })[];
  spawn: { x: number; z: number; yaw: number };
  fires: { x: number; y: number; z: number; size: number }[];
  hearts?: [number, number, number][];
  steam?: [number, number, number][];
  background?: [number, number, number];
}

export class RoomScene implements GameScene {
  indoor = true;
  scene = new THREE.Scene();
  interactables: Interactable[] = [];
  uFire = { value: 1 };
  fires: Fire[] = [];
  hearts: Puffs | null = null;
  private steam: Puffs | null = null;
  private sparkles: THREE.Sprite[] = [];

  constructor(public id: string, public name: string, public place: PlaceDef, public meta: RoomMeta) {}

  static async load(id: string, lib: TexLib): Promise<RoomScene> {
    const place = PLACES.find((p) => p.id === id)!;
    const meta: RoomMeta = await (await fetch(`assets/rooms/${id}.json`)).json();
    const [gltf, lm, fm] = await Promise.all([
      new GLTFLoader().loadAsync(`assets/rooms/${id}.glb`),
      loadLightmap(`assets/rooms/${id}_lm.webp`),
      loadLightmap(`assets/rooms/${id}_fire.webp`).catch(() => null),
    ]);
    const room = new RoomScene(id, place.name, place, meta);
    const bg = meta.background ?? [0.02, 0.014, 0.01];
    room.scene.background = new THREE.Color(bg[0], bg[1], bg[2]);
    applyBaked(gltf.scene, lib, lm, fm, room.uFire, meta.lightK);
    room.scene.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);

    gltf.scene.traverse((o) => {
      const raw: string = (o.userData?.name as string) || o.name;
      // los hijos de un interactivo (una primitiva por material) no son objetos aparte
      if (!raw.startsWith('I_') || ((o.parent?.userData?.name as string) || o.parent?.name || '').startsWith('I_')) return;
      const key = raw.slice(2);
      const box = new THREE.Box3().setFromObject(o), pos = box.getCenter(new THREE.Vector3());
      if (key === 'puerta') {
        room.interactables.push({ id: `salida-${id}`, placeId: id, name: 'Salir al bosque', action: 'door', target: 'bosque', object: o, pos });
      } else {
        const def = place.objects.find((d) => d.id === key);
        if (!def) { console.warn(`[${id}] objeto sin contenido: ${key}`); return; }
        room.interactables.push({ id: def.id, placeId: id, name: def.name, action: 'read', message: def.message, object: o, pos });
        const s = sparkle(); s.position.set(pos.x, box.max.y + 0.16, pos.z); room.scene.add(s); room.sparkles.push(s);
      }
      o.traverse((c) => { c.userData.interactId = key === 'puerta' ? `salida-${id}` : key; });
    });
    for (const d of place.objects) if (!room.interactables.some((i) => i.id === d.id)) console.warn(`[${id}] falta en el GLB: I_${d.id}`);

    meta.fires.forEach((f, i) => {
      const fire = new Fire(f.size, { seed: i + 2 });
      fire.group.position.set(f.x, f.y, f.z); room.scene.add(fire.group); room.fires.push(fire);
    });
    if (meta.hearts?.length) {
      room.hearts = new Puffs(heartTexture(), meta.hearts.map((h) => new THREE.Vector3(h[0], h[1], h[2])), { rate: 1.5, life: 2.6, rise: 0.42, size: [0.07, 0.2], sway: 0.16, opacity: 0.95 });
      room.scene.add(room.hearts.group);
    }
    if (meta.steam?.length) {
      room.steam = new Puffs(puffTexture(), meta.steam.map((h) => new THREE.Vector3(h[0], h[1], h[2])), { rate: 2.2, life: 2.2, rise: 0.28, size: [0.06, 0.3], sway: 0.06, opacity: 0.32 });
      room.scene.add(room.steam.group);
    }
    return room;
  }

  groundY() { return this.meta.floorY; }

  collide(p: THREE.Vector3, r: number) {
    const w = this.meta.walk;
    if (w.type === 'circle') {
      const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz), max = w.r - r;
      if (d > max) { p.x = w.x + (dx / d) * max; p.z = w.z + (dz / d) * max; }
    } else {
      p.x = Math.min(w.maxX - r, Math.max(w.minX + r, p.x)); p.z = Math.min(w.maxZ - r, Math.max(w.minZ + r, p.z));
    }
    for (const o of this.meta.obstacles) {
      if ('r' in o) pushOut(p, o, r);
      else if (p.x > o.minX - r && p.x < o.maxX + r && p.z > o.minZ - r && p.z < o.maxZ + r) {
        const dl = p.x - (o.minX - r), dr = o.maxX + r - p.x, dn = p.z - (o.minZ - r), df = o.maxZ + r - p.z, m = Math.min(dl, dr, dn, df);
        if (m === dl) p.x = o.minX - r; else if (m === dr) p.x = o.maxX + r; else if (m === dn) p.z = o.minZ - r; else p.z = o.maxZ + r;
      }
    }
  }

  update(dt: number, t: number) {
    this.uFire.value = 0.2 + 1.0 * flicker(t, 1.3);
    for (const f of this.fires) f.update(t);
    this.hearts?.update(dt); this.steam?.update(dt);
    this.sparkles.forEach((s, i) => { s.scale.setScalar(0.2 + 0.06 * Math.sin(t * 2.4 + i * 1.7)); s.material.rotation = t * 0.4 + i; });
  }

  entry() { return { pos: new THREE.Vector3(this.meta.spawn.x, this.meta.floorY, this.meta.spawn.z), yaw: this.meta.spawn.yaw }; }
  ambience() { return { water: 0, fire: this.meta.fires.length ? 0.8 : 0, cave: 0 }; }
}
