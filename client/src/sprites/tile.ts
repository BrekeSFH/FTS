/**
 * Lector de tiles `.TIL` de Fallout Tactics.
 *
 * Un `.TIL` no trae un formato de imagen propio: es un envoltorio con metadatos
 * que contiene uno o más ZAR en su forma completa, la misma que describe
 * `zar.ts`. Deducido sobre los 29.957 `.TIL` de `tiles_0.bos`.
 *
 *   0x00   "<tile>"      firma
 *   0x06   00            constante
 *   0x07   uint8         versión; se vieron '9', '8', '7', '6' y 0x31
 *   0x08   …             campos de largo variable según la versión
 *   …      "<tiledata>"  arranca entre 0x1F y 0x22 según la versión
 *   +10    00 31 00      constante tras "<tiledata>"
 *   +13    uint32        cantidad de ZAR que siguen
 *   +17    ZAR           el primero, en forma completa
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
  /** Versión declarada en el byte 7. */
  version: number;
  /** Cuántos ZAR declara el envoltorio. Solo se decodifica el primero. */
  zarCount: number;
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

  return { ...decodeZar(bytes.subarray(zarAt)), version: bytes[7], zarCount };
}
