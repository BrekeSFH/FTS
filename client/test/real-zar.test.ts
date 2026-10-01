/**
 * Decodifica todos los .ZAR de una instalación real de Fallout Tactics.
 * Se saltea si FT_CORE no apunta a la carpeta `core` del juego.
 */
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { decodeZar, isZar } from '../src/sprites/zar';

const CORE = process.env.FT_CORE ?? '';

describe('ZAR reales', () => {
  it.runIf(CORE)('decodifica todos los .zar de gui_0.bos sin sobras ni faltantes', async () => {
    const blob = await openAsBlob(join(CORE, 'gui_0.bos'));
    const reader = new ZipReader(new BlobReader(blob as unknown as Blob), { useWebWorkers: false });
    const entries = (await reader.getEntries()).filter(
      (e): e is FileEntry => !e.directory && e.filename.toLowerCase().endsWith('.zar'),
    );
    expect(entries.length).toBeGreaterThan(100);

    const problems: string[] = [];
    let totalPixels = 0;

    for (const entry of entries) {
      const bytes = await entry.getData(new Uint8ArrayWriter());
      if (!isZar(bytes)) {
        problems.push(`${entry.filename}: no tiene firma <zar>`);
        continue;
      }
      const img = decodeZar(bytes);

      // Un decodificador correcto llena la imagen entera y consume los datos justos.
      if (img.pixelsWritten !== img.width * img.height) {
        problems.push(`${entry.filename}: ${img.pixelsWritten} de ${img.width * img.height} píxeles`);
      }
      if (img.bytesConsumed !== img.declaredDataSize) {
        problems.push(`${entry.filename}: consumió ${img.bytesConsumed} de ${img.declaredDataSize} bytes`);
      }
      totalPixels += img.width * img.height;
    }
    await reader.close();

    expect(problems.slice(0, 10)).toEqual([]);
    console.log(`\n${entries.length} .zar decodificados, ${totalPixels.toLocaleString('es')} píxeles\n`);
  }, 600_000);
});
