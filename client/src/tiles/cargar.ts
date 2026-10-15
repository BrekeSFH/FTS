/**
 * Arma el juego de tiles de un tablero a partir de un plan del catálogo.
 *
 * El plan sale de `tilesetPlans`, que es puro y depende solo de los nombres.
 * Acá se abren los archivos, porque hay cosas que el nombre no dice: si un
 * piso encaja exacto con el rombo o si una pared es lo bastante alta para
 * serlo. Esa comprobación también es determinista, así que dos jugadores con
 * la misma instalación y la misma semilla terminan con los mismos tiles.
 */
import { loadTile } from '../iso/tileset';
import type { PlacedTile, WallSet } from '../lobby/render';
import { WALL_SUFFIXES, familyPaths, type TilesetPlan, type WallSuffix } from './catalogo';

/** De dónde salen los bytes de un `.til`. `null` si no está. */
export type TileBytes = (path: string) => Promise<Uint8Array | null>;

export interface LoadedTileset {
  /** Conjunto del que salió todo, para poder decirlo. */
  set: string;
  floors: PlacedTile[];
  wall: WallSet;
  /** Pieza de esquina. `null` si el conjunto no tiene. */
  corner: WallSet | null;
}

/** Cuántos pisos distintos cargar: con uno solo el suelo se ve estampado. */
export const FLOOR_VARIANTS = 4;

/** Una pared más baja que esto es un remate o un borde, no un muro. */
const WALL_MIN_HEIGHT = 60;

const place = (tile: { bitmap: ImageBitmap; anchorX: number; anchorY: number }): PlacedTile => ({
  bitmap: tile.bitmap,
  anchorX: tile.anchorX,
  anchorY: tile.anchorY,
});

/**
 * Carga las caras de una familia. Devuelve `null` si le faltan las dos de
 * adelante, que son las únicas que se dibujan.
 */
async function loadFaces(
  family: string,
  source: TileBytes,
  prefix: string,
): Promise<WallSet | null> {
  const paths = familyPaths(family);
  const faces: Partial<Record<WallSuffix, PlacedTile>> = {};

  for (const suffix of WALL_SUFFIXES) {
    const bytes = await source(paths[suffix]);
    if (!bytes) continue;
    try {
      const tile = await loadTile(`${prefix}${paths[suffix]}`, bytes);
      if (tile.height >= WALL_MIN_HEIGHT) faces[suffix] = place(tile);
    } catch {
      // Un tile roto no debería tumbar la mazmorra entera.
    }
  }

  if (!faces.SE || !faces.SW) return null;
  return { faces, fallback: faces.SE };
}

/**
 * Prueba los planes en orden y devuelve el primero que se pueda armar.
 *
 * Que un plan falle es normal: el catálogo ordena por el nombre, y recién al
 * abrir los archivos se sabe si las piezas sirven. Por eso se devuelve una
 * lista de planes y no una elección.
 */
export async function loadTileset(
  plans: readonly TilesetPlan[],
  source: TileBytes,
  prefix = 'set#',
): Promise<LoadedTileset | null> {
  for (const plan of plans) {
    const floors: PlacedTile[] = [];
    for (const family of plan.floors) {
      if (floors.length >= FLOOR_VARIANTS) break;
      for (const path of Object.values(familyPaths(family))) {
        const bytes = await source(path);
        if (!bytes) continue;
        try {
          const tile = await loadTile(`${prefix}${path}`, bytes);
          // Un piso que no encaja con el paso del rombo deja costuras.
          if (tile.fitsGrid) {
            floors.push(place(tile));
            break;
          }
        } catch {
          // Igual que con las paredes: se sigue con el siguiente.
        }
      }
    }
    if (floors.length === 0) continue;

    let wall: WallSet | null = null;
    for (const family of plan.walls) {
      wall = await loadFaces(family, source, prefix);
      if (wall) break;
    }
    if (!wall) continue;

    let corner: WallSet | null = null;
    for (const family of plan.corners) {
      corner = await loadFaces(family, source, prefix);
      if (corner) break;
    }

    return { set: plan.set, floors, wall, corner };
  }
  return null;
}
