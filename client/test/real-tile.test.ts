/**
 * Decodifica todos los .TIL de una instalación real de Fallout Tactics.
 * Se saltea si FT_CORE no apunta a la carpeta `core` del juego.
 */
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { decodeTile, isTile } from '../src/sprites/tile';

const CORE = process.env.FT_CORE ?? '';

describe('tiles reales', () => {
  it.runIf(CORE)('decodifica todos los .til de tiles_0.bos', async () => {
    const blob = await openAsBlob(join(CORE, 'tiles_0.bos'));
    const reader = new ZipReader(new BlobReader(blob as unknown as Blob), { useWebWorkers: false });
    const entries = (await reader.getEntries()).filter(
      (e): e is FileEntry => !e.directory && e.filename.toLowerCase().endsWith('.til'),
    );
    expect(entries.length).toBeGreaterThan(1000);

    const problems: string[] = [];
    const versions = new Map<number, number>();
    let multiZar = 0;
    let totalPixels = 0;

    for (const entry of entries) {
      const bytes = await entry.getData(new Uint8ArrayWriter());
      if (!isTile(bytes)) {
        problems.push(`${entry.filename}: no tiene firma <tile>`);
        continue;
      }
      try {
        const tile = decodeTile(bytes);
        // El envoltorio no debe perder píxeles: el ZAR tiene que llenar la imagen.
        if (tile.pixelsWritten !== tile.width * tile.height) {
          problems.push(`${entry.filename}: ${tile.pixelsWritten} de ${tile.width * tile.height} píxeles`);
        }
        // Invariante fuerte: llenar la imagen no alcanza, porque un offset de
        // datos equivocado también la llena, con la imagen corrida. Que el RLE
        // consuma exactamente el tamaño declarado es lo que descarta eso.
        if (tile.bytesConsumed !== tile.declaredDataSize) {
          problems.push(`${entry.filename}: consumió ${tile.bytesConsumed} de ${tile.declaredDataSize} bytes`);
        }
        versions.set(tile.version, (versions.get(tile.version) ?? 0) + 1);
        if (tile.zarCount > 1) multiZar++;
        totalPixels += tile.width * tile.height;
      } catch (err) {
        problems.push(`${entry.filename}: ${(err as Error).message}`);
      }
    }
    await reader.close();

    expect(problems.slice(0, 10)).toEqual([]);
    const porVersion = [...versions]
      .sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `0x${v.toString(16)}×${n}`)
      .join(' ');
    console.log(
      `\n${entries.length} .til decodificados, ${totalPixels.toLocaleString('es')} píxeles` +
        `\n  versiones: ${porVersion}` +
        `\n  con más de un ZAR (solo se decodifica el primero): ${multiZar}\n`,
    );
  }, 900_000);
});
