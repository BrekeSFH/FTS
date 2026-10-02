/**
 * Lector de `.mis`: los mapas de Fallout Tactics.
 *
 * Como el resto de los formatos del juego, no está documentado en ningún
 * lado. Lo que sigue salió de leer los 103 mapas de una instalación y quedarse
 * solo con lo que vale en todos.
 *
 * La cáscara repite el patrón de los `.TIL` y los `.SPR`: etiqueta, cadena de
 * versión y un bloque zlib. Adentro hay varias secciones etiquetadas igual, de
 * las que acá solo interesan dos.
 *
 *   <world>\0 "68"\0 uint32 tamaño uint32 tamaño  flujo zlib
 *     <mph>          equipos
 *     <mapManager>   9 floats de luz, 8 uint32 y la tabla de rutas `.til`
 *     <tile> × N     las cabeceras de esos tiles, cacheadas en el mapa
 *     <region> × 100 la grilla, repartida en una malla de 10×10
 *     ...            entidades, disparadores, sonido
 *
 * El séptimo uint32 del `<mapManager>` es el tamaño de la tabla de tiles, y
 * las rutas guardadas son una menos: **el índice 0 significa "sin tile"**. Por
 * eso un récord con índice 1 apunta a `tilePaths[0]`.
 *
 * Cada región trae una cuenta y después esa cantidad de récords de 56 bytes.
 * Las regiones vacías tienen cuenta cero y ocupan 15 bytes.
 *
 * Cuántas regiones hay cambia según el mapa: se vieron 15, 16, 24, 30, 36,
 * 60, 64 y 100. Por eso la cadena se recorre mientras aparezca la etiqueta en
 * vez de leer una cantidad fija. Que eso no se coma nada se comprobó
 * contando las marcas `<region>` de todo el cuerpo: en los mapas que cortan
 * antes no hay ninguna después del corte, y lo que sigue es la sección de
 * entidades.
 */
import { inflate } from '../formats/inflate';

export const WORLD_MAGIC = '<world>';

/**
 * Cuántas unidades de mundo mide una celda.
 *
 * Las cajas de los tiles de terreno caen siempre en múltiplos de 6. Los
 * objetos sueltos no: el editor los deja poner a mano entre celdas.
 */
export const WORLD_UNITS_PER_CELL = 6;

/** Bytes de cada récord de la grilla. */
const RECORD_SIZE = 56;

const REGION_MAGIC = '<region>';
const MAP_MANAGER_MAGIC = '<mapManager>';
const TILE_MAGIC = '<tile>';

export class InvalidWorldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWorldError';
  }
}

/** Un tile plantado en el mapa. */
export interface WorldTile {
  /** Índice en `tilePaths`. Los récords vacíos no llegan acá. */
  tile: number;
  /** Celda de la esquina mínima de su caja. */
  x: number;
  y: number;
  /** Altura, en unidades de mundo. Es lo que separa los pisos de un edificio. */
  level: number;
  /**
   * Capa en la que lo puso el editor, 0 a 10. Correlaciona con el tipo de
   * tile pero no se encontró una regla que valga en los 103 mapas, así que se
   * expone en crudo en vez de inventarle un significado.
   */
  layer: number;
  /**
   * Caja del dibujo en pantalla, relativa al punto de apoyo de la celda.
   *
   * La trae el archivo y sirve de control: tiene que coincidir con lo que da
   * la proyección isométrica propia. Dos hechos del mismo archivo que se
   * contradicen avisan de un offset mal leído mucho antes que una imagen rara.
   */
  rect: { left: number; top: number; right: number; bottom: number };
  /** Si su caja cae justo en la grilla. Los objetos sueltos no. */
  aligned: boolean;
}

export interface World {
  version: string;
  /** Las rutas `.til` que usa el mapa, en el orden del archivo. */
  tilePaths: string[];
  tiles: WorldTile[];
  /** Celdas ocupadas. Vacío si el mapa no tiene ningún tile. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Las alturas distintas que aparecen, de menor a mayor. */
  levels: number[];
  /** Cuántas regiones trae la malla. */
  regions: number;
}

function matchesAscii(bytes: Uint8Array, text: string, at: number): boolean {
  if (at < 0 || at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** Lee una cadena terminada en NUL y devuelve dónde sigue. */
function readCString(bytes: Uint8Array, at: number): { value: string; next: number } {
  let end = at;
  while (end < bytes.length && bytes[end] !== 0) end++;
  if (end >= bytes.length) throw new InvalidWorldError(`Cadena sin terminar en 0x${at.toString(16)}`);
  return { value: new TextDecoder('latin1').decode(bytes.subarray(at, end)), next: end + 1 };
}

/** Si los bytes arrancan como un `.mis`. */
export function isWorld(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, WORLD_MAGIC, 0) && bytes[WORLD_MAGIC.length] === 0;
}

/** Busca una etiqueta `<algo>\0` desde una posición. */
function findMagic(bytes: Uint8Array, magic: string, from: number): number {
  for (let i = from; i + magic.length < bytes.length; i++) {
    if (matchesAscii(bytes, magic, i) && bytes[i + magic.length] === 0) return i;
  }
  return -1;
}

/** La tabla de rutas `.til` del `<mapManager>`, y dónde termina. */
function readTilePaths(body: Uint8Array): { paths: string[]; end: number } {
  const at = findMagic(body, MAP_MANAGER_MAGIC, 0);
  if (at < 0) throw new InvalidWorldError('No hay <mapManager>');

  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  // Etiqueta, versión, 9 floats de iluminación y 8 uint32 con la caja del
  // mundo. Solo hace falta el séptimo, que es el tamaño de la tabla.
  let off = readCString(body, at + MAP_MANAGER_MAGIC.length + 1).next + 36;
  const declared = view.getUint32(off + 24, true);
  off += 32;

  // La tabla termina justo donde empieza el primer descriptor <tile>. Que
  // caiga exacto es la comprobación de que los 32 bytes de cabecera estaban
  // bien contados.
  const stop = findMagic(body, TILE_MAGIC, off);
  if (stop < 0) throw new InvalidWorldError('No hay descriptores <tile>');

  const paths: string[] = [];
  while (off < stop) {
    const length = view.getUint32(off, true);
    if (length === 0 || off + 4 + length > stop) {
      throw new InvalidWorldError(`Ruta de largo ${length} en 0x${off.toString(16)}`);
    }
    paths.push(new TextDecoder('latin1').decode(body.subarray(off + 4, off + 4 + length)));
    off += 4 + length;
  }
  if (off !== stop) throw new InvalidWorldError('La tabla de rutas no cierra donde empiezan los <tile>');
  if (paths.length + 1 !== declared) {
    throw new InvalidWorldError(`El mapa declara ${declared} tiles y guarda ${paths.length} rutas`);
  }
  return { paths, end: stop };
}

/** Recorre la cadena de regiones y junta los tiles plantados. */
function readRegions(body: Uint8Array, from: number, pathCount: number) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let off = findMagic(body, REGION_MAGIC, from);
  if (off < 0) throw new InvalidWorldError('No hay regiones');

  const tiles: WorldTile[] = [];
  const levels = new Set<number>();
  let regions = 0;

  while (matchesAscii(body, REGION_MAGIC, off) && body[off + REGION_MAGIC.length] === 0) {
    // Etiqueta, versión y la cantidad de récords.
    off = readCString(body, off + REGION_MAGIC.length + 1).next;
    const count = view.getUint32(off, true);
    off += 4;
    if (off + count * RECORD_SIZE > body.length) {
      throw new InvalidWorldError(`La región ${regions} declara ${count} récords y no entran`);
    }

    for (let i = 0; i < count; i++) {
      const tile = view.getUint16(off, true);
      const layer = body[off + 3];
      const x0 = view.getUint32(off + 4, true);
      const y0 = view.getUint32(off + 8, true);
      const z0 = view.getUint32(off + 12, true);
      off += RECORD_SIZE;

      // El índice 0 es "sin tile": la celda está declarada pero vacía.
      if (tile === 0) continue;
      if (tile > pathCount) {
        throw new InvalidWorldError(`Índice de tile ${tile} con solo ${pathCount} rutas`);
      }

      levels.add(y0);
      tiles.push({
        tile,
        x: Math.floor(x0 / WORLD_UNITS_PER_CELL),
        y: Math.floor(z0 / WORLD_UNITS_PER_CELL),
        level: y0,
        layer,
        rect: {
          left: view.getInt32(off - 28, true),
          top: view.getInt32(off - 24, true),
          right: view.getInt32(off - 20, true),
          bottom: view.getInt32(off - 16, true),
        },
        aligned: x0 % WORLD_UNITS_PER_CELL === 0 && z0 % WORLD_UNITS_PER_CELL === 0,
      });
    }
    regions++;
  }

  return { tiles, levels: [...levels].sort((a, b) => a - b), regions };
}

/**
 * Lee un `.mis`.
 *
 * Es `async` porque el bloque va comprimido y el inflado del navegador lo es.
 */
export async function readWorld(bytes: Uint8Array): Promise<World> {
  if (!isWorld(bytes)) throw new InvalidWorldError('No empieza con <world>');

  const { value: version, next } = readCString(bytes, WORLD_MAGIC.length + 1);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(next, true);
  const repeated = view.getUint32(next + 4, true);
  // El tamaño viene dos veces. No se sabe para qué, pero si difirieran sería
  // señal de que la cabecera no es la que se cree.
  if (size !== repeated) {
    throw new InvalidWorldError(`La cabecera declara ${size} y ${repeated}`);
  }

  const body = await inflate(bytes.subarray(next + 8), size);
  const { paths, end } = readTilePaths(body);
  const { tiles, levels, regions } = readRegions(body, end, paths.length);

  let bounds: World['bounds'] = null;
  for (const t of tiles) {
    if (!bounds) bounds = { minX: t.x, minY: t.y, maxX: t.x, maxY: t.y };
    else {
      bounds.minX = Math.min(bounds.minX, t.x);
      bounds.minY = Math.min(bounds.minY, t.y);
      bounds.maxX = Math.max(bounds.maxX, t.x);
      bounds.maxY = Math.max(bounds.maxY, t.y);
    }
  }

  return { version, tilePaths: paths, tiles, bounds, levels, regions };
}
