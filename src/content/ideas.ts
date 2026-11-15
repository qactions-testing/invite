// Única fuente de verdad del contenido: cada IDEA es un lugar y cada PALABRA un objeto con mensaje.
// Para cambiar un texto alcanza con editar `name`, `idea` o `message`; los `id` no se tocan.

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
      { id: 'piedra-ronda', name: 'Gran piedra de la orilla', message: 'Los peces -de remoto y desconocido origen- nadan en círculos porque son como el agua y están destinados a un siempre cambiante eterno retorno.' },
      { id: 'piedra-musgo', name: 'Piedra con musgo', message: 'Tirá una preocupación al agua.\nMirá cómo se la lleva la corriente.' },
      { id: 'piedra-irupe', name: 'Piedra del irupé', message: 'Flotar también es una forma de avanzar.' },
    ],
  },
  {
    id: 'fogata', name: 'Fogata de los Novios', idea: 'El amor: memorias amorosas arden sin consumirse nunca', kind: 'natural', ll: [-60.9, -35.5], scene: 'bosque',
    objects: [
      { id: 'tronco-agustina', name: 'Tronco de Agustina', message: 'En las llamas aparece ella: el pelo oscuro hasta el piso y un vestido blanco de otra época.\nEl fuego sagrado la recuerda riéndose.' },
      { id: 'tronco-gonzalo', name: 'Tronco de Gonzalo', message: 'En las llamas aparece él: guarda papeles escritos en sus bolsillos.\nEl fuego sagrado lo recuerda mirando las estrellas.' },
      { id: 'piedra-fogon', name: 'Piedra del fogón', message: 'Todo fuego empieza con una chispa, una pequeña llamarada y se cuida y se cuida, hasta tener un gran fogón: igualito que su amor.' },
    ],
  },
  {
    id: 'cueva', name: 'Cueva de las Amatistas', idea: 'La tierra: lo valioso se forma despacio y en lo profundo', kind: 'natural', ll: [-68.9, -33.0], scene: 'bosque',
    objects: [
      { id: 'drusa', name: 'Drusa de amatista', message: 'Bajo la piedra más gris, la tierra guarda cristales violetas.\nEn el fondo, todxs somos iguales.' },
      { id: 'estalactita', name: 'Estalactita antigua', message: 'Gota a gota, por miles y miles de años.\nLa constancia es nuestra gran compañera.' },
      { id: 'roca-luz', name: 'Roca bajo la claraboya', message: 'Elijo iluminarme para iluminarte con mi dulce reflejo.' },
    ],
  },
  {
    id: 'campamento', name: 'Campamento de los Viajeros', idea: 'El viaje: la casa también se lleva a cuestas', kind: 'natural', ll: [-65.6, -38.4], scene: 'bosque',
    objects: [
      { id: 'carpa', name: 'Carpa para dos', message: 'Dos bolsas de dormir y un solo cierre.\nAfuera puede llover todo lo que quiera.' },
      { id: 'remera-amarilla', name: 'Remera de "La Máquina de hacer pájaros"', message: 'Nunca dejes de reírte, no. No te dejes desanimar.\nSe seca al sol de la tarde y ya huele bien, a trébol y anís.' },
      { id: 'remera-centaura', name: 'Remera de la centaura cebra', message: 'La centaura se enfrenta a los peligros de la vida mundana: mitad mujer, mitad cebra.\nNadie puede domarla.' },
      { id: 'mochila', name: 'Mochila de viaje', message: 'Adentro hay un mapa doblado mil veces, yerba agroecológica y una linterna.\nCon eso alcanza y sobra.' },
      { id: 'guitarra', name: 'Guitarra criolla', message: 'Es la que se oye a lo lejos en todo el bosque.\nAlguien la dejó afinada.' },
    ],
  },
  {
    id: 'cana', name: 'Corazón de la Caña Fístula', idea: 'Un árbol milenario. El hogar de miles de especies vivas: la mesa está servida y mate espumosín listo', kind: 'sala', ll: [-59.6, -24.4], scene: 'cana',
    objects: [
      { id: 'mate', name: 'El mate galleta', message: 'Alias "Espumosín": Nunca su amargor cortó su dulzura.\nPreparado para quienes llegan cansadxs del camino.' },
      { id: 'empanadas', name: 'Fuente de empanadas', message: 'Puro maná argentino. Elixir de lxs hambrientxs.\nComelas sin apuro, todo está bien.' },
      { id: 'locro', name: 'Olla de locro', message: 'Papota argenta: proteína mineral, vegetal, animal y espiritual.' },
      { id: 'cuadro-raices', name: 'Página enmarcada: Raíces', message: 'Un árbol es tan alto como hondas son sus raíces.' },
      { id: 'cuadro-sombra', name: 'Página enmarcada: Sombra', message: 'Quien planta un árbol sabiendo que no se sentará a su sombra, todo entendió.' },
    ],
  },
  {
    id: 'abuelas', name: 'Cocina de las Abuelas', idea: 'Los buenos augurios: cariño servido en plato hondo', kind: 'sala', ll: [-63.6, -31.3], scene: 'abuelas',
    objects: [
      { id: 'abuela-roja', name: 'Abuela de pelo rojo', message: '¡Que nunca les falte el hambre de estar juntos!\nTomá: fideos con tuco y estofado de carne. Comé, que estás flaco, nene.' },
      { id: 'abuela-blanca', name: 'Abuela de pelo blanco', message: 'Lo mejor para su camino: salud, paciencia y risa.\nY una tortilla de papa, que arregla cualquier molestia.' },
      { id: 'fideos', name: 'Fideos con tuco y estofado', message: 'Fideos con tuco y estofado de carne.\nLa receta no está escrita: se aprende escuchando y mirando.' },
      { id: 'tortilla', name: 'Tortilla de papa', message: 'Tortilla de papa, dorada de los dos lados.\nReceta ancestral familiar, desde antes que se inventara la papa.' },
      { id: 'recetario', name: 'Recetario de la casa', message: 'Primera página: "Una pizca de sal, 250ml de paciencia y cocinar siempre para uno más. Queda prohibido el delivery."' },
    ],
  },
  {
    id: 'gnomos', name: 'Casita de Gnomos', idea: 'El secreto: una puerta chica guarda algo grande', kind: 'sala', ll: [-70.3, -41.4], scene: 'gnomos',
    objects: [
      { id: 'libro-caminos', name: 'Libro de los caminos', message: 'Los gnomos anotan cada sendero del bosque.\nEl último capítulo dice: "el que busca, baja".' },
      { id: 'libro-cerraduras', name: 'Libro de las cerraduras', message: 'Toda puerta cerrada tiene su llave escondida cerca.\nLos gnomos nunca las guardan lejos.' },
      { id: 'pergamino', name: 'Pergamino sobre la mesa', message: 'Bajo esta casa hay cinco cuartos y un secreto con sello de lacre rojo oscuro.' },
      { id: 'trampilla', name: 'Trampilla de la mazmorra', message: 'Cerrada con candado.\nSe oyen bombos muy lejanos… se abrirá a la próxima señal.' },
    ],
  },
];

/** Los cinco cuartos de la mazmorra bajo la casita de gnomos. */
export const DUNGEON = {
  name: 'Mazmorra de los Gnomos',
  rooms: ['Bajada de la trampilla', 'Corredor de las antorchas', 'Sala de la puerta', 'Cripta de la llave', 'Sala del tesoro'],
  lockedDoor: 'Está cerrada con llave.\nLos gnomos nunca la guardan lejos.',
  keyTaken: 'Tenés la llave: la puerta se abrió',
  found: 'You found it!',
  foundSub: '¡La encontraste!',
  expired: 'Tu invitación se autodestruyó. Para ir al casamiento, debes conseguirla nuevamente.',
};

/** Texto literal de la invitación (no modificar ortografía ni saltos). */
export const INVITATION = {
  body: 'Invitación formal a la ceremonia pagana de Agustina y Gonzalo, reyes del mundo futuro, justos guerreros de la cofradía de los enamorados.',
  lines: [
    'Día: 13 de marzo de 2027',
    'Hora: 4PM a 8PM',
    'Lugar: Villa de mayo 378 - San Miguel, Provincia de Bvenos Ayres, Argentina.',
    'Coordenadas:',
    '34°31\'31.8" S',
    '58°42\'23.4" O',
  ],
  closing: 'Te esperamos, no invites a nadie, este encuentro es secreto y esta invitación se autodestruirá en 2 horas.',
  /** vida de la invitación una vez recogida */
  lifetimeMs: 2 * 60 * 60 * 1000,
};

export const placeOf = (objId: string) => PLACES.find((p) => p.objects.some((o) => o.id === objId));
export const objectDef = (objId: string) => placeOf(objId)?.objects.find((o) => o.id === objId);
