/**
 * Tests del cargador de juegos de tiles.
 *
 * Decodificar un `.til` de verdad necesita `ImageBitmap`, que no existe en
 * Node, así que lo que se comprueba acá es la lógica de elección: qué planes
 * se prueban, en qué orden y con qué se cae a uno sin esquina. Que los tiles
 * se dibujen bien ya lo cubren `tile.test.ts` y el navegador.
 */
import { describe, expect, it, vi } from 'vitest';
import { FLOOR_VARIANTS, loadTileset } from '../src/tiles/cargar';
import type { TilesetPlan } from '../src/tiles/catalogo';

/**
 * `loadTile` vive en `iso/tileset` y necesita un navegador. Se reemplaza por
 * uno que decide por el nombre: así el test habla de elección y no de píxeles.
 */
vi.mock('../src/iso/tileset', () => ({
  loadTile: async (_key: string, bytes: Uint8Array) => ({
    bitmap: {} as ImageBitmap,
    width: 73,
    height: bytes[0],
    anchorX: 36,
    anchorY: 43,
    fitsGrid: bytes[1] === 1,
  }),
}));

/** Un tile falso: el primer byte es el alto y el segundo si encaja. */
const tile = (height: number, fitsGrid: boolean) => new Uint8Array([height, fitsGrid ? 1 : 0]);

const PISO = tile(37, true);
const PISO_QUE_NO_ENCAJA = tile(37, false);
const PARED = tile(110, false);
const PARED_BAJA = tile(20, false);

/** Un origen de bytes a partir de un mapa de rutas. */
const origen = (archivos: Record<string, Uint8Array>) => async (path: string) =>
  archivos[path] ?? null;

const plan = (extra: Partial<TilesetPlan> = {}): TilesetPlan => ({
  set: 'A',
  floors: ['x/A_Floor_M_PlateCentre_A_1'],
  walls: ['x/A_Wall_M_Plain_A_1'],
  corners: [],
  ...extra,
});

/** Las cuatro caras de una familia con los mismos bytes. */
const caras = (familia: string, bytes: Uint8Array) =>
  Object.fromEntries(['NE', 'NW', 'SE', 'SW'].map((s) => [`${familia}_${s}.til`, bytes]));

describe('loadTileset', () => {
  it('arma el juego con el primer plan que sirve', async () => {
    const juego = await loadTileset(
      [plan()],
      origen({
        ...caras('x/A_Floor_M_PlateCentre_A_1', PISO),
        ...caras('x/A_Wall_M_Plain_A_1', PARED),
      }),
    );
    expect(juego?.set).toBe('A');
    expect(juego?.floors).toHaveLength(1);
    expect(juego?.corner).toBeNull();
  });

  it('descarta el piso que no encaja con el rombo', async () => {
    const juego = await loadTileset(
      [plan({ floors: ['x/A_Floor_M_Borde_A_1', 'x/A_Floor_M_PlateCentre_A_1'] })],
      origen({
        ...caras('x/A_Floor_M_Borde_A_1', PISO_QUE_NO_ENCAJA),
        ...caras('x/A_Floor_M_PlateCentre_A_1', PISO),
        ...caras('x/A_Wall_M_Plain_A_1', PARED),
      }),
    );
    expect(juego?.floors).toHaveLength(1);
  });

  it('no carga más variantes de piso que las que hacen falta', async () => {
    const familias = Array.from({ length: 10 }, (_, i) => `x/A_Floor_M_PlateCentre_A_${i}`);
    const archivos: Record<string, Uint8Array> = { ...caras('x/A_Wall_M_Plain_A_1', PARED) };
    for (const f of familias) Object.assign(archivos, caras(f, PISO));

    const juego = await loadTileset([plan({ floors: familias })], origen(archivos));
    expect(juego?.floors).toHaveLength(FLOOR_VARIANTS);
  });

  it('descarta la pared demasiado baja', async () => {
    const juego = await loadTileset(
      [plan({ walls: ['x/A_Wall_M_Remate_A_1', 'x/A_Wall_M_Plain_A_1'] })],
      origen({
        ...caras('x/A_Floor_M_PlateCentre_A_1', PISO),
        ...caras('x/A_Wall_M_Remate_A_1', PARED_BAJA),
        ...caras('x/A_Wall_M_Plain_A_1', PARED),
      }),
    );
    expect(juego).not.toBeNull();
  });

  it('una pared sin las dos caras de adelante no sirve', async () => {
    const soloNorte = {
      'x/A_Wall_M_Plain_A_1_NE.til': PARED,
      'x/A_Wall_M_Plain_A_1_NW.til': PARED,
    };
    const juego = await loadTileset(
      [plan()],
      origen({ ...caras('x/A_Floor_M_PlateCentre_A_1', PISO), ...soloNorte }),
    );
    expect(juego).toBeNull();
  });

  it('carga la esquina cuando el plan la trae', async () => {
    const juego = await loadTileset(
      [plan({ corners: ['x/A_Wall_M_PlainCORNER_A_1'] })],
      origen({
        ...caras('x/A_Floor_M_PlateCentre_A_1', PISO),
        ...caras('x/A_Wall_M_Plain_A_1', PARED),
        ...caras('x/A_Wall_M_PlainCORNER_A_1', PARED),
      }),
    );
    expect(juego?.corner).not.toBeNull();
  });

  it('sigue con el plan siguiente si el primero no se puede armar', async () => {
    const juego = await loadTileset(
      [plan({ set: 'Vacío', floors: ['x/V_Floor_M_X_A_1'], walls: ['x/V_Wall_M_X_A_1'] }), plan()],
      origen({
        ...caras('x/A_Floor_M_PlateCentre_A_1', PISO),
        ...caras('x/A_Wall_M_Plain_A_1', PARED),
      }),
    );
    expect(juego?.set).toBe('A');
  });

  it('sin planes que sirvan devuelve null', async () => {
    expect(await loadTileset([], origen({}))).toBeNull();
    expect(await loadTileset([plan()], origen({}))).toBeNull();
  });
});
