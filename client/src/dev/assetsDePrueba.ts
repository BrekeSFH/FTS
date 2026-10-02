/**
 * Carga automática de assets para probar.
 *
 * Abrir dos `.BOS` de cientos de megas y buscar un tile a mano en cada
 * prueba es mucha ceremonia. Si existe `public/dev/` —lo genera
 * `npm run assets-de-prueba` desde una instalación del juego— el cliente
 * aplica un piso, una pared y un personaje al arrancar.
 *
 * Es solo comodidad de desarrollo. Si la carpeta no está, esto no hace nada
 * y no se queja: en producción no existe, y el modelo BYOG exige que la
 * aplicación funcione igual sin ningún asset.
 */
import { loadSpriteAnimation, pickDirectionalAnimation } from '../iso/spriteset';
import { loadTile } from '../iso/tileset';
import { WALL_SUFFIXES, type WallSuffix } from '../iso/walls';
import type { PlacedTile, WallSet } from '../lobby/render';
import type { LobbyHandle } from '../lobby/ui';

const BASE = '/dev';

/** Qué entrada del juego salió en cada archivo, para poder decirlo. */
type Manifiesto = Record<string, string>;

async function bytesDe(nombre: string): Promise<Uint8Array> {
  const respuesta = await fetch(`${BASE}/${nombre}`);
  if (!respuesta.ok) throw new Error(`${nombre}: ${respuesta.status}`);
  return new Uint8Array(await respuesta.arrayBuffer());
}

export interface AssetsAplicados {
  piso?: string;
  pared?: string;
  personaje?: string;
}

/**
 * Aplica los assets de prueba si están. Devuelve qué aplicó, o `null` si no
 * hay carpeta de desarrollo.
 */
export async function aplicarAssetsDePrueba(lobby: LobbyHandle): Promise<AssetsAplicados | null> {
  let manifiesto: Manifiesto;
  try {
    const respuesta = await fetch(`${BASE}/manifiesto.json`);
    if (!respuesta.ok) return null;
    manifiesto = (await respuesta.json()) as Manifiesto;
  } catch {
    return null;
  }

  const aplicados: AssetsAplicados = {};

  // Cada uno por separado: que falte el personaje no debería dejar sin piso.
  try {
    const tile = await loadTile('dev#piso', await bytesDe('piso.til'));
    lobby.setFloor({ bitmap: tile.bitmap, anchorX: tile.anchorX, anchorY: tile.anchorY });
    aplicados.piso = manifiesto['piso.til'];
  } catch (err) {
    console.warn('No se pudo aplicar el piso de prueba', err);
  }

  try {
    const tile = await loadTile('dev#pared', await bytesDe('pared.til'));
    const fallback: PlacedTile = { bitmap: tile.bitmap, anchorX: tile.anchorX, anchorY: tile.anchorY };

    // Las orientaciones son opcionales: el script las extrae si existen, y
    // sin ellas la pared se dibuja igual pero siempre para el mismo lado.
    const faces: Partial<Record<WallSuffix, PlacedTile>> = {};
    for (const suffix of WALL_SUFFIXES) {
      const nombre = `pared_${suffix}.til`;
      if (!(nombre in manifiesto)) continue;
      try {
        const cara = await loadTile(`dev#${nombre}`, await bytesDe(nombre));
        faces[suffix] = { bitmap: cara.bitmap, anchorX: cara.anchorX, anchorY: cara.anchorY };
      } catch (err) {
        console.warn(`No se pudo aplicar ${nombre}`, err);
      }
    }

    const juego: WallSet = { faces, fallback };
    lobby.setWall(juego);
    aplicados.pared = manifiesto['pared.til'];
  } catch (err) {
    console.warn('No se pudo aplicar la pared de prueba', err);
  }

  try {
    const bytes = await bytesDe('personaje.spr');
    lobby.setCharacter(await loadSpriteAnimation('dev#personaje', bytes, pickDirectionalAnimation(bytes)));
    aplicados.personaje = manifiesto['personaje.spr'];
  } catch (err) {
    console.warn('No se pudo aplicar el personaje de prueba', err);
  }

  return aplicados;
}
