# invite

Invite es una app interactiva para invitaciones de casamiento: el invitado camina por un bosque 3D
con la forma del Cono Sur hasta encontrar la invitación de la pareja.

Hecha con Three.js + TypeScript (Vite). Todo corre en el navegador, sin backend.

## Estado: etapa 1

Un bosque de ~226 × 477 m (a 1 m/s), con un río grande, tres arroyos, mar, cordillera, más de mil
árboles nativos procedurales y nueve especies de aves. Seis lugares, cada uno nombrado por su idea:

| Lugar | Tipo | Qué hay |
|---|---|---|
| Estanque de los Peces | natural | peces nadando en círculos, irupés, juncos |
| Fogata de los Novios | natural | fuego que parpadea y los retratos de la pareja en las llamas |
| Cueva de las Amatistas | natural | estalactitas, drusas violetas y una claraboya |
| Corazón de la Caña Fístula | sala | comida argentina y un mate galleta dentro del árbol gigante |
| Cocina de las Abuelas | sala | dos abuelas, corazones, fideos con tuco y tortilla de papa |
| Casita de Gnomos | sala | vestíbulo; la trampilla a la mazmorra se abre en la etapa 2 |

Pendiente: campamento, mazmorra de cinco cuartos con la invitación, deploy en Vercel.

## Controles

| Tecla | Acción |
|---|---|
| `W` `A` `S` `D` o flechas | caminar (1 m/s) |
| mouse | mirar |
| `E` | leer el objeto que mirás / entrar o salir de una sala |
| `M` | mapa del bosque |
| `Ctrl` + `F` | buscar entre todos los objetos y caminar hasta el elegido |

## Desarrollo

```bash
npm install
npm run dev          # servidor de desarrollo
npm run build        # build estático en dist/
npm test             # build + tests de la etapa 1 (Playwright, WebGL por software)
npm run screenshots  # capturas de los seis lugares en screenshots/stage1/
```

Parámetros de URL: `?quality=low` (sin sombras ni post-proceso) y `?autostart=1` (saltea la
pantalla de inicio; lo usan los tests).

### Regenerar assets

```bash
npm run assets                                   # texturas y cielo de Poly Haven + contorno del Cono Sur
blender -b -P blender/build.py -- all            # salas y cueva: modelado, horneado y export (Blender 4.2)
```

Variables del horneado: `BAKE_SIZE` (2048), `BAKE_SAMPLES` (160), `BAKE_DENOISE` (1).

## Contenido

Los lugares, objetos y mensajes viven en `src/content/ideas.ts`. Los mensajes actuales son
borradores. Licencias de assets: ver [ASSETS.md](ASSETS.md).
