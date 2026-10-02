/**
 * Catálogo de los tiles del juego.
 *
 * Los nombres de archivo de Fallout Tactics son rigurosamente regulares:
 * 29.950 de los 29.957 `.til` de una instalación tienen exactamente siete
 * campos separados por guión bajo.
 *
 *   BOS_Wall_Metal_InteriorPlainB&D_X_1_NE.til
 *   │   │    │     │                │ │ └ orientación
 *   │   │    │     │                │ └── número
 *   │   │    │     │                └──── variante
 *   │   │    │     └─────────────────────  nombre
 *   │   │    └───────────────────────────  material
 *   │   └────────────────────────────────  rol
 *   └────────────────────────────────────  conjunto
 *
 * El rol sale del segundo campo: Floor 9431, Object 8961, Wall 8636, Cap
 * 1496, Roof 964, Stair 242, Step 96.
 *
 * Esto alcanza para armar una mazmorra con piezas del juego en vez de repetir
 * un piso y una pared. Lo que no se puede saber por el nombre —si un piso
 * encaja exacto con el rombo— lo comprueba quien lo use, abriendo el archivo.
 */
/**
 * Las cuatro orientaciones que un tile declara al final del nombre.
 *
 * Viven acá y no en `iso/walls.ts` porque son parte del nombre del archivo,
 * que es de lo que trata este módulo; `walls.ts` decide cuál de las cuatro
 * va en cada celda, que es otra cosa.
 */
export const WALL_SUFFIXES = ['NE', 'NW', 'SE', 'SW'] as const;
export type WallSuffix = (typeof WALL_SUFFIXES)[number];

export type TileRole = 'floor' | 'wall' | 'corner' | 'object' | 'cap' | 'roof' | 'stair' | 'other';

export interface ParsedTile {
  path: string;
  /** La ruta sin la orientación: las cuatro caras comparten familia. */
  family: string;
  /** Conjunto al que pertenece, que es con lo que se arma un tema coherente. */
  set: string;
  role: TileRole;
  material: string;
  name: string;
  variant: string;
  number: string;
  orientation: WallSuffix | null;
}

/** Lo que distingue una pared recta de un remate o de una abertura. */
const NO_ES_MURO = /end|door|window|gate|stair|hand|rail|fence/;

/** Un piso con esto en el nombre cubre la celda entera, no un borde. */
const PISO_LLENO = /centre|center/;

const ROLES: Record<string, TileRole> = {
  floor: 'floor',
  wall: 'wall',
  object: 'object',
  cap: 'cap',
  roof: 'roof',
  stair: 'stair',
  step: 'stair',
};

/**
 * Lee la ruta de un `.til`. Devuelve `null` si no sigue el patrón de siete
 * campos: son siete archivos en toda una instalación, y no vale la pena
 * adivinarles nada.
 */
export function parseTile(path: string): ParsedTile | null {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const file = path.slice(slash + 1);
  if (!/\.til$/i.test(file)) return null;

  const fields = file.slice(0, -4).split('_');
  if (fields.length !== 7) return null;

  const [set, rawRole, material, name, variant, number, rawOrientation] = fields;
  const orientation = WALL_SUFFIXES.find((s) => s === rawOrientation.toUpperCase()) ?? null;

  let role = ROLES[rawRole.toLowerCase()] ?? 'other';
  // Una esquina es una pared, pero no sirve para un tramo recto y al revés
  // tampoco: conviene que sea un rol aparte desde el principio.
  if (role === 'wall' && /corner/i.test(name)) role = 'corner';

  return {
    path,
    family: orientation ? path.slice(0, path.length - rawOrientation.length - 5) : path,
    set,
    role,
    material,
    name,
    variant,
    number,
    orientation,
  };
}

/** Las piezas de un conjunto que sirven para armar una mazmorra. */
export interface SetCandidates {
  set: string;
  /** Familias de piso, las que cubren la celda entera primero. */
  floors: string[];
  /** Familias de pared recta. Las aberturas y los remates quedan afuera. */
  walls: string[];
  /** Familias de esquina. Puede estar vacío: no todos los conjuntos traen. */
  corners: string[];
}

/** Cuántas de las tres clases de pieza tiene un conjunto. */
export function completeness(candidates: SetCandidates): number {
  return (
    (candidates.floors.length > 0 ? 1 : 0) +
    (candidates.walls.length > 0 ? 1 : 0) +
    (candidates.corners.length > 0 ? 1 : 0)
  );
}

/**
 * Agrupa las rutas por conjunto y deja las familias que sirven.
 *
 * Se ordena en vez de filtrar: un conjunto al que le falte la pieza ideal
 * igual sirve con la que tenga, y el que la tenga la va a ofrecer primero.
 * Los conjuntos salen de más completo a menos, y a igualdad, por el que más
 * piezas tiene.
 */
export function groupBySet(paths: readonly string[]): SetCandidates[] {
  const porSet = new Map<string, { floors: Set<string>; walls: Set<string>; corners: Set<string> }>();
  const llenos = new Set<string>();

  for (const path of paths) {
    const tile = parseTile(path);
    if (!tile) continue;
    if (tile.role !== 'floor' && tile.role !== 'wall' && tile.role !== 'corner') continue;

    let entry = porSet.get(tile.set);
    if (!entry) {
      entry = { floors: new Set(), walls: new Set(), corners: new Set() };
      porSet.set(tile.set, entry);
    }

    if (tile.role === 'floor') {
      entry.floors.add(tile.family);
      if (PISO_LLENO.test(tile.name)) llenos.add(tile.family);
    } else if (tile.role === 'corner') {
      entry.corners.add(tile.family);
    } else if (!NO_ES_MURO.test(tile.name.toLowerCase())) {
      entry.walls.add(tile.family);
    }
  }

  // Los pisos que cubren la celda entera van primero; el resto, alfabético,
  // para que el resultado no dependa del orden del archivo.
  const ordenar = (familias: Set<string>, prioridad?: Set<string>): string[] =>
    [...familias].sort((a, b) => {
      if (prioridad) {
        const pa = prioridad.has(a) ? 0 : 1;
        const pb = prioridad.has(b) ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });

  const sets = [...porSet.entries()].map(([set, e]) => ({
    set,
    floors: ordenar(e.floors, llenos),
    walls: ordenar(e.walls),
    corners: ordenar(e.corners),
  }));

  return sets.sort(
    (a, b) =>
      completeness(b) - completeness(a) ||
      b.floors.length + b.walls.length + b.corners.length -
        (a.floors.length + a.walls.length + a.corners.length) ||
      (a.set < b.set ? -1 : 1),
  );
}

/** Las cuatro rutas de una familia, estén o no todas en el archivo. */
export function familyPaths(family: string): Record<WallSuffix, string> {
  const out = {} as Record<WallSuffix, string>;
  for (const suffix of WALL_SUFFIXES) out[suffix] = `${family}_${suffix}.til`;
  return out;
}
