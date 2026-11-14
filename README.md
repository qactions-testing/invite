# invite

Invite es una app interactiva para invitaciones de casamiento: el invitado camina por un bosque 3D
con la forma del Cono Sur hasta encontrar la invitación de la pareja.

Hecha con Three.js + TypeScript (Vite). Todo corre en el navegador, sin backend.

## Qué hay

Un bosque de ~226 × 477 m, con un río grande, tres arroyos, mar, cordillera, más de mil árboles
nativos procedurales y nueve especies de aves. Siete lugares, cada uno nombrado por su idea:

| Lugar | Tipo | Qué hay |
|---|---|---|
| Estanque de los Peces | natural | peces que recorren todo el estanque, irupés, juncos |
| Fogata de los Novios | natural | fuego que parpadea y los retratos de la pareja en las llamas |
| Cueva de las Amatistas | natural | estalactitas, drusas violetas y una claraboya |
| Campamento de los Viajeros | natural | carpa, tendedero con la remera amarilla y la de la centaura cebra |
| Corazón de la Caña Fístula | sala | comida argentina y un mate galleta dentro del árbol gigante |
| Cocina de las Abuelas | sala | dos abuelas, corazones, fideos con tuco y tortilla de papa |
| Casita de Gnomos | sala | la trampilla baja a la mazmorra |

### La mazmorra (mini juego)

Bajo la Casita de Gnomos hay cinco cuartos armados con un kit modular hecho en Blender
(`public/assets/dungeon/kit.glb`: pared, arco, piso, techo, escalera, puerta, antorcha, cofre, llave…):
bajada de la trampilla → corredor de antorchas → sala de la puerta → cripta de la llave → sala del tesoro.
Tomar la llave abre la puerta; llegar al cofre muestra «You found it!»; la invitación se toma con
click o `E`, suenan trompetas y se abre en primera pantalla con su sello de lacre. Los bombos de
ceremonia crecen al acercarse. A las 2 horas la invitación se autodestruye y hay que conseguirla de nuevo.

## Controles

| Tecla | Acción |
|---|---|
| `W` `A` `S` `D` o flechas | caminar (1 m/s) |
| `Shift` | trotar (3 m/s) |
| mouse | mirar |
| `E` | leer el objeto que mirás / entrar o salir / tomar la llave o la invitación |
| `I` | ver la invitación (cuando la tenés) |
| `M` | mapa del bosque |
| `Ctrl` + `F` | buscar entre todos los objetos y caminar hasta el elegido |

## Desarrollo

```bash
npm install
npm run dev          # servidor de desarrollo
npm run build        # build estático en dist/
npm test             # build + tests de las dos etapas (Playwright, WebGL por software)
npm run screenshots  # capturas en screenshots/stage1/ (con `-- --stage2`: screenshots/stage2/)
```

Parámetros de URL: `?quality=low` (sin sombras ni post-proceso) y `?autostart=1` (saltea la
pantalla de inicio; lo usan los tests).

### Regenerar assets

```bash
npm run assets                                   # texturas y cielo de Poly Haven + contorno del Cono Sur
blender -b -P blender/build.py -- all            # salas, cueva y kit de la mazmorra (Blender 4.2)
```

Variables del horneado: `BAKE_SIZE` (2048), `BAKE_SAMPLES` (160), `BAKE_DENOISE` (1).

## Contenido

Los lugares, objetos, mensajes y el texto de la invitación viven en `src/content/ideas.ts`
(los mensajes del campamento todavía son borradores). Licencias de assets: ver [ASSETS.md](ASSETS.md).
