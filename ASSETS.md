# Assets y licencias

Todo lo que no figura acá está generado por código en tiempo de ejecución (árboles, hojas, aves,
peces, fuego, retratos, partículas, música y cantos).

## Poly Haven — CC0 (dominio público)

Descargados por `tools/fetch_polyhaven.mjs` desde <https://polyhaven.com>. Licencia:
<https://polyhaven.com/license> (CC0 1.0, sin atribución obligatoria).

| Tipo | Id en Poly Haven | Uso |
|---|---|---|
| Cielo HDRI | `qwantani_sunset_puresky` | fondo del atardecer (4k) e iluminación ambiente (1k) |
| Textura | `forest_leaves_02`, `leafy_grass`, `cliff_side`, `coast_sand_01` | terreno (bosque, pasto, roca, arena) |
| Textura | `mossy_rock` | rocas sueltas y roca de la cueva |
| Textura | `bark_brown_02`, `pine_bark`, `palm_tree_bark` | cortezas |
| Textura | `plank_flooring_02`, `plastered_wall_04`, `old_stone_wall`, `gingham_check`, `wood_table_001`, `brown_planks_09`, `cobblestone_floor_04` | salas horneadas en Blender |
| Textura | `clay_roof_tiles_02` | techo de la cocina de las abuelas (exterior) |

En runtime se usan versiones WebP de 1k (`public/assets/textures/`); los JPG originales quedan en
`.cache/polyhaven/` (no versionado) y son los que usa Blender para hornear.

## Natural Earth — dominio público

`public/assets/outline.json` sale de *Natural Earth 1:50m Admin 0 – Countries*
(<https://www.naturalearthdata.com>), vía `tools/build_outline.mjs`: Argentina, Chile, Uruguay y
Paraguay proyectados a ~226 × 477 m.

## Modelos propios (Blender)

`public/assets/rooms/*.glb`, `*_lm.webp`, `*_fire.webp` y `*.json` se generan con
`blender/build.py` (Blender 4.2 LTS, Cycles en CPU, denoise con OpenImageDenoise). No incluyen
assets de terceros salvo las texturas CC0 de arriba.
