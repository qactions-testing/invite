# Construye, hornea y exporta las salas y la cueva.
# Uso: blender -b -P blender/build.py -- [cana|abuelas|gnomos|cueva|kit|all]
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: F401,F403
from mathutils import Vector

WARM = (1.0, 0.6, 0.3)       # sol de las cinco de la tarde
SKY = (0.75, 0.82, 1.0)      # luz de cielo
FIRE = (1.0, 0.5, 0.18)
SKY_GLOW = (1.0, 0.72, 0.45)


def polar(a, r, z=0.0):
    return (math.cos(a) * r, math.sin(a) * r, z)


# =============================================================== Corazón de la Caña Fístula
def room_cana():
    reset()
    rng = random.Random(7)
    R, H = 3.0, 4.6
    carved = mat_ph('bark_brown_02', 'f0d2a6')
    planks = mat_ph('plank_flooring_02', 'a89c8c')
    wood = mat_ph('wood_table_001')
    door_m = mat_ph('brown_planks_09', 'c9a070')
    dark = mat_color('madera_oscura', (0.09, 0.05, 0.03), 0.7)
    cream = mat_color('loza', (0.85, 0.8, 0.68), 0.5)
    brass = mat_color('bronce', (0.7, 0.5, 0.2), 0.35, 0.9)

    A_DOOR = -math.pi / 2

    def rfn(a, z):
        # las ondulaciones de la corteza se apagan alrededor de la puerta para que no la tapen
        k = 1 - math.exp(-((adiff(a, A_DOOR) / 0.42) ** 4))
        base = R + k * (0.16 * math.sin(5 * a + 1) + 0.09 * math.sin(9 * a + 2 * z) + 0.05 * math.sin(17 * a - 3 * z))
        if z <= H:
            return base * (1 - 0.3 * (z / H) ** 2.5)
        k = min(1.0, (z - H) / 0.9)
        return base * 0.7 * (1 - k) + 0.6 * k

    WIN = [(0.55, 2.25), (2.65, 2.35)]

    def hole(a, z):
        # la puerta va por delante de la pared (sin hueco: el recorte en grilla dejaba un borde escalonado)
        return any(((adiff(a, wa) * R) ** 2 + (z - wz) ** 2) < 0.35 ** 2 for wa, wz in WIN)

    zs = [i * 0.16 for i in range(int(H / 0.16) + 1)] + [H + 0.3, H + 0.6, H + 0.9]
    objs = [shell('pared', rfn, zs, 96, carved, hole, uv=1.1, smooth=False)]
    objs.append(disc('piso', R + 0.4, (0, 0, 0), planks, 48, uv=1.3))
    objs.append(disc('alfombra', 1.55, (0.25, 0.55, 0.006), mat_color('alfombra', (0.22, 0.04, 0.035), 0.95), 36))

    # puerta de salida (arco)
    # el tronco se cierra hacia arriba: la puerta se alinea con la pared a la altura del arco
    rd = rfn(A_DOOR, 2.4)
    d = [box('p1', (1.24, 0.09, 1.75), (0, -rd + 0.1, 0.875), door_m, uv=0.9),
         # el arco va 2 cm detrás de la hoja: si quedan coplanares, el horneado las oscurece
         cyl('p2', 0.62, 0.62, 0.07, (0, -rd + 0.08, 1.75), door_m, 28, rot=(math.pi / 2, 0, 0), uv=0.9),
         sphere('p3', 0.05, (0.42, -rd + 0.18, 1.0), brass)]
    objs.append(join('I_puerta', d))
    objs.append(torus('marco', 0.68, 0.085, (0, -rd + 0.1, 1.75), dark, rot=(math.pi / 2, 0, 0), arc=math.pi))
    for s in (-1, 1):
        objs.append(box(f'jamba{s}', (0.15, 0.42, 1.8), (s * 0.69, -rd - 0.06, 0.9), dark))

    # ventanas de nudo + claraboya, con el resplandor del atardecer detrás
    for i, (wa, wz) in enumerate(WIN):
        rw = rfn(wa, wz)
        objs.append(torus(f'aro{i}', 0.44, 0.13, polar(wa, rw - 0.02, wz), dark, rot=(math.pi / 2, 0, wa + math.pi / 2)))
        backdrop(f'v{i}', disc(f'bd{i}', 0.62, polar(wa, rw + 0.3, wz), None, 20, rot=(math.pi / 2, 0, wa + math.pi / 2)), SKY_GLOW, 1.05)
        area(f'luzv{i}', polar(wa, rw + 0.2, wz), polar(wa, 0, wz - 0.6), (0.7, 0.7), SKY_GLOW, 32)
    backdrop('clara', disc('bdc', 0.75, (0, 0, H + 0.95), None, 20, down=True), (0.8, 0.86, 1.0), 1.3)
    area('luzclara', (0, 0, H + 0.9), (0.15, 0.3, 0), (1.0, 1.0), SKY, 120)
    wa, wz = WIN[0]
    sun('sol', (-math.cos(wa) * 0.8, -math.sin(wa) * 0.8, -0.62), WARM, 6.5)

    # mesa redonda con mantel
    tx, ty, top = 0.25, 0.55, 0.8
    objs.append(cyl('mesa', 0.9, 0.9, 0.07, (tx, ty, top - 0.035), wood, 36, uv=0.8))
    objs.append(lathe('pata', [(0.34, 0), (0.2, 0.08), (0.15, 0.4), (0.19, 0.7), (0.3, 0.765)], (tx, ty, 0), mat_ph('bark_brown_02'), 14, uv=0.7))
    objs.append(disc('mantel', 0.58, (tx, ty, top + 0.004), mat_ph('gingham_check'), 32, uv=0.5))

    def on(dx, dy, z=0.0):
        return (tx + dx, ty + dy, top + z)

    # empanadas
    gold = mat_color('empanada', (0.72, 0.42, 0.14), 0.75)
    e = [cyl('pl', 0.27, 0.22, 0.03, on(-0.4, -0.25, 0.019), cream, 28)]
    for i in range(8):
        a = i * TAU / 8
        e.append(sphere(f'e{i}', 1.0, on(-0.4 + math.cos(a) * 0.14, -0.25 + math.sin(a) * 0.14, 0.06), gold, scale=(0.095, 0.052, 0.03), rot=(0.25, 0, a + 1.2), segs=12, rings=8))
    e.append(sphere('e9', 1.0, on(-0.4, -0.25, 0.085), gold, scale=(0.095, 0.052, 0.03), rot=(0.1, 0, 0.4), segs=12, rings=8))
    objs.append(join('I_empanadas', e))
    # locro
    terra = mat_color('barro', (0.42, 0.17, 0.08), 0.8)
    lo = [lathe('olla', [(0.0, 0), (0.13, 0), (0.185, 0.06), (0.2, 0.15), (0.165, 0.215), (0.18, 0.235), (0.16, 0.235), (0.15, 0.2)], on(0.42, 0.22), terra, 22),
          disc('guiso', 0.15, on(0.42, 0.22, 0.195), mat_color('locro', (0.85, 0.5, 0.1), 0.6), 20),
          tube('cucharon', [on(0.46, 0.24, 0.19), on(0.62, 0.34, 0.42)], 0.012, wood, 6)]
    for i in range(9):
        lo.append(sphere(f'gr{i}', 0.014, on(0.42 + rng.uniform(-0.1, 0.1), 0.22 + rng.uniform(-0.1, 0.1), 0.2), mat_color('choclo', (0.95, 0.85, 0.35), 0.6), segs=6, rings=4))
    objs.append(join('I_locro', lo))
    # mate galleta con bombilla + pava
    S = 1.5
    silver = mat_color('alpaca', (0.75, 0.75, 0.78), 0.25, 1.0)
    mx, my = -0.05, 0.42
    m = [sphere('galleta', 0.075 * S, on(mx, my, 0.05 * S), mat_color('calabaza', (0.2, 0.1, 0.05), 0.55), scale=(1, 1, 0.66)),
         torus('virola', 0.043 * S, 0.008 * S, on(mx, my, 0.093 * S), silver, segs=18, tsegs=6),
         disc('yerba', 0.04 * S, on(mx, my, 0.094 * S), mat_color('yerba', (0.22, 0.32, 0.08), 0.95), 14),
         tube('bombilla', [on(mx - 0.012, my, 0.07 * S), on(mx + 0.05 * S, my + 0.02, 0.2 * S)], 0.006 * S, silver, 6),
         cyl('posamate', 0.1 * S, 0.1 * S, 0.012, on(mx, my, 0.006), wood, 16)]
    objs.append(join('I_mate', m))
    px, py = -0.42, 0.28
    enamel = mat_color('enlozado', (0.08, 0.2, 0.36), 0.35)
    objs.append(join('pava', [
        lathe('pv', [(0.0, 0), (0.1, 0), (0.125, 0.05), (0.115, 0.14), (0.07, 0.185), (0.05, 0.195), (0.0, 0.2)], on(px, py), enamel, 18),
        tube('pico', [on(px + 0.1, py, 0.08), on(px + 0.19, py, 0.15), on(px + 0.22, py, 0.185)], [0.02, 0.014, 0.011], enamel, 6),
        torus('asa', 0.085, 0.009, on(px, py, 0.2), dark, rot=(math.pi / 2, 0, 0), arc=math.pi, segs=12, tsegs=6),
        sphere('perilla', 0.018, on(px, py, 0.21), dark, segs=8, rings=6)]))
    # pan y vela
    objs.append(join('panera', [cyl('cesta', 0.15, 0.12, 0.07, on(0.45, -0.38, 0.035), mat_color('mimbre', (0.55, 0.38, 0.18), 0.9), 18)] +
                     [sphere(f'pan{i}', 1.0, on(0.45 + (i - 1) * 0.07, -0.38, 0.09), mat_color('pan', (0.75, 0.5, 0.22), 0.8), scale=(0.07, 0.045, 0.04), segs=10, rings=6) for i in range(3)]))
    objs.append(cyl('vela', 0.024, 0.024, 0.13, on(0.12, -0.08, 0.065), mat_color('cera', (0.92, 0.88, 0.75), 0.5), 10))
    vela = on(0.12, -0.08, 0.15)
    point('luzvela', (vela[0], vela[1], vela[2] + 0.06), FIRE, 14, 'fire')

    # banquitos (tocones)
    stools = []
    for a in (0.3, 2.3, 4.2):
        sx, sy = tx + math.cos(a) * 1.3, ty + math.sin(a) * 1.3
        stools.append((sx, sy))
        objs.append(cyl(f'tocon{a}', 0.25, 0.27, 0.46, (sx, sy, 0.23), mat_ph('bark_brown_02'), 14, uv=0.6))
    # páginas enmarcadas
    paper = mat_color('pergamino', (0.86, 0.78, 0.58), 0.9)
    for name, a in (('cuadro-raices', 1.55), ('cuadro-sombra', 3.55)):
        r = rfn(a, 1.65) * (1 - 0.3 * (1.65 / H) ** 2.5) if False else rfn(a, 1.65)
        fr = [box('fr', (0.58, 0.05, 0.74), polar(a, r - 0.1, 1.65), dark, rot=(0, 0, a - math.pi / 2)),
              box('pg', (0.46, 0.02, 0.62), polar(a, r - 0.135, 1.65), paper, rot=(0, 0, a - math.pi / 2))]
        for k in range(7):
            fr.append(box(f'ln{k}', (0.34 - 0.05 * (k % 3), 0.006, 0.014), polar(a, r - 0.148, 1.86 - k * 0.07), mat_color('tinta', (0.15, 0.1, 0.06), 0.9), rot=(0, 0, a - math.pi / 2)))
        objs.append(join(f'I_{name}', fr))
    # estante con frascos
    a = 4.05
    r = rfn(a, 1.3)
    objs.append(box('estante', (1.0, 0.24, 0.045), polar(a, r - 0.2, 1.3), wood, rot=(0, 0, a - math.pi / 2), uv=0.6))
    for i, col in enumerate([(0.6, 0.15, 0.1), (0.75, 0.55, 0.15), (0.3, 0.4, 0.15), (0.5, 0.3, 0.4)]):
        c = Vector(polar(a, r - 0.2, 1.3)) + Vector((-math.sin(a), math.cos(a), 0)) * (i - 1.5) * 0.22
        objs.append(cyl(f'frasco{i}', 0.06, 0.06, 0.17, (c.x, c.y, 1.41), mat_color(f'frasco{i}', col, 0.3), 12))
    # farol colgante
    fx, fy, fz = -1.0, -0.2, 2.45
    objs.append(tube('cadena', [(fx, fy, fz + 0.2), (fx, fy, 4.1)], 0.012, dark, 5))
    objs.append(join('farol', [box('f1', (0.2, 0.2, 0.03), (fx, fy, fz + 0.19), dark), box('f2', (0.2, 0.2, 0.03), (fx, fy, fz - 0.12), dark)] +
                     [box(f'fb{i}', (0.018, 0.018, 0.3), (fx + sx * 0.09, fy + sy * 0.09, fz + 0.035), dark) for i, (sx, sy) in enumerate([(-1, -1), (-1, 1), (1, -1), (1, 1)])]))
    point('luzfarol', (fx, fy, fz + 0.03), FIRE, 55, 'fire')

    meta = {
        'id': 'cana', 'floorY': 0, 'walk': {'type': 'circle', 'x': 0, 'z': 0, 'r': 2.62},
        'obstacles': [{'x': tx, 'z': -ty, 'r': 0.98}] + [{'x': round(x, 2), 'z': round(-y, 2), 'r': 0.3} for x, y in stools],
        'spawn': {'x': 0, 'z': 2.1, 'yaw': 0},
        'fires': [dict(zip('xyz', t3(*vela)), size=0.1), dict(zip('xyz', t3(fx, fy, fz - 0.08)), size=0.17)],
        'steam': [t3(*on(0.42, 0.22, 0.26)), t3(*on(px + 0.22, py, 0.2))],
    }
    bake_and_export('cana', objs, [], meta)


def place(ob, x, y, rz):
    """Mueve la malla (no el objeto) para que quede en coordenadas de mundo."""
    ob.data.transform(Matrix.Translation((x, y, 0)) @ Matrix.Rotation(rz, 4, 'Z'))
    ob.data.update()
    return ob


def wpt(x, y, rz, p):
    v = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(rz, 4, 'Z') @ Vector(p)
    return (v.x, v.y, v.z)


# =============================================================== Cocina de las Abuelas
def granny(name, hair_rgb, dress_rgb, shawl_rgb, food):
    """Abuela estilizada mirando hacia +Y, con un plato en las manos. Devuelve (abuela, plato)."""
    skin = mat_color('piel', (0.74, 0.47, 0.34), 0.75)
    hair = mat_color(f'pelo_{name}', hair_rgb, 0.6)
    dress = mat_color(f'vestido_{name}', dress_rgb, 0.9)
    shawl = mat_color(f'chal_{name}', shawl_rgb, 0.95)
    white = mat_color('delantal', (0.9, 0.88, 0.82), 0.9)
    darkm = mat_color('ojos', (0.03, 0.02, 0.02), 0.4)
    gold = mat_color('anteojos', (0.75, 0.55, 0.2), 0.3, 0.9)
    P = [lathe('falda', [(0.36, 0.02), (0.345, 0.25), (0.275, 0.6), (0.2, 0.88), (0.218, 1.02), (0.2, 1.15), (0.1, 1.24), (0.055, 1.28)], (0, 0, 0), dress, 20),
         lathe('delantal', [(0.372, 0.14), (0.352, 0.3), (0.286, 0.6), (0.21, 0.88)], (0, 0, 0), white, 12, a0=math.pi / 2 - 0.85, a1=math.pi / 2 + 0.85),
         lathe('chal', [(0.228, 0.99), (0.245, 1.1), (0.205, 1.2), (0.115, 1.265)], (0, 0, 0), shawl, 20),
         sphere('cabeza', 0.135, (0, 0, 1.4), skin, scale=(1, 0.96, 1.06)),
         sphere('pelo', 0.15, (0, -0.04, 1.435), hair, scale=(1.03, 1.0, 1.0)),
         sphere('rodete', 0.075, (0, -0.07, 1.585), hair),
         sphere('nariz', 0.02, (0, 0.132, 1.385), skin, segs=8, rings=6),
         torus('sonrisa', 0.034, 0.006, (0, 0.124, 1.365), mat_color('boca', (0.45, 0.08, 0.08), 0.6), rot=(-math.pi / 2, 0, 0), arc=math.pi, segs=10, tsegs=5)]
    for s in (-1, 1):
        P += [sphere(f'ojo{s}', 0.014, (s * 0.046, 0.123, 1.42), darkm, segs=8, rings=6),
              torus(f'lente{s}', 0.031, 0.0045, (s * 0.047, 0.132, 1.42), gold, rot=(math.pi / 2, 0, 0), segs=14, tsegs=5),
              sphere(f'cachete{s}', 0.026, (s * 0.078, 0.1, 1.372), mat_color('rubor', (0.85, 0.4, 0.38), 0.8), scale=(1, 0.5, 0.8), segs=8, rings=6),
              sphere(f'bucle{s}', 0.05, (s * 0.115, -0.01, 1.43), hair, segs=10, rings=8),
              tube(f'brazo{s}', [(s * 0.2, 0.02, 1.14), (s * 0.275, 0.16, 0.98), (s * 0.14, 0.36, 1.0)], 0.046, dress, 8),
              sphere(f'mano{s}', 0.046, (s * 0.13, 0.385, 1.005), skin, segs=10, rings=8),
              sphere(f'pie{s}', 1.0, (s * 0.1, 0.14, 0.04), mat_color('pantufla', (0.35, 0.12, 0.3), 0.95), scale=(0.07, 0.115, 0.04), segs=10, rings=6)]
    P.append(tube('puente', [(-0.016, 0.135, 1.42), (0.016, 0.135, 1.42)], 0.004, gold, 5))
    body = join(f'I_abuela-{name}', P)
    c = (0, 0.46, 1.02)
    plate = [cyl('plato', 0.175, 0.13, 0.028, c, mat_color('loza', (0.85, 0.8, 0.68), 0.5), 26)] + food(c)
    return body, plate


def food_fideos(c):
    rng = random.Random(3)
    pasta = mat_color('fideos', (0.93, 0.8, 0.45), 0.6)
    out = []
    for i in range(12):
        out.append(torus(f'fd{i}', rng.uniform(0.045, 0.085), 0.0075, (c[0] + rng.uniform(-0.04, 0.04), c[1] + rng.uniform(-0.04, 0.04), c[2] + 0.03 + i * 0.004),
                         pasta, rot=(rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(0, TAU)), segs=14, tsegs=5))
    out.append(sphere('tuco', 0.075, (c[0], c[1], c[2] + 0.072), mat_color('tuco', (0.55, 0.06, 0.03), 0.5), scale=(1, 1, 0.38), segs=12, rings=8))
    for i, (dx, dy) in enumerate([(0.03, 0.02), (-0.035, 0.0), (0.0, -0.04)]):
        out.append(box(f'carne{i}', (0.045, 0.04, 0.03), (c[0] + dx, c[1] + dy, c[2] + 0.1), mat_color('estofado', (0.24, 0.1, 0.05), 0.8), rot=(0.3 * i, 0.2, i)))
    out.append(sphere('albahaca', 1.0, (c[0] + 0.01, c[1] + 0.03, c[2] + 0.118), mat_color('albahaca', (0.12, 0.4, 0.1), 0.7), scale=(0.035, 0.022, 0.006), segs=8, rings=6))
    return out


def food_tortilla(c):
    return [cyl('tortilla', 0.135, 0.14, 0.055, (c[0], c[1], c[2] + 0.042), mat_color('tortilla', (0.88, 0.62, 0.16), 0.75), 26),
            disc('dorado', 0.118, (c[0], c[1], c[2] + 0.0705), mat_color('dorado', (0.62, 0.34, 0.08), 0.8), 22),
            sphere('perejil', 1.0, (c[0] + 0.03, c[1] - 0.02, c[2] + 0.075), mat_color('albahaca', (0.12, 0.4, 0.1), 0.7), scale=(0.03, 0.02, 0.006), segs=8, rings=6)]


def room_abuelas():
    reset()
    rng = random.Random(5)
    X, Y, H = 3.0, 2.5, 2.7
    plaster = mat_ph('plastered_wall_04', 'f6e3bf')
    planks = mat_ph('plank_flooring_02', 'a89c8c')
    wood = mat_ph('wood_table_001')
    dark = mat_color('madera_oscura', (0.09, 0.05, 0.03), 0.7)
    iron = mat_color('hierro', (0.025, 0.025, 0.03), 0.45, 0.7)
    cream = mat_color('loza', (0.85, 0.8, 0.68), 0.5)
    objs = []
    # paredes (hacia adentro), piso y techo con vigas
    objs.append(wall('pared_s', (X, -Y, 0), (-2 * X, 0, 0), (0, 0, H), 60, 27, plaster, lambda s, t: 3.5 < s < 4.5 and t < 2.05, uv=1.6))
    objs.append(wall('pared_n', (-X, Y, 0), (2 * X, 0, 0), (0, 0, H), 60, 27, plaster, lambda s, t: 3.05 < s < 4.35 and 1.0 < t < 2.05, uv=1.6))
    objs.append(wall('pared_o', (-X, -Y, 0), (0, 2 * Y, 0), (0, 0, H), 50, 27, plaster, None, uv=1.6))
    objs.append(wall('pared_e', (X, Y, 0), (0, -2 * Y, 0), (0, 0, H), 50, 27, plaster, lambda s, t: 2.65 < s < 3.55 and 1.15 < t < 1.95, uv=1.6))
    objs.append(wall('piso', (-X, -Y, 0), (2 * X, 0, 0), (0, 2 * Y, 0), 12, 10, planks, uv=1.4))
    objs.append(wall('techo', (-X, Y, H), (2 * X, 0, 0), (0, -2 * Y, 0), 12, 10, mat_ph('plastered_wall_04', 'e8d6b4'), uv=1.6))
    for i, x in enumerate((-2.1, -0.7, 0.7, 2.1)):
        objs.append(box(f'viga{i}', (0.17, 2 * Y, 0.19), (x, 0, H - 0.095), dark))
    # puerta de salida
    objs.append(join('I_puerta', [box('p1', (1.0, 0.07, 2.05), (-1.0, -Y + 0.02, 1.025), mat_ph('brown_planks_09', '8fb0a0'), uv=0.9),
                                  sphere('p2', 0.045, (-0.62, -Y + 0.09, 1.0), mat_color('bronce', (0.7, 0.5, 0.2), 0.35, 0.9))]))
    for s in (-1, 1):
        objs.append(box(f'jamba{s}', (0.1, 0.16, 2.1), (-1.0 + s * 0.55, -Y + 0.04, 1.05), dark))
    objs.append(box('dintel', (1.3, 0.16, 0.12), (-1.0, -Y + 0.04, 2.11), dark))

    # ventanas con marco, cruceta y el atardecer detrás
    def window(name, cx, cy, cz, w, h, axis):
        t = 0.07
        if axis == 'y':  # pared norte
            sz = lambda a, b: (a, 0.12, b); off = lambda dx, dz: (cx + dx, cy, cz + dz)
        else:
            sz = lambda a, b: (0.12, a, b); off = lambda dx, dz: (cx, cy + dx, cz + dz)
        parts = [box('m1', sz(w + 2 * t, t), off(0, h / 2 + t / 2), dark), box('m2', sz(w + 0.3, 0.06), off(0, -h / 2 - 0.03), dark),
                 box('m3', sz(t, h), off(-w / 2 - t / 2, 0), dark), box('m4', sz(t, h), off(w / 2 + t / 2, 0), dark),
                 box('m5', sz(0.035, h), off(0, 0), dark), box('m6', sz(w, 0.035), off(0, 0), dark)]
        objs.append(join(f'ventana_{name}', parts))
    window('n', 0.7, Y - 0.02, 1.525, 1.3, 1.05, 'y')
    window('e', X - 0.02, -0.6, 1.55, 0.9, 0.8, 'x')
    backdrop('n', box('bdn', (1.9, 0.02, 1.6), (0.7, Y + 0.35, 1.55), None), SKY_GLOW, 1.05)
    backdrop('e', box('bde', (0.02, 1.5, 1.4), (X + 0.35, -0.6, 1.55), None), (0.7, 0.75, 0.95), 0.9)
    area('luzn', (0.7, Y + 0.15, 1.55), (0.5, 0, 0.6), (1.3, 1.05), SKY_GLOW, 90)
    area('luze', (X + 0.15, -0.6, 1.55), (0, -0.4, 0.8), (0.9, 0.8), SKY, 30)
    sun('sol', (-0.22, -0.78, -0.5), WARM, 5.0)

    # cocina a leña con olla de tuco
    sx, sy = -2.0, Y - 0.38
    stove = [box('cuerpo', (1.0, 0.66, 0.8), (sx, sy, 0.4), iron), box('plancha', (1.08, 0.72, 0.05), (sx, sy, 0.825), mat_color('plancha', (0.07, 0.07, 0.075), 0.35, 0.8)),
             box('boca', (0.36, 0.03, 0.26), (sx - 0.22, sy - 0.335, 0.4), mat_color('hollin', (0.012, 0.01, 0.008), 1.0)),
             box('puertita', (0.3, 0.03, 0.22), (sx + 0.24, sy - 0.335, 0.45), mat_color('plancha', (0.07, 0.07, 0.075), 0.35, 0.8)),
             cyl('caño', 0.08, 0.08, H - 0.85, (sx + 0.32, sy + 0.12, 0.85 + (H - 0.85) / 2), iron, 12)]
    for i in range(4):
        stove.append(cyl(f'pata{i}', 0.03, 0.03, 0.04, (sx + (0.42 if i % 2 else -0.42), sy + (0.26 if i < 2 else -0.26), 0.0), iron, 8))
    objs.append(join('cocina', stove))
    objs.append(box('brasas', (0.3, 0.02, 0.07), (sx - 0.22, sy - 0.325, 0.32), mat_color('brasas', (0, 0, 0), emit=(1.0, 0.32, 0.05), strength=4.0)))
    point('luzcocina', (sx - 0.22, sy - 0.62, 0.42), FIRE, 130, 'fire')
    pot = (sx - 0.2, sy + 0.02, 0.85)
    objs.append(join('olla_tuco', [lathe('o', [(0.0, 0), (0.16, 0), (0.19, 0.05), (0.19, 0.2), (0.2, 0.21), (0.18, 0.21), (0.175, 0.17)], pot, mat_color('aluminio', (0.6, 0.6, 0.62), 0.35, 0.9), 22),
                                   disc('salsa', 0.172, (pot[0], pot[1], pot[2] + 0.17), mat_color('tuco', (0.55, 0.06, 0.03), 0.5), 20),
                                   tube('cuchara', [(pot[0] + 0.05, pot[1], pot[2] + 0.17), (pot[0] + 0.2, pot[1] - 0.08, pot[2] + 0.4)], 0.011, wood, 6)]))
    objs.append(join('sarten', [cyl('s1', 0.15, 0.13, 0.045, (sx + 0.22, sy - 0.08, 0.872), iron, 20), box('s2', (0.24, 0.03, 0.02), (sx + 0.46, sy - 0.2, 0.885), iron, rot=(0, 0, -0.5))]))

    # mesa con mantel a cuadros
    tx, ty, top = 1.45, 0.25, 0.76
    objs.append(box('mantel', (1.6, 1.0, 0.24), (tx, ty, top - 0.105), mat_ph('gingham_check', 'ffd9d0'), uv=0.45))
    for i in range(4):
        objs.append(box(f'pm{i}', (0.07, 0.07, 0.66), (tx + (0.68 if i % 2 else -0.68), ty + (0.38 if i < 2 else -0.38), 0.33), wood))
    T = lambda dx, dy, z=0.0: (tx + dx, ty + dy, top + 0.016 + z)
    objs.append(join('panera', [cyl('cesta', 0.16, 0.13, 0.07, T(-0.4, 0.15, 0.035), mat_color('mimbre', (0.55, 0.38, 0.18), 0.9), 18)] +
                     [sphere(f'pan{i}', 1.0, T(-0.4 + (i - 1) * 0.075, 0.15, 0.09), mat_color('pan', (0.75, 0.5, 0.22), 0.8), scale=(0.07, 0.048, 0.042), segs=10, rings=6) for i in range(3)]))
    # pingüino de vino
    pg = T(0.1, 0.2)
    objs.append(join('pinguino', [lathe('pg', [(0.0, 0), (0.06, 0), (0.078, 0.08), (0.066, 0.18), (0.038, 0.235), (0.045, 0.275), (0.03, 0.3), (0.0, 0.305)], pg, mat_color('porcelana', (0.92, 0.92, 0.9), 0.3), 16),
                                  cyl('pico', 0.014, 0.0, 0.06, (pg[0], pg[1] - 0.055, pg[2] + 0.265), mat_color('pico', (0.9, 0.5, 0.08), 0.5), 8, rot=(math.pi / 2, 0, 0)),
                                  sphere('ala1', 1.0, (pg[0] - 0.072, pg[1], pg[2] + 0.12), mat_color('negro', (0.02, 0.02, 0.025), 0.4), scale=(0.012, 0.035, 0.07), segs=8, rings=6),
                                  sphere('ala2', 1.0, (pg[0] + 0.072, pg[1], pg[2] + 0.12), mat_color('negro', (0.02, 0.02, 0.025), 0.4), scale=(0.012, 0.035, 0.07), segs=8, rings=6)]))
    for i, (dx, dy) in enumerate([(0.38, -0.05), (0.5, 0.22)]):
        objs.append(cyl(f'vaso{i}', 0.034, 0.028, 0.1, T(dx, dy, 0.05), mat_color('vidrio', (0.6, 0.72, 0.75), 0.15), 12))
    objs.append(join('florero', [lathe('fl', [(0.0, 0), (0.045, 0), (0.06, 0.06), (0.035, 0.14), (0.045, 0.17)], T(-0.05, -0.2), mat_color('ceramica_azul', (0.12, 0.25, 0.5), 0.3), 14)] +
                     [sphere(f'flor{i}', 0.03, T(-0.05 + math.cos(i * 1.3) * 0.05, -0.2 + math.sin(i * 1.3) * 0.05, 0.25 + 0.03 * (i % 2)), mat_color(f'flor{i % 3}', [(0.9, 0.2, 0.3), (0.95, 0.75, 0.15), (0.85, 0.4, 0.75)][i % 3], 0.7), segs=8, rings=6) for i in range(6)] +
                     [tube(f'tallo{i}', [T(-0.05, -0.2, 0.15), T(-0.05 + math.cos(i * 1.3) * 0.05, -0.2 + math.sin(i * 1.3) * 0.05, 0.25 + 0.03 * (i % 2))], 0.004, mat_color('albahaca', (0.12, 0.4, 0.1), 0.7), 5) for i in range(6)]))
    # lámpara colgante sobre la mesa (luz fija)
    objs.append(tube('cable', [(tx, ty, H), (tx, ty, 2.02)], 0.008, dark, 5))
    objs.append(cyl('pantalla', 0.24, 0.07, 0.17, (tx, ty, 1.95), mat_color('enlozado_rojo', (0.5, 0.06, 0.05), 0.35), 20, caps=False))
    objs.append(sphere('foco', 0.04, (tx, ty, 1.9), mat_color('foco', (0, 0, 0), emit=(1.0, 0.82, 0.55), strength=5.0), segs=10, rings=8))
    point('luzmesa', (tx, ty, 1.84), (1.0, 0.8, 0.52), 55, 'A', radius=0.05)

    # mesada con recetario
    cx, cy = -X + 0.32, -0.5
    objs.append(box('mesada', (0.6, 1.5, 0.84), (cx, cy, 0.42), mat_ph('brown_planks_09', 'b08a60'), uv=0.8))
    objs.append(box('tapa', (0.66, 1.56, 0.045), (cx, cy, 0.862), wood, uv=0.7))
    bz = 0.885
    book = [box('tapa_r', (0.34, 0.46, 0.018), (cx + 0.02, cy - 0.15, bz + 0.009), mat_color('tapa_roja', (0.5, 0.07, 0.06), 0.7), rot=(0, 0, 0.12)),
            box('hoja1', (0.15, 0.42, 0.022), (cx - 0.06, cy - 0.15, bz + 0.03), mat_color('pergamino', (0.86, 0.78, 0.58), 0.9), rot=(0, 0.1, 0.12)),
            box('hoja2', (0.15, 0.42, 0.022), (cx + 0.1, cy - 0.15, bz + 0.03), mat_color('pergamino', (0.86, 0.78, 0.58), 0.9), rot=(0, -0.1, 0.12))]
    for k in range(8):
        book.append(box(f'rl{k}', (0.1, 0.006, 0.004), (cx - 0.06 + 0.16 * (k % 2), cy - 0.3 + 0.08 * (k // 2), bz + 0.046), mat_color('tinta', (0.15, 0.1, 0.06), 0.9), rot=(0, 0, 0.12)))
    objs.append(join('I_recetario', book))
    objs.append(cyl('palote', 0.03, 0.03, 0.42, (cx, cy + 0.42, bz + 0.03), wood, 10, rot=(math.pi / 2, 0, 0.3)))
    for i, col in enumerate([(0.6, 0.15, 0.1), (0.75, 0.55, 0.15), (0.3, 0.4, 0.15)]):
        objs.append(cyl(f'frasco{i}', 0.065, 0.065, 0.19, (cx - 0.12, cy + 0.15 + i * 0.17 - 0.75, bz + 0.095), mat_color(f'frasco{i}', col, 0.3), 12))
    # estantes con platos y frascos
    for j, z in enumerate((1.35, 1.8)):
        objs.append(box(f'estante{j}', (0.24, 1.7, 0.04), (X - 0.13, 1.2, z), wood, uv=0.6))
        for i in range(5):
            y = 0.5 + i * 0.34
            if (i + j) % 2:
                objs.append(cyl(f'pl{j}{i}', 0.13, 0.13, 0.016, (X - 0.07, y, z + 0.15), cream, 20, rot=(0, math.pi / 2 - 0.15, 0)))
            else:
                objs.append(cyl(f'fr{j}{i}', 0.055, 0.055, 0.16, (X - 0.14, y, z + 0.1), mat_color(f'frasco{(i + j) % 3}', [(0.6, 0.15, 0.1), (0.75, 0.55, 0.15), (0.3, 0.4, 0.15)][(i + j) % 3], 0.3), 12))
    # reloj de pared
    objs.append(join('reloj', [cyl('r1', 0.17, 0.17, 0.03, (1.3, -Y + 0.03, 1.95), dark, 24, rot=(math.pi / 2, 0, 0)), cyl('r2', 0.145, 0.145, 0.034, (1.3, -Y + 0.032, 1.95), cream, 24, rot=(math.pi / 2, 0, 0)),
                               box('r3', (0.012, 0.012, 0.1), (1.3, -Y + 0.052, 1.99), iron), box('r4', (0.07, 0.012, 0.012), (1.33, -Y + 0.052, 1.95), iron)]))

    # las dos abuelas, ofreciendo sus platos hacia la puerta
    spawn = (-1.0, -1.75)
    grannies = [('roja', (0.72, 0.1, 0.04), (0.16, 0.3, 0.42), (0.55, 0.36, 0.5), food_fideos, 'fideos', (-0.8, 0.5)),
                ('blanca', (0.93, 0.93, 0.9), (0.45, 0.16, 0.2), (0.3, 0.42, 0.35), food_tortilla, 'tortilla', (0.2, 0.85))]
    hearts, circles = [], []
    for name, hair, dress, shawl, food, plate_id, (gx, gy) in grannies:
        rz = math.atan2(spawn[1] - gy, spawn[0] - gx) - math.pi / 2
        body, plate = granny(name, hair, dress, shawl, food)
        objs.append(place(body, gx, gy, rz))
        objs.append(place(join(f'I_{plate_id}', plate), gx, gy, rz))
        hearts.append(t3(gx, gy, 1.72))
        circles.append({'x': round(gx, 2), 'z': round(-gy, 2), 'r': 0.4})
        pc = wpt(gx, gy, rz, (0, 0.46, 0))
        circles.append({'x': round(pc[0], 2), 'z': round(-pc[1], 2), 'r': 0.2})

    meta = {
        'id': 'abuelas', 'floorY': 0, 'walk': {'type': 'rect', 'minX': -X + 0.04, 'maxX': X - 0.04, 'minZ': -Y + 0.04, 'maxZ': Y - 0.04},
        'obstacles': circles + [
            {'minX': tx - 0.8, 'maxX': tx + 0.8, 'minZ': -(ty + 0.5), 'maxZ': -(ty - 0.5)},
            {'minX': sx - 0.54, 'maxX': sx + 0.54, 'minZ': -Y, 'maxZ': -(sy - 0.36)},
            {'minX': -X, 'maxX': cx + 0.33, 'minZ': -(cy + 0.78), 'maxZ': -(cy - 0.78)},
            {'minX': X - 0.26, 'maxX': X, 'minZ': -2.1, 'maxZ': -0.3}],
        'spawn': {'x': spawn[0], 'z': -spawn[1], 'yaw': 0},
        'fires': [dict(zip('xyz', t3(sx - 0.22, sy - 0.36, 0.29)), size=0.3)],
        'hearts': hearts, 'steam': [t3(pot[0], pot[1], pot[2] + 0.24)],
    }
    bake_and_export('abuelas', objs, [], meta)


# =============================================================== Casita de Gnomos (vestíbulo)
def room_gnomos():
    reset()
    rng = random.Random(9)
    R, H = 2.3, 2.3
    stone = mat_ph('old_stone_wall', 'e6d8c4')
    cobble = mat_ph('cobblestone_floor_04', 'd8c8b0')
    planks = mat_ph('brown_planks_09', 'b08a60')
    wood = mat_ph('wood_table_001')
    dark = mat_color('madera_oscura', (0.09, 0.05, 0.03), 0.7)
    iron = mat_color('hierro', (0.025, 0.025, 0.03), 0.45, 0.7)
    brass = mat_color('bronce', (0.7, 0.5, 0.2), 0.35, 0.9)
    red = mat_color('gorro_rojo', (0.6, 0.06, 0.04), 0.8)
    white = mat_color('pinta', (0.92, 0.9, 0.84), 0.8)
    rfn = lambda a, z: R + 0.045 * math.sin(7 * a + z) + 0.03 * math.sin(13 * a - 2 * z)
    A_DOOR, DZ, DR = -math.pi / 2, 0.76, 0.7
    WIN = [(0.62, 1.35), (2.52, 1.35)]

    def hole(a, z):
        if (adiff(a, A_DOOR) * R) ** 2 + (z - DZ) ** 2 < DR ** 2:
            return True
        return any(((adiff(a, wa) * R) ** 2 + (z - wz) ** 2) < 0.29 ** 2 for wa, wz in WIN)

    objs = [shell('pared', rfn, [i * 0.1 for i in range(int(H / 0.1) + 1)], 120, stone, hole, uv=1.3)]
    objs.append(disc('piso', R + 0.3, (0, 0, 0), cobble, 48, uv=1.2))
    objs.append(disc('techo', R + 0.3, (0, 0, H), planks, 48, uv=1.0, down=True))
    for i in range(6):
        a = i * math.pi / 6
        objs.append(box(f'viga{i}', (2 * R + 0.2, 0.13, 0.14), (0, 0, H - 0.07), dark, rot=(0, 0, a)))
    objs.append(disc('alfombra', 0.95, (-0.1, -0.5, 0.006), mat_color('alfombra_verde', (0.12, 0.3, 0.14), 0.95), 32))
    # puerta redonda
    rd = rfn(A_DOOR, DZ)
    objs.append(join('I_puerta', [cyl('p1', DR + 0.02, DR + 0.02, 0.08, (0, -rd + 0.05, DZ), mat_color('puerta_verde', (0.16, 0.36, 0.14), 0.7), 32, rot=(math.pi / 2, 0, 0)),
                                  sphere('p2', 0.055, (0, -rd + 0.12, DZ), brass),
                                  box('p3', (1.3, 0.02, 0.06), (0, -rd + 0.1, DZ + 0.3), iron), box('p4', (1.3, 0.02, 0.06), (0, -rd + 0.1, DZ - 0.3), iron)]))
    objs.append(torus('marco', DR + 0.04, 0.075, (0, -rd + 0.06, DZ), dark, rot=(math.pi / 2, 0, 0), segs=32))
    for i, (wa, wz) in enumerate(WIN):
        rw = rfn(wa, wz)
        objs.append(torus(f'aro{i}', 0.3, 0.07, polar(wa, rw - 0.02, wz), dark, rot=(math.pi / 2, 0, wa + math.pi / 2)))
        objs.append(box(f'cruz{i}a', (0.58, 0.03, 0.03), polar(wa, rw - 0.02, wz), dark, rot=(0, 0, wa + math.pi / 2)))
        objs.append(box(f'cruz{i}b', (0.03, 0.03, 0.58), polar(wa, rw - 0.02, wz), dark, rot=(0, 0, wa + math.pi / 2)))
        backdrop(f'v{i}', disc(f'bd{i}', 0.5, polar(wa, rw + 0.3, wz), None, 18, rot=(math.pi / 2, 0, wa + math.pi / 2)), SKY_GLOW, 1.05)
        area(f'luzv{i}', polar(wa, rw + 0.18, wz), polar(wa, 0, wz - 0.5), (0.5, 0.5), SKY_GLOW, 26)
    sun('sol', (-math.cos(WIN[0][0]) * 0.8, -math.sin(WIN[0][0]) * 0.8, -0.55), WARM, 4.0)

    # hogar de piedra
    hy = R - 0.3
    objs.append(join('hogar', [box('h1', (0.32, 0.56, 1.05), (-0.52, hy, 0.525), stone, uv=0.9), box('h2', (0.32, 0.56, 1.05), (0.52, hy, 0.525), stone, uv=0.9),
                               box('h3', (1.36, 0.56, 0.3), (0, hy, 1.2), stone, uv=0.9), box('h4', (0.9, 0.42, H - 1.35), (0, hy + 0.06, 1.35 + (H - 1.35) / 2), stone, uv=0.9),
                               box('h5', (0.74, 0.06, 1.05), (0, hy + 0.24, 0.525), mat_color('hollin', (0.012, 0.01, 0.008), 1.0)),
                               box('h6', (0.74, 0.5, 0.05), (0, hy, 0.025), mat_color('hollin', (0.012, 0.01, 0.008), 1.0)),
                               box('repisa', (1.5, 0.66, 0.06), (0, hy - 0.03, 1.38), wood, uv=0.6)]))
    for i in range(3):
        objs.append(cyl(f'leño{i}', 0.055, 0.06, 0.55, (-0.12 + i * 0.12, hy - 0.05, 0.1 + 0.05 * (i % 2)), mat_ph('bark_brown_02'), 8, rot=(0, math.pi / 2, 0.5 * (i - 1)), uv=0.4))
    point('luzhogar', (0, hy - 0.5, 0.45), FIRE, 170, 'fire')
    # sobre la repisa: tres gorros puntiagudos
    for i, col in enumerate([(0.6, 0.06, 0.04), (0.08, 0.2, 0.5), (0.1, 0.4, 0.12)]):
        objs.append(cyl(f'gorro{i}', 0.085, 0.0, 0.3, (-0.45 + i * 0.45, hy - 0.05, 1.56), mat_color(f'gorro{i}', col, 0.85), 14))

    # mesita con el pergamino
    tx, ty, top = 0.55, -0.25, 0.5
    objs.append(cyl('mesa', 0.5, 0.5, 0.05, (tx, ty, top - 0.025), wood, 28, uv=0.6))
    objs.append(cyl('pata', 0.09, 0.14, top - 0.05, (tx, ty, (top - 0.05) / 2), mat_ph('bark_brown_02'), 12, uv=0.5))
    paper = mat_color('pergamino', (0.86, 0.78, 0.58), 0.9)
    sc = [box('hoja', (0.4, 0.27, 0.006), (tx - 0.05, ty + 0.02, top + 0.004), paper, rot=(0, 0, 0.3))]
    for s in (-1, 1):
        c = Vector((tx - 0.05, ty + 0.02, top + 0.022)) + Vector((math.cos(0.3), math.sin(0.3), 0)) * s * 0.2
        sc.append(cyl(f'rollo{s}', 0.021, 0.021, 0.29, (c.x, c.y, c.z), paper, 10, rot=(math.pi / 2, 0, 0.3)))
    for k in range(5):
        c = Vector((tx - 0.05, ty + 0.02, top + 0.009)) + Vector((-math.sin(0.3), math.cos(0.3), 0)) * (k - 2) * 0.045
        sc.append(box(f'ln{k}', (0.28, 0.008, 0.003), (c.x, c.y, c.z), mat_color('tinta', (0.15, 0.1, 0.06), 0.9), rot=(0, 0, 0.3)))
    sc.append(sphere('lacre', 0.028, (tx + 0.1, ty - 0.08, top + 0.012), mat_color('lacre', (0.35, 0.02, 0.03), 0.4), scale=(1, 1, 0.35), segs=10, rings=6))
    objs.append(join('I_pergamino', sc))
    objs.append(cyl('vela', 0.02, 0.02, 0.1, (tx + 0.22, ty + 0.22, top + 0.05), mat_color('cera', (0.92, 0.88, 0.75), 0.5), 10))
    vela = (tx + 0.22, ty + 0.22, top + 0.115)
    point('luzvela', (vela[0], vela[1], vela[2] + 0.05), FIRE, 12, 'fire')
    objs.append(join('tintero', [cyl('t1', 0.03, 0.035, 0.05, (tx + 0.25, ty - 0.2, top + 0.025), mat_color('negro', (0.02, 0.02, 0.025), 0.4), 10),
                                 tube('pluma', [(tx + 0.25, ty - 0.2, top + 0.04), (tx + 0.33, ty - 0.27, top + 0.26)], [0.004, 0.012], white, 5)]))
    # banquitos-hongo
    stools = []
    for i, a in enumerate((2.4, 4.9)):
        sx, sy = tx + math.cos(a) * 0.82, ty + math.sin(a) * 0.82
        stools.append((sx, sy))
        cap = [cyl('pie', 0.07, 0.09, 0.26, (sx, sy, 0.13), white, 10), sphere('cap', 0.19, (sx, sy, 0.26), red, scale=(1, 1, 0.55))]
        for k in range(6):
            b = k * TAU / 6 + i
            cap.append(sphere(f'pt{k}', 0.025, (sx + math.cos(b) * 0.11, sy + math.sin(b) * 0.11, 0.335), white, scale=(1, 1, 0.5), segs=8, rings=6))
        objs.append(join(f'hongo{i}', cap))

    # biblioteca
    bx = R - 0.24
    lib_parts = [box('lat1', (0.3, 0.04, 1.4), (bx, -0.2, 0.7), wood), box('lat2', (0.3, 0.04, 1.4), (bx, 0.9, 0.7), wood), box('fondo', (0.03, 1.1, 1.4), (bx + 0.14, 0.35, 0.7), dark)]
    for z in (0.04, 0.48, 0.92, 1.38):
        lib_parts.append(box(f'est{z}', (0.3, 1.1, 0.04), (bx, 0.35, z), wood))
    objs.append(join('biblioteca', lib_parts))
    cols = [(0.5, 0.08, 0.06), (0.1, 0.25, 0.45), (0.12, 0.35, 0.14), (0.55, 0.4, 0.1), (0.3, 0.12, 0.35), (0.35, 0.2, 0.1)]
    books = []
    for z in (0.06, 0.5, 0.94):
        y = -0.15
        while y < 0.82:
            w, h = rng.uniform(0.04, 0.075), rng.uniform(0.22, 0.34)
            ci = rng.randrange(len(cols))
            books.append(box(f'lb{len(books)}', (0.19, w, h), (bx - 0.02, y + w / 2, z + h / 2), mat_color(f'lomo{ci}', cols[ci], 0.7), rot=(rng.uniform(-0.06, 0.06), 0, 0)))
            y += w + 0.006
    objs.append(join('libros', books))

    def big_book(name, loc, rgb, rot):
        return join(name, [box('c', (0.3, 0.4, 0.07), loc, mat_color(f'{name}_tapa', rgb, 0.6), rot=rot),
                           box('h', (0.27, 0.37, 0.05), (loc[0], loc[1], loc[2] + 0.004), mat_color('pergamino', (0.86, 0.78, 0.58), 0.9), rot=rot),
                           box('t', (0.3, 0.4, 0.012), (loc[0] + 0.0 * rot[1], loc[1], loc[2] + 0.036), mat_color(f'{name}_tapa', rgb, 0.6), rot=rot),
                           sphere('b', 0.03, (loc[0], loc[1], loc[2] + 0.048), brass, scale=(1, 1, 0.4), segs=10, rings=6)])
    # atril con el Libro de los caminos
    lx, ly = 1.25, -1.15
    objs.append(join('atril', [cyl('a1', 0.035, 0.05, 0.95, (lx, ly, 0.475), dark, 10), cyl('a2', 0.2, 0.22, 0.04, (lx, ly, 0.02), dark, 14),
                               box('a3', (0.42, 0.5, 0.03), (lx, ly, 0.98), wood, rot=(0.0, 0.45, 2.3))]))
    objs.append(big_book('I_libro-caminos', (lx, ly, 1.03), (0.1, 0.34, 0.14), (0.0, 0.45, 2.3)))
    # barril con el Libro de las cerraduras
    bxx, byy = -1.5, -0.8
    objs.append(lathe('barril', [(0.0, 0), (0.24, 0), (0.3, 0.2), (0.31, 0.35), (0.3, 0.5), (0.24, 0.7), (0.0, 0.7)], (bxx, byy, 0), planks, 18, uv=0.6, cyl_uv=True))
    for z in (0.14, 0.56):
        objs.append(torus(f'zuncho{z}', 0.285 if z < 0.3 else 0.275, 0.014, (bxx, byy, z), iron, segs=22, tsegs=5))
    objs.append(big_book('I_libro-cerraduras', (bxx, byy, 0.74), (0.5, 0.06, 0.05), (0, 0, 0.5)))
    # trampilla de la mazmorra
    hx, hy2 = -0.8, 0.75
    tr = [box('t0', (1.02, 1.02, 0.05), (hx, hy2, 0.025), dark), box('t1', (0.9, 0.9, 0.05), (hx, hy2, 0.045), mat_ph('brown_planks_09', '6a4a30'), uv=0.7)]
    for s in (-0.26, 0.26):
        tr.append(box(f'fl{s}', (0.92, 0.07, 0.012), (hx, hy2 + s, 0.076), iron))
    tr.append(torus('argolla', 0.075, 0.013, (hx + 0.25, hy2, 0.085), iron, segs=16, tsegs=6))
    tr.append(box('candado', (0.09, 0.03, 0.08), (hx - 0.42, hy2, 0.1), brass))
    tr.append(torus('arco', 0.032, 0.008, (hx - 0.42, hy2, 0.14), iron, rot=(math.pi / 2, 0, 0), arc=math.pi, segs=10, tsegs=5))
    objs.append(join('I_trampilla', tr))
    # farol colgante y honguitos luminosos
    fz = 1.72
    objs.append(tube('cadena', [(0, -0.1, H), (0, -0.1, fz + 0.2)], 0.01, iron, 5))
    objs.append(join('farol', [box('f1', (0.18, 0.18, 0.025), (0, -0.1, fz + 0.18), iron), box('f2', (0.18, 0.18, 0.025), (0, -0.1, fz - 0.1), iron)] +
                     [box(f'fb{i}', (0.016, 0.016, 0.27), (sx * 0.08, -0.1 + sy * 0.08, fz + 0.04), iron) for i, (sx, sy) in enumerate([(-1, -1), (-1, 1), (1, -1), (1, 1)])]))
    point('luzfarol', (0, -0.1, fz + 0.04), FIRE, 40, 'fire')
    glow = mat_color('hongo_luz', (0, 0, 0), emit=(0.35, 0.95, 0.75), strength=2.2)
    for i, a in enumerate((2.0, 3.3, 3.75, 5.6)):
        gx, gy = polar(a, R - 0.3)[:2]
        objs.append(cyl(f'hl{i}', 0.02, 0.025, 0.1, (gx, gy, 0.05), white, 8))
        objs.append(sphere(f'hc{i}', 0.07, (gx, gy, 0.1), glow, scale=(1, 1, 0.6), segs=10, rings=6))
        point(f'luzh{i}', (gx * 0.93, gy * 0.93, 0.2), (0.35, 0.95, 0.75), 2.5, 'A')

    meta = {
        'id': 'gnomos', 'floorY': 0, 'walk': {'type': 'circle', 'x': 0, 'z': 0, 'r': 1.98},
        'obstacles': [{'x': tx, 'z': -ty, 'r': 0.58}, {'x': lx, 'z': -ly, 'r': 0.36}, {'x': bxx, 'z': -byy, 'r': 0.42}] +
                     [{'x': round(x, 2), 'z': round(-y, 2), 'r': 0.24} for x, y in stools] +
                     [{'minX': -0.72, 'maxX': 0.72, 'minZ': -R, 'maxZ': -(R - 0.62)}, {'minX': bx - 0.2, 'maxX': R, 'minZ': -0.95, 'maxZ': 0.25}],
        'spawn': {'x': 0, 'z': 1.6, 'yaw': 0},
        'fires': [dict(zip('xyz', t3(0, R - 0.36, 0.1)), size=0.5), dict(zip('xyz', t3(*vela)), size=0.085), dict(zip('xyz', t3(0, -0.1, fz - 0.06)), size=0.15)],
    }
    bake_and_export('gnomos', objs, [], meta)


# =============================================================== Cueva de las Amatistas
def _remesh(ob, voxel):
    bpy.context.view_layer.objects.active = ob
    m = ob.modifiers.new('remesh', 'REMESH')
    m.mode = 'VOXEL'; m.voxel_size = voxel; m.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier='remesh')
    return ob


def _displace(ob, amp, freq, seed=0.0, along=1.0):
    from mathutils import noise
    me = ob.data
    for v in me.vertices:
        p = v.co * freq + Vector((seed, seed * 1.7, seed * 0.3))
        d = noise.noise(p) * amp + noise.noise(p * 2.7) * amp * 0.4 + noise.noise(p * 6.5) * amp * 0.15
        v.co += v.normal * d * along
    me.update()


def _delete_faces(ob, pred):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    dead = [f for f in bm.faces if pred(f)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def crystal_cluster(name, base, normal, n, size, rng, mat):
    """Drusa: prismas hexagonales con punta, abiertos en abanico alrededor de `normal`."""
    base, normal = Vector(base), Vector(normal).normalized()
    parts = []
    for i in range(n):
        L, w = size * rng.uniform(0.45, 1.0), size * rng.uniform(0.09, 0.17)
        ob = lathe(f'cr{i}', [(0.0, -0.05), (w, -0.05), (w, L), (0.0, L + w * 1.5)], (0, 0, 0), mat, 6, smooth=False)
        d = (normal + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * (0.75 if i else 0.1)).normalized()
        q = Vector((0, 0, 1)).rotation_difference(d)
        off = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * size * 0.22
        ob.data.transform(Matrix.Translation(base + off - normal * 0.05) @ q.to_matrix().to_4x4())
        ob.data.update()
        uv_box(ob, 0.5)
        parts.append(ob)
    return join(name, parts)


def cave():
    reset()
    rng = random.Random(11)
    rock = mat_ph('cliff_side', 'c9b8a6')
    rock_out = mat_ph('cliff_side')
    ame = mat_color('amatista', (0.42, 0.16, 0.8), 0.2)
    PATH = [(10.6, 0.4), (8.6, 0.2), (6.5, -0.6), (4.7, -1.3), (2.9, -0.9), (1.2, -0.2)]  # boca → cámara
    CH = (-2.2, 0.4)
    SHAFT = (CH[0] + 0.9, CH[1] - 0.6)

    # ---- interior: túnel + cámara + chimenea de la claraboya, unidos por remallado de vóxeles
    inner = join('cave_in', [
        tube('tunel', [(x, y, 1.25) for x, y in PATH], 1.75, None, 16),
        sphere('camara', 1.0, (CH[0], CH[1], 1.2), None, scale=(5.0, 4.6, 3.7), segs=32, rings=20),
        cyl('chimenea', 0.95, 1.15, 6.5, (SHAFT[0], SHAFT[1], 6.6), None, 20)])
    _remesh(inner, 0.2)
    _displace(inner, 0.34, 0.5, 3.0)
    # cortador para el cascarón: copia apenas inflada del interior
    cutter = inner.copy(); cutter.data = inner.data.copy()
    bpy.context.scene.collection.objects.link(cutter)
    for v in cutter.data.vertices:
        v.co += v.normal * 0.28
    # piso plano y normales hacia adentro
    for v in inner.data.vertices:
        if v.co.z < 0.0:
            v.co.z = 0.0
    bm = bmesh.new(); bm.from_mesh(inner.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(inner.data); bm.free(); inner.data.update()

    # ---- cascarón exterior
    outer = join('cave_out', [
        tube('lomo', [(x, y, 0.7) for x, y in PATH if x < 9.4] + [], 3.3, None, 16),
        sphere('cerro', 1.0, (CH[0], CH[1], 0.5), None, scale=(8.3, 7.9, 6.6), segs=32, rings=20)])
    _remesh(outer, 0.42)
    _displace(outer, 0.75, 0.22, 9.0)
    _displace(outer, 0.2, 0.9, 4.0)
    bpy.context.view_layer.objects.active = outer
    bo = outer.modifiers.new('hueco', 'BOOLEAN')
    bo.operation = 'DIFFERENCE'; bo.object = cutter; bo.solver = 'EXACT'
    bpy.ops.object.modifier_apply(modifier='hueco')
    bpy.data.objects.remove(cutter)
    top = max(v.co.z for v in outer.data.vertices)
    _delete_faces(outer, lambda f: all(v.co.z < -0.25 for v in f.verts))
    for p in outer.data.polygons:
        p.use_smooth = True
    outer.data.materials.clear(); outer.data.materials.append(rock_out)
    uv_box(outer, 3.0)
    # boca y claraboya abiertas
    _delete_faces(inner, lambda f: all(v.co.x > 9.5 for v in f.verts) or all(v.co.z > top - 0.15 for v in f.verts))
    inner.data.materials.clear(); inner.data.materials.append(rock)
    for p in inner.data.polygons:
        p.use_smooth = True
    uv_box(inner, 2.2)

    in_chamber = lambda x, y, r: math.hypot((x - CH[0]) / 5.0, (y - CH[1]) / 4.6) < r
    verts = [(v.co.copy(), v.normal.copy()) for v in inner.data.vertices]
    # ---- estalactitas y estalagmitas
    spikes, solids = [], []
    ceil = [(c, n) for c, n in verts if n.z < -0.72 and c.z > 2.5 and math.hypot(c.x - SHAFT[0], c.y - SHAFT[1]) > 1.6]
    for c, n in rng.sample(ceil, min(90, len(ceil))):
        L, r = rng.uniform(0.35, 1.5), rng.uniform(0.07, 0.2)
        spikes.append(cyl(f'tita{len(spikes)}', 0.012, r, L, (c.x, c.y, c.z - L / 2 + 0.12), rock, 7, uv=1.2))
    for i in range(34):
        a, d = rng.uniform(0, TAU), rng.uniform(0.62, 0.9)
        x, y = CH[0] + math.cos(a) * 5.0 * d, CH[1] + math.sin(a) * 4.6 * d
        if x > CH[0] + 2.0 and abs(y - PATH[-1][1]) < 2.0:
            continue  # deja libre la entrada a la cámara
        L, r = rng.uniform(0.3, 1.3), rng.uniform(0.1, 0.3)
        spikes.append(cyl(f'mita{i}', r, 0.015, L, (x, y, L / 2 - 0.04), rock, 7, uv=1.2))
        if r > 0.2:
            solids.append({'x': round(x, 2), 'z': round(-y, 2), 'r': round(r + 0.05, 2)})
    cave_in = join('cave_in', [inner] + spikes)

    # columna (estalactita antigua) a la altura de los ojos
    ex, ey = CH[0] - 1.9, CH[1] + 2.5
    ez = max(c.z for c, n in verts if math.hypot(c.x - ex, c.y - ey) < 0.6)
    est = join('I_estalactita', [cyl('e1', 0.03, 0.42, ez - 1.45, (ex, ey, 1.5 + (ez - 1.45) / 2), mat_ph('cliff_side', 'e8dcc8'), 10, uv=1.0),
                                 cyl('e2', 0.36, 0.03, 1.0, (ex + 0.03, ey - 0.02, 0.48), mat_ph('cliff_side', 'e8dcc8'), 10, uv=1.0)])
    solids.append({'x': round(ex, 2), 'z': round(-ey, 2), 'r': 0.5})
    # roca bajo la claraboya
    boulder = sphere('I_roca-luz', 1.0, (SHAFT[0], SHAFT[1], 0.36), mat_ph('mossy_rock'), scale=(0.95, 0.8, 0.55), segs=20, rings=12)
    _displace(boulder, 0.09, 2.2, 1.0)
    uv_box(boulder, 1.0)
    solids.append({'x': round(SHAFT[0], 2), 'z': round(-SHAFT[1], 2), 'r': 0.95})

    # ---- amatistas
    def wall_vert(a, z):
        tx, ty = CH[0] + math.cos(a) * 4.7, CH[1] + math.sin(a) * 4.3
        return min(verts, key=lambda cn: (cn[0].x - tx) ** 2 + (cn[0].y - ty) ** 2 + (cn[0].z - z) ** 2 * 2)
    glows = []
    c, n = wall_vert(3.6, 1.25)
    drusa = crystal_cluster('I_drusa', c, n, 16, 0.85, rng, ame)
    point('luz_drusa', c + n * 0.5, (0.62, 0.3, 1.0), 85, 'A', radius=0.15)
    glows.append(t3(*(c + n * 0.35)))
    others = []
    for i, (a, z, sz) in enumerate([(1.1, 0.9, 0.5), (2.2, 2.6, 0.6), (2.9, 0.3, 0.45), (4.4, 0.7, 0.55), (5.0, 2.9, 0.6), (5.6, 1.2, 0.45), (0.5, 3.3, 0.5), (4.0, 3.6, 0.7), (1.7, 0.2, 0.4)]):
        c, n = wall_vert(a, z)
        others.append(crystal_cluster(f'am{i}', c, n, 9, sz, rng, ame))
        point(f'luz_am{i}', c + n * 0.4, (0.62, 0.3, 1.0), 38, 'A', radius=0.12)
        glows.append(t3(*(c + n * 0.3)))
    # una veta en el túnel, para que el violeta se vea desde afuera
    tv = min(verts, key=lambda cn: (cn[0].x - 5.6) ** 2 + (cn[0].y + 2.4) ** 2 + (cn[0].z - 1.4) ** 2)
    others.append(crystal_cluster('am_tunel', tv[0], tv[1], 8, 0.42, rng, ame))
    point('luz_tunel', tv[0] + tv[1] * 0.4, (0.62, 0.3, 1.0), 30, 'A', radius=0.12)
    glows.append(t3(*(tv[0] + tv[1] * 0.3)))
    amatistas = join('amatistas', others)

    # ---- luz: rayo de sol por la claraboya + cielo por la boca
    sun('rayo', (0.06, -0.05, -1.0), (1.0, 0.9, 0.72), 11.0, angle=0.05)
    area('boca', (10.4, 0.4, 1.5), (5, -0.6, 1.0), (3.0, 2.6), SKY, 800)
    area('cielo', (SHAFT[0], SHAFT[1], top + 0.3), (SHAFT[0], SHAFT[1], 0), (1.8, 1.8), SKY, 1800)

    corridor = []
    for i in range(len(PATH) - 1):
        (x0, y0), (x1, y1) = PATH[i], PATH[i + 1]
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / 0.7))
        for k in range(n):
            t = k / n
            corridor.append({'x': round(x0 + (x1 - x0) * t, 2), 'z': round(-(y0 + (y1 - y0) * t), 2), 'r': 1.15})
    corridor.append({'x': PATH[-1][0], 'z': -PATH[-1][1], 'r': 1.4})
    corridor.append({'x': CH[0], 'z': -CH[1], 'r': 4.1})
    corridor.append({'x': CH[0] + 1.6, 'z': -CH[1] + 0.3, 'r': 2.6})
    corridor.append({'x': 11.7, 'z': -0.4, 'r': 1.3})
    # huella de la roca: cerro de la cámara + lomo del túnel + los dos flancos de la boca
    shell_c = [{'x': CH[0], 'z': -CH[1], 'r': 8.3}] + [{'x': x, 'z': -y, 'r': 3.4} for x, y in PATH if x < 8.0]
    shell_c += [{'x': 8.3, 'z': -(0.2 + 2.3), 'r': 1.3}, {'x': 8.3, 'z': -(0.2 - 2.3), 'r': 1.3}]
    meta = {'id': 'cueva', 'corridor': corridor, 'shell': shell_c, 'solids': solids, 'glows': glows, 'shaft': t3(SHAFT[0], SHAFT[1], top)}
    bake_and_export('cueva', [cave_in, est, boulder, drusa, amatistas], [outer], meta, fire=False)


# =============================================================== Kit modular de la mazmorra
def _cut(ob, cutters, uv=1.2):
    """Resta booleana, un cortador por vez (unidos se solapan y el booleano exacto falla). Recalcula el UV."""
    bpy.context.view_layer.objects.active = ob
    for c in cutters:
        m = ob.modifiers.new('corte', 'BOOLEAN')
        m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'
        bpy.ops.object.modifier_apply(modifier='corte')
        bpy.data.objects.remove(c)
    uv_box(ob, uv)
    return ob


def dungeon_kit():
    """Piezas sueltas en el origen, en un solo GLB: wall, arch, floor, ceiling, stairs, door, torch,
    chest_base, chest_lid, key, pillar, pedestal, barrel, crate, candle. Módulo de 2 m, altura 3 m."""
    reset()
    rng = random.Random(21)
    stone = mat_ph('old_stone_wall', '8f8a82')
    cobble = mat_ph('cobblestone_floor_04', '8a857c')
    wood = mat_ph('brown_planks_09', '7a5a3c')
    iron = mat_color('hierro_kit', (0.035, 0.035, 0.04), 0.55, 0.3)
    gold = mat_color('oro', (0.85, 0.55, 0.1), 0.35, 0.3)
    ember = mat_color('brasa', (0, 0, 0), emit=(1.0, 0.4, 0.08), strength=5.0)
    P = []

    def blocks(n, y):
        out = []
        for i in range(n):
            w, h = rng.uniform(0.35, 0.6), rng.uniform(0.2, 0.3)
            out.append(box(f'bl{i}', (w, 0.05, h), (rng.uniform(-1 + w / 2, 1 - w / 2), y, rng.uniform(0.5, 2.6)), stone, uv=1.2))
        return out

    # pared: paño de 2 × 3 m con zócalo, cornisa y bloques en relieve de los dos lados
    P.append(join('wall', [box('w0', (2.0, 0.26, 3.0), (0, 0, 1.5), stone, uv=1.2), box('w1', (2.0, 0.34, 0.32), (0, 0, 0.16), stone, uv=1.2),
                           box('w2', (2.0, 0.32, 0.14), (0, 0, 2.93), stone, uv=1.2)] + blocks(4, 0.14) + blocks(4, -0.14)))
    # arco: el mismo paño con un vano de 1,3 × 2,3 m, jambas y dovelas
    a = box('arch', (2.0, 0.3, 3.0), (0, 0, 1.5), stone, uv=1.2)
    _cut(a, [box('c1', (1.3, 1.0, 1.65), (0, 0, 0.825), None), cyl('c2', 0.65, 0.65, 1.0, (0, 0, 1.65), None, 32, rot=(math.pi / 2, 0, 0))])
    trim = [box(f'j{s}', (0.2, 0.38, 1.65), (s * 0.76, 0, 0.825), stone, uv=0.9) for s in (-1, 1)]
    for k in range(9):
        ang = math.pi * k / 8
        trim.append(box(f'd{k}', (0.3, 0.38, 0.22), (math.cos(ang) * 0.78, 0, 1.65 + math.sin(ang) * 0.78), stone, rot=(0, math.pi / 2 - ang, 0), uv=0.9))
    P.append(join('arch', [a] + trim))
    P.append(box('floor', (2.0, 2.0, 0.12), (0, 0, -0.06), cobble, uv=1.0))
    P.append(join('ceiling', [box('t0', (2.0, 2.0, 0.12), (0, 0, 0.06), stone, uv=1.4), box('t1', (2.0, 0.18, 0.16), (0, 0, -0.08), wood, uv=0.8)]))
    # escalera: 8 escalones que suben 2 m en 2 m (hacia +Y)
    P.append(join('stairs', [box(f's{i}', (1.7, 0.25, 0.25 * (i + 1)), (0, -1.0 + 0.125 + 0.25 * i, 0.125 * (i + 1)), stone, uv=1.0) for i in range(8)]))
    # puerta: hoja con arco, herrajes y argolla; el origen es la bisagra
    d = [box('h0', (1.26, 0.09, 1.62), (0.63, 0, 0.81), wood, uv=0.9), cyl('h1', 0.63, 0.63, 0.07, (0.63, 0, 1.62), wood, 28, rot=(math.pi / 2, 0, 0), uv=0.9),
         box('h5', (0.14, 0.12, 0.2), (1.1, 0, 1.0), iron)]
    d += [box(f'hb{i}', (1.2, 0.11, 0.07), (0.63, 0, z), iron) for i, z in enumerate((0.35, 1.0, 1.55))]
    d += [torus(f'hr{s}', 0.075, 0.014, (1.0, s * 0.075, 1.0), iron, rot=(math.pi / 2, 0, 0), segs=16, tsegs=6) for s in (-1, 1)]
    P.append(join('door', d))
    # antorcha de pared: el origen es la cara del muro; la llama va en (0, 0.24, 0.5)
    P.append(join('torch', [box('a0', (0.08, 0.02, 0.26), (0, 0.01, 0.0), iron), tube('a1', [(0, 0.02, -0.06), (0, 0.2, 0.0), (0, 0.24, 0.12)], 0.013, iron, 6),
                            cyl('a2', 0.022, 0.026, 0.42, (0, 0.24, 0.21), wood, 8, uv=0.5), cyl('a3', 0.035, 0.065, 0.09, (0, 0.24, 0.43), iron, 10),
                            sphere('a4', 0.05, (0, 0.24, 0.47), ember, segs=8, rings=6)]))
    # cofre: base y tapa aparte (origen de la tapa = bisagra trasera)
    cb = [box('k0', (0.9, 0.55, 0.4), (0, 0, 0.2), wood, uv=0.7), box('k1', (0.8, 0.45, 0.02), (0, 0, 0.4), mat_color('hollin', (0.012, 0.01, 0.008), 1.0)),
          box('k2', (0.12, 0.03, 0.13), (0, -0.285, 0.33), gold), sphere('k3', 1.0, (0, 0, 0.4), gold, scale=(0.36, 0.2, 0.08), segs=14, rings=8)]
    cb += [box(f'kb{i}', (0.07, 0.58, 0.42), (x, 0, 0.21), iron) for i, x in enumerate((-0.33, 0, 0.33))]
    P.append(join('chest_base', cb))
    lid = cyl('l0', 0.275, 0.275, 0.9, (0, -0.275, 0), wood, 20, rot=(0, math.pi / 2, 0), uv=0.7)
    _cut(lid, [box('lc', (1.2, 1.0, 0.6), (0, -0.275, -0.3), None)], 0.7)
    bands = []
    for i, x in enumerate((-0.33, 0, 0.33)):
        b = cyl(f'lb{i}', 0.29, 0.29, 0.07, (x, -0.275, 0), iron, 20, rot=(0, math.pi / 2, 0))
        bands.append(_cut(b, [box('lc', (0.3, 1.0, 0.6), (x, -0.275, -0.3), None)]))
    P.append(join('chest_lid', [lid] + bands))
    P.append(join('key', [torus('y0', 0.045, 0.012, (-0.07, 0, 0), gold, rot=(math.pi / 2, 0, 0), segs=16, tsegs=6), tube('y1', [(-0.025, 0, 0), (0.13, 0, 0)], 0.011, gold, 6),
                          box('y2', (0.02, 0.014, 0.045), (0.1, 0, -0.03), gold), box('y3', (0.02, 0.014, 0.03), (0.127, 0, -0.022), gold)]))
    P.append(join('pillar', [box('p0', (0.62, 0.62, 0.25), (0, 0, 0.125), stone, uv=0.9), cyl('p1', 0.2, 0.2, 2.5, (0, 0, 1.5), stone, 12, uv=0.9), box('p2', (0.62, 0.62, 0.25), (0, 0, 2.875), stone, uv=0.9)]))
    P.append(join('pedestal', [box('e0', (0.5, 0.5, 0.9), (0, 0, 0.45), stone, uv=0.8), box('e1', (0.62, 0.62, 0.08), (0, 0, 0.94), stone, uv=0.8)]))
    P.append(join('barrel', [lathe('r0', [(0.0, 0), (0.24, 0), (0.3, 0.2), (0.31, 0.35), (0.3, 0.5), (0.24, 0.7), (0.0, 0.7)], (0, 0, 0), wood, 16, uv=0.6, cyl_uv=True)] +
                  [torus(f'r{z}', 0.285 if z < 0.3 else 0.275, 0.014, (0, 0, z), iron, segs=20, tsegs=5) for z in (0.14, 0.56)]))
    cr = [box('x0', (0.6, 0.6, 0.6), (0, 0, 0.3), wood, uv=0.6)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            cr.append(box(f'x{sx}{sy}', (0.07, 0.07, 0.64), (sx * 0.29, sy * 0.29, 0.32), mat_ph('brown_planks_09', '4a3422'), uv=0.6))
    P.append(join('crate', cr))
    P.append(cyl('candle', 0.025, 0.028, 0.16, (0, 0, 0.08), mat_color('cera', (0.92, 0.88, 0.75), 0.5), 10))

    out = os.path.join(ROOT, 'public', 'assets', 'dungeon')
    os.makedirs(out, exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in P:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'kit.glb'), export_format='GLB', use_selection=True, export_apply=True,
                              export_materials='EXPORT', export_image_format='NONE', export_yup=True, export_cameras=False, export_lights=False, export_animations=False)
    with open(os.path.join(out, 'kit.json'), 'w') as f:
        json.dump({'module': 2.0, 'height': 3.0, 'pieces': [o.name for o in P]}, f, indent=1)
    print(f'[kit] exportado: {len(P)} piezas → {[o.name for o in P]}')


ROOMS = {'cana': room_cana, 'abuelas': room_abuelas, 'gnomos': room_gnomos, 'cueva': cave}
EXTRA = {'kit': dungeon_kit}

if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['all']
    todo = list(ROOMS) + list(EXTRA) if 'all' in args else args
    for name in todo:
        {**ROOMS, **EXTRA}[name]()
