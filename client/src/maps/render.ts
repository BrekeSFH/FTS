/**
 * Dibuja un mapa `.mis` completo en un canvas.
 *
 * Es el primer uso de los mapas reales del juego y sirve de comprobación de
 * todo lo anterior junto: si el lector del `.mis`, el decodificador de `.TIL`
 * y la proyección isométrica no coinciden, se ve enseguida.
 *
 * Un mapa de 110 celdas de lado mide casi 8000×4000 píxeles, que son 125 MB
 * de canvas. Por eso se dibuja escalado: el contexto se achica y el canvas
 * queda de un tamaño razonable.
 */
import { gridBounds, placeTile } from '../iso/projection';
import { loadTile, type LoadedTile } from '../iso/tileset';
import type { World, WorldTile } from './world';

/** De dónde salen los bytes de un `.til`. `null` si no se encuentra. */
export type TileSource = (path: string) => Promise<Uint8Array | null>;

export interface DrawWorldOptions {
  /** Hasta qué altura dibujar. Por defecto, hasta el techo con contenido. */
  maxLevel?: number;
  /** Lado máximo del canvas, en píxeles. */
  maxSize?: number;
  /** Aviso de progreso, porque cargar cientos de tiles de un ZIP tarda. */
  onProgress?: (done: number, total: number) => void;
}

export interface DrawnWorld {
  maxLevel: number;
  /** Tiles dibujados. */
  drawn: number;
  /** Rutas que no se encontraron en los archivos abiertos. */
  missing: string[];
  scale: number;
  columns: number;
  rows: number;
}

const DEFAULT_MAX_SIZE = 2048;

/**
 * Hasta qué altura vale la pena dibujar.
 *
 * Un mapa bajo techo trae arriba de todo una capa de relleno: en `bunker01`
 * son 7225 copias de `Mountain_Floor_Stone_BLACK`, que tapan 2252 de las 2348
 * celdas con contenido. Es el techo, que el juego esconde cuando el jugador
 * entra; dibujarlo deja la pantalla negra.
 *
 * La diferencia es que una capa de relleno usa un solo tile repetido. Se corta
 * en la altura más alta que use más de uno. Si todas son de un solo tile
 * —un mapa chiquito, o uno de prueba— se dibuja todo, que es mejor que nada.
 */
export function contentCeiling(world: World): number {
  const distintos = new Map<number, Set<number>>();
  for (const tile of world.tiles) {
    const set = distintos.get(tile.level);
    if (set) set.add(tile.tile);
    else distintos.set(tile.level, new Set([tile.tile]));
  }
  const conContenido = [...distintos.entries()].filter(([, s]) => s.size > 1).map(([l]) => l);
  if (conContenido.length > 0) return Math.max(...conContenido);
  return world.levels.length > 0 ? Math.max(...world.levels) : 0;
}

/**
 * Orden de dibujo: primero lo que está más atrás; dentro de una celda, de
 * abajo hacia arriba, y a igualdad de altura por la capa que les dio el
 * editor.
 *
 * Es el algoritmo del pintor del lobby con dos desempates más. La altura
 * importa porque en una misma celda el piso está en 127 y la pared en 128, y
 * la pared tiene que ir después.
 */
export function worldDrawOrder(tiles: readonly WorldTile[]): WorldTile[] {
  return [...tiles].sort(
    (a, b) => a.x + a.y - (b.x + b.y) || a.level - b.level || a.layer - b.layer,
  );
}

/** Las celdas que ocupa un conjunto de tiles. */
function tileBounds(tiles: readonly WorldTile[]): World['bounds'] {
  if (tiles.length === 0) return null;
  let [minX, minY, maxX, maxY] = [tiles[0].x, tiles[0].y, tiles[0].x, tiles[0].y];
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x);
    maxY = Math.max(maxY, t.y);
  }
  return { minX, minY, maxX, maxY };
}

export async function drawWorldToCanvas(
  canvas: HTMLCanvasElement,
  world: World,
  source: TileSource,
  { maxLevel, maxSize = DEFAULT_MAX_SIZE, onProgress }: DrawWorldOptions = {},
): Promise<DrawnWorld> {
  const ceiling = maxLevel ?? contentCeiling(world);
  const tiles = worldDrawOrder(world.tiles.filter((t) => t.level <= ceiling));

  // La extensión se mide sobre lo que se va a dibujar, no sobre el mapa
  // entero: el techo abarca más que el interior, y usarlo dejaría el dibujo
  // apretado en una esquina del canvas.
  const bounds = tileBounds(tiles) ?? world.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const columns = bounds.maxX - bounds.minX + 1;
  const rows = bounds.maxY - bounds.minY + 1;
  // Las paredes y los objetos altos sobresalen bastante de su celda.
  const extent = gridBounds(columns, rows, { top: 160, left: 40 });
  const scale = Math.min(1, maxSize / Math.max(extent.width, extent.height));

  canvas.width = Math.max(1, Math.ceil(extent.width * scale));
  canvas.height = Math.max(1, Math.ceil(extent.height * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('El canvas no da contexto 2D');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#0c1014';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.translate(-extent.minX, -extent.minY);

  // Un mapa repite muchísimo el mismo tile; sin caché se descomprimiría el
  // mismo `.til` cientos de veces.
  const cache = new Map<string, LoadedTile | null>();
  const missing = new Set<string>();
  let drawn = 0;

  for (const [i, tile] of tiles.entries()) {
    const path = world.tilePaths[tile.tile - 1];
    let loaded = cache.get(path);
    if (loaded === undefined) {
      const bytes = await source(path);
      loaded = bytes ? await loadTile(`mis#${path}`, bytes) : null;
      cache.set(path, loaded);
      onProgress?.(cache.size, cache.size + 1);
    }
    if (!loaded) {
      missing.add(path);
      continue;
    }

    const pos = placeTile(tile.x - bounds.minX, tile.y - bounds.minY, loaded.anchorX, loaded.anchorY);
    context.drawImage(loaded.bitmap, pos.x, pos.y);
    drawn++;
    if (i % 500 === 0) onProgress?.(i, tiles.length);
  }

  return { maxLevel: ceiling, drawn, missing: [...missing], scale, columns, rows };
}
