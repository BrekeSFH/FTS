/**
 * Puente entre los `.TIL` del `.BOS` del usuario y el render isométrico.
 *
 * Decodificar un tile cuesta, y el piso del lobby repite el mismo cientos de
 * veces por cuadro, así que se decodifica una vez a `ImageBitmap` y se
 * cachea. El caché vive en memoria: persistirlo en IndexedDB, como sugiere el
 * GDD, es otro paso y todavía no hace falta.
 */
import { decodeTile } from '../sprites/tile';
import { TILE_HEIGHT, TILE_WIDTH } from './projection';

/** Medida que encaja exacto con el paso: el rombo más un píxel de solape. */
export const FLOOR_TILE_WIDTH = TILE_WIDTH + 1;
export const FLOOR_TILE_HEIGHT = TILE_HEIGHT + 1;

export interface LoadedTile {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Punto de la imagen que se apoya en la celda. */
  anchorX: number;
  anchorY: number;
  /** Si no encaja con el paso del rombo, un piso va a quedar con costuras. */
  fitsGrid: boolean;
}

const cache = new Map<string, LoadedTile>();

export function tileFitsGrid(width: number, height: number): boolean {
  return width === FLOOR_TILE_WIDTH && height === FLOOR_TILE_HEIGHT;
}

/**
 * Decodifica un `.TIL` y lo deja listo para dibujar. `key` identifica al tile
 * en el caché; usar la ruta dentro del `.BOS` alcanza.
 */
export async function loadTile(key: string, bytes: Uint8Array): Promise<LoadedTile> {
  const cached = cache.get(key);
  if (cached) return cached;

  const image = decodeTile(bytes);
  const bitmap = await createImageBitmap(new ImageData(image.pixels, image.width, image.height));
  const loaded: LoadedTile = {
    bitmap,
    width: image.width,
    height: image.height,
    anchorX: image.anchorX,
    anchorY: image.anchorY,
    fitsGrid: tileFitsGrid(image.width, image.height),
  };
  cache.set(key, loaded);
  return loaded;
}

/** Suelta los bitmaps cacheados. Se usa al cerrar un `.BOS`. */
export function clearTileCache(): void {
  for (const tile of cache.values()) tile.bitmap.close();
  cache.clear();
}
