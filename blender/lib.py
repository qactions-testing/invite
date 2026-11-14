# Utilidades para construir las salas en Blender (headless), hornear lightmaps y exportar GLB.
# Convención: se modela en coordenadas de Blender (Z arriba); el JSON de metadatos se escribe
# en coordenadas de three.js: (x, y, z)_three = (x, z, -y)_blender.
import bpy, bmesh, math, os, json, random, subprocess
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_DIR = os.path.join(ROOT, '.cache', 'polyhaven')
OUT_DIR = os.path.join(ROOT, 'public', 'assets', 'rooms')
TMP_DIR = os.path.join(ROOT, '.cache', 'bake')
TAU = math.pi * 2
_mats = {}
_lights = {'A': [], 'fire': []}
_backdrops = []


def t3(x, y, z):
    """Blender → three.js"""
    return [round(x, 3), round(z, 3), round(-y, 3)]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(os.environ.get('BAKE_SAMPLES', '160'))
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    w = bpy.data.worlds.new('mundo')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0, 0, 0, 1)
    bg.inputs[1].default_value = 0.0
    _mats.clear()
    _lights['A'].clear(); _lights['fire'].clear(); _backdrops.clear()
    os.makedirs(OUT_DIR, exist_ok=True); os.makedirs(TMP_DIR, exist_ok=True)


# ---------------------------------------------------------------- materiales
def _bsdf(m):
    return m.node_tree.nodes['Principled BSDF']


def mat_color(name, rgb, rough=0.8, metal=0.0, emit=None, strength=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = _bsdf(m)
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    _mats[name] = m
    return m


def mat_ph(tex, tint=None):
    """Material con textura difusa de Poly Haven. El nombre viaja al GLB: ph_<id>[__rrggbb]."""
    name = f'ph_{tex}' + (f'__{tint}' if tint else '')
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = _bsdf(m)
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(os.path.join(TEX_DIR, f'{tex}.jpg'), check_existing=True)
    if tint:
        c = [int(tint[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        c = [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c]
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        nt.links.new(img.outputs['Color'], mix.inputs[6])
        mix.inputs[7].default_value = (*c, 1)
        nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    else:
        nt.links.new(img.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85
    _mats[name] = m
    return m


# ---------------------------------------------------------------- mallas
def _finish(name, bm, mat, smooth=False, uv=1.0, cyl_uv=False):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat:
        me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    uv_box(ob, uv, cyl_uv)
    return ob


def uv_box(ob, size=1.0, cyl=False):
    """UV0 por proyección de caja (o cilíndrica alrededor de Z) en metros / size."""
    me = ob.data
    layer = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if cyl and ax != 2:
                r = math.hypot(co.x, co.y)
                u, v = math.atan2(co.y, co.x) * max(r, 0.5), co.z
            elif ax == 0:
                u, v = co.y, co.z
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            layer.data[li].uv = (u / size, v / size)


def _xf(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Diagonal((*scale, 1))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)


def box(name, size, loc, mat, rot=(0, 0, 0), uv=1.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    _xf(bm, loc, rot, size)
    return _finish(name, bm, mat, uv=uv)


def cyl(name, r1, r2, h, loc, mat, segs=16, rot=(0, 0, 0), smooth=True, uv=1.0, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=True, segments=segs, radius1=r1, radius2=r2, depth=h)
    _xf(bm, loc, rot)
    ob = _finish(name, bm, mat, uv=uv)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = abs(p.normal.z) < 0.9 if rot == (0, 0, 0) else len(p.vertices) == 4
    return ob


def sphere(name, r, loc, mat, scale=(1, 1, 1), segs=16, rings=10, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    _xf(bm, loc, rot, scale)
    return _finish(name, bm, mat, smooth=True)


def lathe(name, profile, loc, mat, segs=24, smooth=True, uv=1.0, a0=0.0, a1=TAU, flip=False, cyl_uv=False):
    """Superficie de revolución alrededor de Z. profile = [(radio, z), ...]"""
    bm = bmesh.new()
    closed = abs((a1 - a0) - TAU) < 1e-6
    n = segs if closed else segs + 1
    rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new((r * math.cos(a0 + (a1 - a0) * s / segs), r * math.sin(a0 + (a1 - a0) * s / segs), z)) for s in range(n)])
    for k in range(len(rings) - 1):
        for s in range(segs):
            a, b = rings[k][s], rings[k][(s + 1) % n]
            c, d = rings[k + 1][(s + 1) % n], rings[k + 1][s]
            try:
                bm.faces.new((a, d, c, b) if flip else (a, b, c, d))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    _xf(bm, loc)
    return _finish(name, bm, mat, smooth=smooth, uv=uv, cyl_uv=cyl_uv)


def torus(name, R, r, loc, mat, rot=(0, 0, 0), segs=24, tsegs=8, arc=TAU):
    bm = bmesh.new()
    closed = abs(arc - TAU) < 1e-6
    n = segs if closed else segs + 1
    rings = []
    for s in range(n):
        a = arc * s / segs
        rings.append([bm.verts.new(((R + r * math.cos(TAU * t / tsegs)) * math.cos(a), (R + r * math.cos(TAU * t / tsegs)) * math.sin(a), r * math.sin(TAU * t / tsegs))) for t in range(tsegs)])
    for s in range(segs):
        for t in range(tsegs):
            a, b = rings[s][t], rings[(s + 1) % n][t]
            c, d = rings[(s + 1) % n][(t + 1) % tsegs], rings[s][(t + 1) % tsegs]
            bm.faces.new((a, b, c, d))
    _xf(bm, loc, rot)
    return _finish(name, bm, mat, smooth=True)


def tube(name, pts, radii, mat, segs=8, smooth=True, caps=True):
    """Tubo a lo largo de una polilínea."""
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    if isinstance(radii, (int, float)):
        radii = [radii] * len(pts)
    rings = []
    for k, p in enumerate(pts):
        t = (pts[min(len(pts) - 1, k + 1)] - pts[max(0, k - 1)]).normalized()
        ref = Vector((1, 0, 0)) if abs(t.z) > 0.9 else Vector((0, 0, 1))
        n = t.cross(ref).normalized(); b = t.cross(n)
        rings.append([bm.verts.new(p + (n * math.cos(TAU * s / segs) + b * math.sin(TAU * s / segs)) * radii[k]) for s in range(segs)])
    for k in range(len(rings) - 1):
        for s in range(segs):
            bm.faces.new((rings[k][s], rings[k][(s + 1) % segs], rings[k + 1][(s + 1) % segs], rings[k + 1][s]))
    if caps:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, bm, mat, smooth=smooth)


def disc(name, r, loc, mat, segs=28, rot=(0, 0, 0), uv=1.0, down=False):
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=True, segments=segs, radius=r)
    if down:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    _xf(bm, loc, rot)
    return _finish(name, bm, mat, uv=uv)


def wall(name, p0, u, v, nu, nv, mat, hole=None, uv=1.0, flip=False):
    """Pared en grilla desde p0 con ejes u (ancho) y v (alto). hole(s, t) con s,t en metros → True = hueco."""
    bm = bmesh.new()
    p0, u, v = Vector(p0), Vector(u), Vector(v)
    lu, lv = u.length, v.length
    vs = [[bm.verts.new(p0 + u * (i / nu) + v * (j / nv)) for i in range(nu + 1)] for j in range(nv + 1)]
    for j in range(nv):
        for i in range(nu):
            if hole and hole((i + 0.5) / nu * lu, (j + 0.5) / nv * lv):
                continue
            q = (vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i])
            bm.faces.new(tuple(reversed(q)) if flip else q)
    return _finish(name, bm, mat, uv=uv)


def shell(name, rfn, zs, segs, mat, hole=None, uv=1.0, inward=True):
    """Pared de revolución irregular: radio = rfn(ángulo, z). hole(ángulo, z) → True = abertura."""
    bm = bmesh.new()
    rings = [[bm.verts.new((rfn(TAU * s / segs, z) * math.cos(TAU * s / segs), rfn(TAU * s / segs, z) * math.sin(TAU * s / segs), z)) for s in range(segs)] for z in zs]
    for k in range(len(zs) - 1):
        for s in range(segs):
            if hole and hole(TAU * (s + 0.5) / segs, (zs[k] + zs[k + 1]) / 2):
                continue
            q = (rings[k][s], rings[k][(s + 1) % segs], rings[k + 1][(s + 1) % segs], rings[k + 1][s])
            bm.faces.new(tuple(reversed(q)) if inward else q)
    return _finish(name, bm, mat, smooth=True, uv=uv, cyl_uv=True)


def adiff(a, b):
    return math.atan2(math.sin(a - b), math.cos(a - b))


def join(name, objs):
    objs = [o for o in objs if o]
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


# ---------------------------------------------------------------- luces
def _light(kind, name, loc, rgb, energy, group):
    L = bpy.data.lights.new(name, kind)
    L.color = rgb; L.energy = energy
    ob = bpy.data.objects.new(name, L)
    ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    _lights[group].append(ob)
    return ob


def point(name, loc, rgb, watts, group='A', radius=0.06):
    ob = _light('POINT', name, loc, rgb, watts, group)
    ob.data.shadow_soft_size = radius
    return ob


def area(name, loc, toward, size, rgb, watts, group='A'):
    ob = _light('AREA', name, loc, rgb, watts, group)
    ob.data.shape = 'RECTANGLE'; ob.data.size = size[0]; ob.data.size_y = size[1]
    d = (Vector(toward) - Vector(loc)).normalized()
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def sun(name, direction, rgb, strength, angle=0.03, group='A'):
    ob = _light('SUN', name, (0, 0, 10), rgb, strength, group)
    ob.data.angle = angle
    ob.rotation_euler = Vector(direction).normalized().to_track_quat('-Z', 'Y').to_euler()
    return ob


def backdrop(name, ob, rgb, strength):
    """Plano emisivo que se ve por una abertura (cielo del atardecer). No se hornea ni da sombra."""
    ob.data.materials.clear()
    ob.data.materials.append(mat_color(f'cielo_{name}', (0, 0, 0), emit=rgb, strength=strength))
    ob.visible_shadow = False
    ob.name = f'cielo_{name}'
    _backdrops.append(ob)
    return ob


# ---------------------------------------------------------------- horneado y exportación
def _denoise(rgb, size, tag):
    """Limpia el ruido del horneado con OpenImageDenoise (nodo Denoise del compositor)."""
    src_path = os.path.join(TMP_DIR, f'{tag}_ruido.exr')
    dst_path = os.path.join(TMP_DIR, f'{tag}_limpio.exr')
    src = bpy.data.images.new('dn_src', size, size, alpha=False, float_buffer=True)
    buf = np.ones((size, size, 4), dtype=np.float32)
    buf[:, :, :3] = rgb
    src.pixels.foreach_set(buf.ravel())
    src.filepath_raw = src_path; src.file_format = 'OPEN_EXR'; src.save()
    bpy.data.images.remove(src)
    src = bpy.data.images.load(src_path)
    scn = bpy.data.scenes.new('denoise')
    scn.render.resolution_x = scn.render.resolution_y = size
    scn.render.resolution_percentage = 100
    scn.render.engine = 'CYCLES'; scn.cycles.samples = 1; scn.cycles.device = 'CPU'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam); scn.camera = cam
    scn.use_nodes = True
    nt = scn.node_tree
    nt.nodes.clear()
    im = nt.nodes.new('CompositorNodeImage'); im.image = src
    dn = nt.nodes.new('CompositorNodeDenoise'); dn.use_hdr = True
    out = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(im.outputs['Image'], dn.inputs['Image'])
    nt.links.new(dn.outputs['Image'], out.inputs['Image'])
    scn.render.image_settings.file_format = 'OPEN_EXR'
    scn.render.image_settings.color_depth = '32'
    scn.render.filepath = dst_path
    bpy.ops.render.render(write_still=True, scene=scn.name)
    res = bpy.data.images.load(dst_path)
    px = np.empty(size * size * 4, dtype=np.float32)
    res.pixels.foreach_get(px)
    clean = px.reshape(size, size, 4)[:, :, :3].copy()
    bpy.data.images.remove(res); bpy.data.images.remove(src)
    bpy.data.scenes.remove(scn)
    return clean


def _encode(rgb, size, K, path_webp):
    v = np.clip(rgb / K, 0, 1)
    v = np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    out = bpy.data.images.new('enc', size, size, alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    buf = np.ones((size, size, 4), dtype=np.float32)
    buf[:, :, :3] = v
    out.pixels.foreach_set(buf.ravel())
    png = os.path.join(TMP_DIR, os.path.basename(path_webp).replace('.webp', '.png'))
    out.filepath_raw = png; out.file_format = 'PNG'; out.save()
    bpy.data.images.remove(out)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '92', path_webp], check=True)


def bake_and_export(room_id, bake_objs, extra_objs, meta, size=2048, fire=True, gain=1.0):
    size = int(os.environ.get('BAKE_SIZE', size))
    sc = bpy.context.scene
    for o in sc.objects:
        o.select_set(False)
    for o in bake_objs:
        lm = o.data.uv_layers.new(name='LM')
        o.data.uv_layers.active = lm
        o.data.uv_layers['UVMap'].active_render = True
        o.select_set(True)
    bpy.context.view_layer.objects.active = bake_objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    mats = set()
    for o in bake_objs:
        for sl in o.material_slots:
            if sl.material:
                mats.add(sl.material)
    nodes = []
    for m in mats:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        for other in m.node_tree.nodes:
            other.select = False
        n.select = True
        m.node_tree.nodes.active = n
        nodes.append(n)

    sc.render.bake.margin = 8
    layers = [('lm', 'A')] + ([('fire', 'fire')] if fire and _lights['fire'] else [])
    stats, baked = {}, {}
    for suffix, group in layers:
        # una imagen nueva por capa: reutilizarla devolvía los píxeles de la capa anterior
        img = bpy.data.images.new(f'{room_id}_{suffix}', size, size, alpha=False, float_buffer=True)
        for n in nodes:
            n.image = img
        for g, objs in _lights.items():
            for ob in objs:
                ob.hide_render = g != group
        for ob in _backdrops:
            ob.hide_render = group != 'A'
        bpy.context.view_layer.update()
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True, margin=8)
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        rgb = px.reshape(size, size, 4)[:, :, :3].copy()
        mx = rgb.max(axis=2).ravel()
        lit = mx[mx > 1e-5]
        stats[suffix] = float(np.percentile(lit, 97.0)) if lit.size else 0.0
        baked[suffix] = _denoise(rgb, size, f'{room_id}_{suffix}') if os.environ.get('BAKE_DENOISE', '1') == '1' else rgb
    K = max(0.5, min(8.0, max(stats.values()) * 1.6))
    for suffix, _ in layers:
        _encode(baked[suffix], size, K, os.path.join(OUT_DIR, f'{room_id}_{suffix}.webp'))
    meta['lightK'] = round(K * gain, 4)
    print(f'[{room_id}] percentil 97 por capa {stats} → K={K:.3f}')

    for o in sc.objects:
        o.select_set(False)
    for o in bake_objs + list(extra_objs) + _backdrops:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, f'{room_id}.glb'), export_format='GLB', use_selection=True, export_apply=True,
                              export_materials='EXPORT', export_image_format='NONE', export_yup=True, export_cameras=False, export_lights=False,
                              export_animations=False)
    with open(os.path.join(OUT_DIR, f'{room_id}.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    blend = os.path.join(TMP_DIR, f'{room_id}.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f'[{room_id}] exportado: {len(bake_objs)} objetos horneados')
