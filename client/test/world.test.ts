/**
 * Tests del lector de `.mis` con mundos armados a mano.
 *
 * Los mapas de verdad se leen en `real-world.test.ts`, que necesita el juego
 * instalado. Esto cubre lo que un mapa real no puede provocar a pedido: una
 * cabecera rota, una tabla de rutas que no cierra, un índice fuera de rango.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_UNITS_PER_CELL, isWorld, readWorld } from '../src/maps/world';

const encoder = new TextEncoder();

function bytes(...partes: Array<Uint8Array | number[] | string>): Uint8Array {
  const trozos = partes.map((p) =>
    typeof p === 'string' ? encoder.encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p),
  );
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const t of trozos) {
    out.set(t, at);
    at += t.length;
  }
  return out;
}

const u32 = (...valores: number[]): Uint8Array => {
  const out = new Uint8Array(valores.length * 4);
  const view = new DataView(out.buffer);
  valores.forEach((v, i) => view.setUint32(i * 4, v >>> 0, true));
  return out;
};

const i32 = (...valores: number[]): Uint8Array => {
  const out = new Uint8Array(valores.length * 4);
  const view = new DataView(out.buffer);
  valores.forEach((v, i) => view.setInt32(i * 4, v, true));
  return out;
};

/** Una ruta con su largo delante, como las guarda el `<mapManager>`. */
const ruta = (texto: string) => bytes(u32(texto.length), texto);

interface RecordOpts {
  tile: number;
  layer?: number;
  x: number;
  y: number;
  z: number;
}

/** Un récord de 56 bytes de la grilla. */
function record({ tile, layer = 0, x, y, z }: RecordOpts): Uint8Array {
  return bytes(
    new Uint8Array([tile & 0xff, (tile >> 8) & 0xff, 0, layer]),
    u32(x, y, z, x + WORLD_UNITS_PER_CELL, y + 1, z + WORLD_UNITS_PER_CELL),
    i32(-37, -43, 38, -4),
    new Uint8Array(12),
  );
}

/** Arma el cuerpo sin comprimir de un mundo. */
function cuerpo(rutas: string[], regiones: Uint8Array[][]): Uint8Array {
  return bytes(
    '<mapManager>\0',
    '50\0',
    new Uint8Array(36),
    // Los 8 uint32: el séptimo es el tamaño de la tabla, uno más que las rutas.
    u32(0, 0, 0, 0, 0, 0, rutas.length + 1, 0),
    ...rutas.map(ruta),
    // Un descriptor <tile> cualquiera: el lector solo lo usa de marca de fin.
    '<tile>\0',
    '10\0',
    new Uint8Array(23),
    ...regiones.flatMap((records) => [bytes('<region>\0', '8\0', u32(records.length)), ...records]),
    // Lo que sigue a la cadena de regiones en un mapa real.
    '\0\0\0\0Defualt Group',
  );
}

/** Comprime como lo hace el juego y le pone la cabecera. */
async function mundo(body: Uint8Array, { version = '68', size = body.length } = {}): Promise<Uint8Array> {
  const stream = new Blob([body as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  const comprimido = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytes('<world>\0', `${version}\0`, u32(size, size), comprimido);
}

const UNA_RUTA = ['tiles/Generic tiles/Generic floors/Sand/piso.til'];

describe('isWorld', () => {
  it('reconoce la firma', async () => {
    expect(isWorld(await mundo(cuerpo(UNA_RUTA, [[]])))).toBe(true);
  });

  it('rechaza cualquier otra cosa', () => {
    expect(isWorld(encoder.encode('<tile>\0'))).toBe(false);
    expect(isWorld(encoder.encode('<world> sin NUL'))).toBe(false);
    expect(isWorld(new Uint8Array(0))).toBe(false);
  });
});

describe('readWorld', () => {
  it('lee la versión y la tabla de rutas', async () => {
    const world = await readWorld(await mundo(cuerpo(UNA_RUTA, [[]]), { version: '69' }));
    expect(world.version).toBe('69');
    expect(world.tilePaths).toEqual(UNA_RUTA);
    expect(world.regions).toBe(1);
  });

  it('convierte unidades de mundo a celdas', async () => {
    const world = await readWorld(
      await mundo(cuerpo(UNA_RUTA, [[record({ tile: 1, x: 60, y: 127, z: 120 })]])),
    );
    expect(world.tiles).toHaveLength(1);
    expect(world.tiles[0]).toMatchObject({ tile: 1, x: 10, y: 20, level: 127, aligned: true });
  });

  it('el índice es 1-based: el 0 es una celda sin tile', async () => {
    const world = await readWorld(
      await mundo(
        cuerpo(UNA_RUTA, [
          [record({ tile: 0, x: 0, y: 0, z: 0 }), record({ tile: 1, x: 6, y: 0, z: 0 })],
        ]),
      ),
    );
    expect(world.tiles).toHaveLength(1);
    expect(world.tilePaths[world.tiles[0].tile - 1]).toBe(UNA_RUTA[0]);
  });

  it('marca como suelto lo que no cae en la grilla', async () => {
    const world = await readWorld(
      await mundo(cuerpo(UNA_RUTA, [[record({ tile: 1, x: 61, y: 0, z: 120 })]])),
    );
    expect(world.tiles[0].aligned).toBe(false);
  });

  it('junta las alturas y la extensión', async () => {
    const world = await readWorld(
      await mundo(
        cuerpo(UNA_RUTA, [
          [
            record({ tile: 1, x: 12, y: 128, z: 6 }),
            record({ tile: 1, x: 60, y: 120, z: 36 }),
            record({ tile: 1, x: 0, y: 128, z: 18 }),
          ],
        ]),
      ),
    );
    expect(world.levels).toEqual([120, 128]);
    expect(world.bounds).toEqual({ minX: 0, minY: 1, maxX: 10, maxY: 6 });
  });

  it('recorre todas las regiones de la cadena', async () => {
    const world = await readWorld(
      await mundo(
        cuerpo(UNA_RUTA, [
          [record({ tile: 1, x: 0, y: 0, z: 0 })],
          [],
          [record({ tile: 1, x: 6, y: 0, z: 0 }), record({ tile: 1, x: 12, y: 0, z: 0 })],
        ]),
      ),
    );
    expect(world.regions).toBe(3);
    expect(world.tiles).toHaveLength(3);
  });

  it('guarda la capa y el rectángulo tal como vienen', async () => {
    const world = await readWorld(
      await mundo(cuerpo(UNA_RUTA, [[record({ tile: 1, layer: 4, x: 0, y: 0, z: 0 })]])),
    );
    expect(world.tiles[0].layer).toBe(4);
    expect(world.tiles[0].rect).toEqual({ left: -37, top: -43, right: 38, bottom: -4 });
  });

  it('se queja si no es un mundo', async () => {
    await expect(readWorld(encoder.encode('<tile>\0'))).rejects.toThrow('<world>');
  });

  it('se queja si los dos tamaños de la cabecera no coinciden', async () => {
    const body = cuerpo(UNA_RUTA, [[]]);
    const bueno = await mundo(body);
    const roto = new Uint8Array(bueno);
    new DataView(roto.buffer).setUint32(12, body.length + 1, true);
    await expect(readWorld(roto)).rejects.toThrow(/declara/);
  });

  it('se queja si la tabla declara más tiles de los que guarda', async () => {
    const body = cuerpo(UNA_RUTA, [[]]);
    // El séptimo uint32 del <mapManager> vive después de etiqueta, versión y
    // los 36 bytes de floats.
    const at = '<mapManager>\0'.length + '50\0'.length + 36 + 24;
    new DataView(body.buffer).setUint32(at, 99, true);
    await expect(readWorld(await mundo(body))).rejects.toThrow(/99/);
  });

  it('se queja si un récord apunta fuera de la tabla', async () => {
    await expect(
      readWorld(await mundo(cuerpo(UNA_RUTA, [[record({ tile: 7, x: 0, y: 0, z: 0 })]]))),
    ).rejects.toThrow(/7/);
  });
});
