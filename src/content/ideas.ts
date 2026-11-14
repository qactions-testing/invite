// Única fuente de verdad del contenido: cada IDEA es un lugar y cada PALABRA un objeto con mensaje.
// Los mensajes son BORRADORES: reemplazalos por los textos definitivos.

export interface ObjDef { id: string; name: string; message: string }
export interface PlaceDef {
  id: string;
  /** nombre del lugar = nombre de su idea */
  name: string;
  idea: string;
  kind: 'natural' | 'sala';
  /** [lon, lat] reales: el mundo tiene la forma del Cono Sur */
  ll: [number, number];
  /** escena donde viven sus objetos */
  scene: string;
  objects: ObjDef[];
}

export const SPAWN_LL: [number, number] = [-62.2, -33.7];

export const PLACES: PlaceDef[] = [
  {
    id: 'estanque', name: 'Estanque de los Peces', idea: 'El agua: lo que fluye y siempre vuelve', kind: 'natural', ll: [-57.3, -28.7], scene: 'bosque',
    objects: [
      { id: 'piedra-ronda', name: 'Piedra de la orilla', message: 'Los peces nadan en círculo porque saben que todo lo que se quiere, vuelve.' },
      { id: 'piedra-musgo', name: 'Piedra con musgo', message: 'Tirá una preocupación al agua.\nMirá cómo se la lleva la corriente.' },
      { id: 'piedra-irupe', name: 'Piedra del irupé', message: 'Flotar también es una forma de avanzar.' },
    ],
  },
  {
    id: 'fogata', name: 'Fogata de los Novios', idea: 'El amor: memorias que arden sin consumirse', kind: 'natural', ll: [-60.9, -35.5], scene: 'bosque',
    objects: [
      { id: 'tronco-agustina', name: 'Tronco de Agustina', message: 'En las llamas aparece ella: el pelo oscuro hasta el piso y un vestido blanco de otra época.\nEl fuego la recuerda riéndose.' },
      { id: 'tronco-gonzalo', name: 'Tronco de Gonzalo', message: 'En las llamas aparece él: traje verde, chaleco, camisa suelta y flequillo.\nEl fuego lo recuerda mirándola.' },
      { id: 'piedra-fogon', name: 'Piedra del fogón', message: 'Todo amor empieza con una chispa y se cuida como un fuego: de a dos.' },
    ],
  },
  {
    id: 'cueva', name: 'Cueva de las Amatistas', idea: 'La tierra: lo valioso se forma despacio y en lo profundo', kind: 'natural', ll: [-68.9, -33.0], scene: 'bosque',
    objects: [
      { id: 'drusa', name: 'Drusa de amatista', message: 'Bajo la piedra más gris, la tierra guarda violetas.\nLas personas también.' },
      { id: 'estalactita', name: 'Estalactita antigua', message: 'Gota a gota, mil años.\nLas cosas importantes no se apuran.' },
      { id: 'roca-luz', name: 'Roca bajo la claraboya', message: 'Siempre hay una grieta por donde entra la luz.' },
    ],
  },
  {
    id: 'cana', name: 'Corazón de la Caña Fístula', idea: 'El hogar: mesa servida y mate listo', kind: 'sala', ll: [-59.6, -24.4], scene: 'cana',
    objects: [
      { id: 'mate', name: 'Mate galleta', message: 'Mate listo, en mate galleta.\nEl primero es para quien llega cansado del camino.' },
      { id: 'empanadas', name: 'Fuente de empanadas', message: 'Empanadas recién hechas.\nSe comen con la mano y sin apuro.' },
      { id: 'locro', name: 'Olla de locro', message: 'Locro: lo que se cocina lento alcanza para todos.' },
      { id: 'cuadro-raices', name: 'Página enmarcada: Raíces', message: 'Un árbol es tan alto como hondas son sus raíces.' },
      { id: 'cuadro-sombra', name: 'Página enmarcada: Sombra', message: 'Quien planta un árbol sabiendo que no se sentará a su sombra, empezó a entender.' },
    ],
  },
  {
    id: 'abuelas', name: 'Cocina de las Abuelas', idea: 'Los buenos augurios: cariño que se sirve en plato hondo', kind: 'sala', ll: [-63.6, -31.3], scene: 'abuelas',
    objects: [
      { id: 'abuela-roja', name: 'Abuela de pelo rojo', message: '¡Que nunca les falte el hambre de estar juntos!\nTomá: fideos con tuco y estofado de carne. Comé, que estás flaco.' },
      { id: 'abuela-blanca', name: 'Abuela de pelo blanco', message: 'Buenos augurios para el camino: salud, paciencia y risa.\nY una tortilla de papa, que arregla cualquier día.' },
      { id: 'fideos', name: 'Fideos con tuco y estofado', message: 'Fideos con tuco y estofado de carne.\nLa receta no está escrita: se aprende mirando.' },
      { id: 'tortilla', name: 'Tortilla de papa', message: 'Tortilla de papa, dorada de los dos lados.\nBabé o bien cocida: acá no se discute, se comparte.' },
      { id: 'recetario', name: 'Recetario de la casa', message: 'Primera página: "Una pizca de sal, un chorro de paciencia y cocinar siempre para uno más."' },
    ],
  },
  {
    id: 'gnomos', name: 'Casita de Gnomos', idea: 'El secreto: una puerta chica guarda algo grande', kind: 'sala', ll: [-70.3, -41.4], scene: 'gnomos',
    objects: [
      { id: 'libro-caminos', name: 'Libro de los caminos', message: 'Los gnomos anotan cada sendero del bosque.\nEl último capítulo dice: "el que busca, baja".' },
      { id: 'libro-cerraduras', name: 'Libro de las cerraduras', message: 'Toda puerta cerrada tiene su llave escondida cerca.\nLos gnomos nunca la guardan lejos.' },
      { id: 'pergamino', name: 'Pergamino sobre la mesa', message: 'Bajo esta casa hay cinco cuartos y un secreto con sello de lacre rojo oscuro.' },
      { id: 'trampilla', name: 'Trampilla de la mazmorra', message: 'Cerrada con candado.\nSe oyen bombos muy lejanos… se abrirá en la próxima etapa.' },
    ],
  },
];

export const placeOf = (objId: string) => PLACES.find((p) => p.objects.some((o) => o.id === objId));
export const objectDef = (objId: string) => placeOf(objId)?.objects.find((o) => o.id === objId);
