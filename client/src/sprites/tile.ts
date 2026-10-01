/**
 * Lector de tiles `.TIL` de Fallout Tactics.
 *
 * Un `.TIL` no trae un formato de imagen propio: es un envoltorio con metadatos
 * que contiene uno o más ZAR en su forma completa, la misma que describe
 * `zar.ts`. Deducido sobre los 29.957 `.TIL` de `tiles_0.bos`.
 *
 *   0x00   "<tile>"      firma
 *   0x06   00            constante
 *   0x07   cadena        versión terminada en NUL: "6", "7", "8", "9" o "10"
 *   +1     3 bytes       sin identificar
 *   +4     uint32 x4     ancla X, ancla Y, ancho y alto
 *   …      "<tiledata>"  arranca entre 0x1F y 0x22 según el largo de la versión
 *   +10    00 31 00      constante tras "<tiledata>"
 *   +13    uint32        cantidad de ZAR que siguen
 *   +17    ZAR           el primero, en forma completa
 *
 * El ancla es el punto de la imagen que se apoya en la celda, y es lo que
 * permite plantar una pared alta sobre el mismo rombo que un piso. Los
 * tamaños declarados coinciden con los del ZAR en 9840 de 9843 pisos y 9901
 * de 9907 paredes, que es lo que da confianza en el resto del parseo.
 *
 * La cabecera de `<tile>` cambia de largo con la versión, así que buscar el
 * ZAR por su firma es frágil: hay tiles cuyos píxeles contienen los bytes de
 * `<zar>`. El ancla confiable es `<tiledata>`, que en los 29.957 archivos
 * aparece dentro de los primeros 128 bytes.
 *
 * Qué falta: 154 de los 29.957 declaran más de un ZAR (hasta 11). Recorrerlos
 * necesita el tamaño exacto de cada uno, y el campo de tamaño del ZAR no es
 * confiable acá — 4.534 archivos lo traen con basura. Por ahora se decodifica
 * el primero y se expone `zarCount` para que quien llame sepa que hay más.
 */
import { decodeZar, type ZarImage } from './zar';

const TILE_MAGIC = '<tile>';
const TILEDATA_MAGIC = '<tiledata>';
/** Los 29.957 archivos reales lo tienen entre 0x1F y 0x22; el margen es holgado. */
const TILEDATA_SEARCH_LIMIT = 128;
/** "<tiledata>" + 00 31 00 + uint32 cantidad. */
const ZAR_OFFSET_FROM_TILEDATA = TILEDATA_MAGIC.length + 3 + 4;

export class InvalidTileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTileError';
  }
}

export interface TileImage extends ZarImage {
  /** Versión declarada en la cabecera: "6", "7", "8", "9" o "10". */
  version: string;
  /** Cuántos ZAR declara el envoltorio. Solo se decodifica el primero. */
  zarCount: number;
  /**
   * Punto de la imagen que se apoya en la celda. Dibujar el tile con su ancla
   * sobre el punto de referencia de la celda es lo que alinea un piso con una
   * pared que lo dobla en alto.
   */
  anchorX: number;
  anchorY: number;
  /** Tamaño que declara el envoltorio; debería coincidir con el del ZAR. */
  declaredWidth: number;
  declaredHeight: number;
}

function matchesAscii(bytes: Uint8Array, text: string, at: number): boolean {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export function isTile(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, TILE_MAGIC, 0);
}

/** Largo máximo razonable de la cadena de versión, como cota de la búsqueda. */
const MAX_VERSION_LENGTH = 8;

/**
 * Lee la versión y dice dónde arrancan los cuatro uint32 que la siguen.
 *
 * La versión es una cadena, no un byte: "10" corre todo lo que viene después
 * un lugar respecto de "9". Leerla como byte da 0x31 para "10" y desalinea
 * los campos.
 */
function readVersion(bytes: Uint8Array): { version: string; fieldsAt: number } {
  const start = TILE_MAGIC.length + 1;
  let end = start;
  while (end < start + MAX_VERSION_LENGTH && end < bytes.length && bytes[end] !== 0) end++;
  if (end >= bytes.length || bytes[end] !== 0) {
    throw new InvalidTileError('La versión del tile no termina en NUL');
  }
  let version = '';
  for (let i = start; i < end; i++) version += String.fromCharCode(bytes[i]);
  return { version, fieldsAt: end + 1 + 3 };
}

/** Ubica `<tiledata>` dentro de la cabecera. Devuelve -1 si no está. */
function findTiledata(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - TILEDATA_MAGIC.length, TILEDATA_SEARCH_LIMIT);
  for (let at = TILE_MAGIC.length; at <= limit; at++) {
    if (matchesAscii(bytes, TILEDATA_MAGIC, at)) return at;
  }
  return -1;
}

/**
 * Decodifica el primer ZAR de un tile.
 *
 * Los bytes vienen de archivos del usuario: todo lo que se lee se valida antes
 * de usarlo, y el decodificador de ZAR se encarga del resto.
 */
export function decodeTile(bytes: Uint8Array): TileImage {
  if (!isTile(bytes)) throw new InvalidTileError('El archivo no empieza con la firma <tile>');

  // Se parsea en el orden del archivo: la versión viene antes que <tiledata>
  // y de su largo depende dónde caen los cuatro campos.
  const { version, fieldsAt } = readVersion(bytes);
  if (fieldsAt + 16 > bytes.length) throw new InvalidTileError('El tile se corta en la cabecera');

  const tiledata = findTiledata(bytes);
  if (tiledata < 0) {
    throw new InvalidTileError('No se encontró <tiledata> en la cabecera del tile');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const countAt = tiledata + TILEDATA_MAGIC.length + 3;
  if (countAt + 4 > bytes.length) throw new InvalidTileError('El tile se corta antes de la cantidad de ZAR');
  const zarCount = view.getUint32(countAt, true);

  const zarAt = tiledata + ZAR_OFFSET_FROM_TILEDATA;
  if (zarAt >= bytes.length) throw new InvalidTileError('El tile se corta antes del primer ZAR');

  return {
    ...decodeZar(bytes.subarray(zarAt)),
    version,
    zarCount,
    anchorX: view.getUint32(fieldsAt, true),
    anchorY: view.getUint32(fieldsAt + 4, true),
    declaredWidth: view.getUint32(fieldsAt + 8, true),
    declaredHeight: view.getUint32(fieldsAt + 12, true),
  };
}
