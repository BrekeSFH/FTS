/**
 * Lee los 103 mapas de una instalación real de Fallout Tactics.
 * Se saltea si FT_CORE no apunta a la carpeta `core` del juego.
 *
 * El `.mis` no está documentado y lo que se asume de él solo vale si vale en
 * todos: un lector que anda con un mapa y se rompe con el siguiente no sirve
 * para cargar mazmorras de verdad.
 */
import { openAsBlob } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { WORLD_UNITS_PER_CELL, isWorld, readWorld } from '../src/maps/world';

const CORE = process.env.FT_CORE ?? '';

/** Todas las entradas `.mis` de todos los `.bos` de misiones. */
async function missionEntries(): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const archives = (await readdir(CORE)).filter(
    (f) => f.toLowerCase().endsWith('.bos') && f.toLowerCase().includes('mis'),
  );
  const out: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const archive of archives) {
    const blob = await openAsBlob(join(CORE, archive));
    const reader = new ZipReader(new BlobReader(blob as unknown as Blob), { useWebWorkers: false });
    const entries = (await reader.getEntries()).filter(
      (e): e is FileEntry => !e.directory && e.filename.toLowerCase().endsWith('.mis'),
    );
    for (const entry of entries) {
      out.push({ name: `${archive}!${entry.filename}`, bytes: await entry.getData(new Uint8ArrayWriter()) });
    }
    await reader.close();
  }
  return out;
}

describe('mapas reales', () => {
  it.runIf(CORE)(
    'lee todos los .mis del juego',
    async () => {
      const missions = await missionEntries();
      expect(missions.length).toBeGreaterThan(90);

      const problems: string[] = [];
      const versions = new Map<string, number>();
      let totalTiles = 0;
      let alignedTiles = 0;
      let multiLevel = 0;
      const regionCounts = new Set<number>();

      for (const mission of missions) {
        if (!isWorld(mission.bytes)) {
          problems.push(`${mission.name}: no tiene firma <world>`);
          continue;
        }
        try {
          const world = await readWorld(mission.bytes);
          versions.set(world.version, (versions.get(world.version) ?? 0) + 1);
          regionCounts.add(world.regions);
          if (world.levels.length > 1) multiLevel++;

          if (world.tilePaths.length === 0) problems.push(`${mission.name}: sin rutas de tiles`);
          if (world.tiles.length === 0) problems.push(`${mission.name}: sin tiles plantados`);
          if (!world.bounds) problems.push(`${mission.name}: sin extensión`);

          for (const tile of world.tiles) {
            totalTiles++;
            if (tile.aligned) alignedTiles++;
            if (tile.tile < 1 || tile.tile > world.tilePaths.length) {
              problems.push(`${mission.name}: índice ${tile.tile} fuera de la tabla`);
              break;
            }
          }
        } catch (err) {
          problems.push(`${mission.name}: ${(err as Error).message}`);
        }
      }

      expect(problems.slice(0, 10)).toEqual([]);
      expect(totalTiles).toBeGreaterThan(1_000_000);
      // Los tiles de terreno caen en la grilla; los objetos sueltos, no. Que
      // la mayoría esté alineada es lo que permite usarlos como mazmorra.
      expect(alignedTiles / totalTiles).toBeGreaterThan(0.7);
      expect(multiLevel).toBeGreaterThan(0);
      // La malla de regiones no es de tamaño fijo. Lo que sí tiene que pasar
      // es que todos los mapas traigan varias y que ninguno quede en cero.
      expect(Math.min(...regionCounts)).toBeGreaterThanOrEqual(15);
      expect(regionCounts.size).toBeGreaterThan(1);
      expect([...versions.keys()].sort()).toEqual(['68', '69']);
    },
    120_000,
  );

  it.runIf(CORE)('las rutas apuntan a tiles que existen', async () => {
    const blob = await openAsBlob(join(CORE, 'tiles_0.bos'));
    const reader = new ZipReader(new BlobReader(blob as unknown as Blob), { useWebWorkers: false });
    const existentes = new Set(
      (await reader.getEntries()).map((e) => e.filename.toLowerCase().replace(/\\/g, '/')),
    );
    await reader.close();

    const missions = await missionEntries();
    let revisadas = 0;
    const faltantes: string[] = [];
    // Alcanza con una muestra: si las rutas se leyeran mal, fallarían todas.
    for (const mission of missions.slice(0, 12)) {
      const world = await readWorld(mission.bytes);
      for (const path of world.tilePaths) {
        revisadas++;
        if (!existentes.has(path.toLowerCase().replace(/\\/g, '/'))) faltantes.push(path);
      }
    }
    expect(revisadas).toBeGreaterThan(1000);
    expect(faltantes.slice(0, 5)).toEqual([]);
  }, 60_000);

  it.runIf(CORE)('el rectángulo del archivo coincide con la proyección propia', async () => {
    // Control cruzado: el `.mis` trae la caja en pantalla de cada tile. Si el
    // ancho de celda fuera otro, o el alto, las dos cuentas se separarían.
    const missions = await missionEntries();
    const world = await readWorld(missions[0].bytes);
    const alineados = world.tiles.filter((t) => t.aligned);
    expect(alineados.length).toBeGreaterThan(100);

    const anchos = new Set(alineados.map((t) => t.rect.right - t.rect.left));
    const altos = new Set(alineados.map((t) => t.rect.bottom - t.rect.top));
    // Un tile de piso ocupa el rombo de 72×36 más un píxel de sangrado.
    expect(Math.min(...anchos)).toBeGreaterThanOrEqual(1);
    expect([...anchos]).toContain(75);
    expect([...altos]).toContain(39);
    expect(WORLD_UNITS_PER_CELL).toBe(6);
  }, 60_000);
});
