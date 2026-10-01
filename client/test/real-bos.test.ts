/**
 * Verificación de Hito 1 contra los .BOS reales de una instalación de Fallout Tactics.
 * Se saltea si FT_CORE no apunta a una carpeta con archivos .bos.
 */
import { openAsBlob } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BosArchive } from '../src/bos/archive';

const CORE = process.env.FT_CORE ?? '';
const NO_WORKERS = { useWebWorkers: false };

/** Envuelve un Blob perezoso de disco como File, contando los bytes leídos vía slice. */
function countingFile(blob: Blob, name: string) {
  const state = { bytesRead: 0 };
  const file = {
    name,
    size: blob.size,
    type: '',
    lastModified: 0,
    slice(start?: number, end?: number, ct?: string) {
      const part = blob.slice(start, end, ct);
      state.bytesRead += part.size;
      return part;
    },
    arrayBuffer: () => blob.arrayBuffer(),
    stream: () => blob.stream(),
    text: () => blob.text(),
    bytes: () => (blob as any).bytes(),
  };
  return { file: file as unknown as File, state };
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';

describe('BOS reales', () => {
  it.runIf(CORE)('abre todos los .bos de core/ sin leerlos enteros', async () => {
    const names = (await readdir(CORE)).filter((n) => n.toLowerCase().endsWith('.bos')).sort();
    expect(names.length).toBeGreaterThan(0);

    const rows: string[] = [];
    let totalEntries = 0;

    for (const name of names) {
      const path = join(CORE, name);
      const size = (await stat(path)).size;
      const { file, state } = countingFile(await openAsBlob(path), name);

      const t0 = performance.now();
      const archive = await BosArchive.open(file, NO_WORKERS);
      const listMs = performance.now() - t0;
      const listBytes = state.bytesRead;

      expect(archive.signature.format).toBe('zip');
      expect(archive.files.length).toBeGreaterThan(0);

      // El listado solo debe tocar el directorio central: ~46 B + nombre por entrada.
      // El presupuesto escala con la cantidad de entradas, no con el tamaño del archivo.
      const listBudget = 256 * archive.entries.length + 64 * 1024;
      expect(listBytes, `${name}: listado leyó ${mb(listBytes)} para ${archive.entries.length} entradas`)
        .toBeLessThan(listBudget);
      totalEntries += archive.files.length;

      // Descomprimir la entrada más chica: zip.js valida el CRC32 al leer.
      // Solo debe leerse la cabecera local (30 B + nombre + extra) y los bytes comprimidos.
      const smallest = archive.files.filter((e) => e.size > 0).sort((a, b) => a.size - b.size)[0];
      const before = state.bytesRead;
      const bytes = await archive.readBytes(smallest.path);
      const readBytes = state.bytesRead - before;
      expect(bytes.length).toBe(smallest.size);
      expect(readBytes, `${name}: extraer ${smallest.path} leyó ${readBytes} B para ${smallest.compressedSize} B comprimidos`)
        .toBeLessThan(smallest.compressedSize + 4096);

      const top = archive.extensionStats().slice(0, 3).map(([e, n]) => `${e || '(sin)'}:${n}`).join(' ');
      rows.push(
        `${name.padEnd(26)} ${mb(size).padStart(9)} ${String(archive.files.length).padStart(6)} entradas ` +
          `· listado ${listMs.toFixed(0).padStart(5)} ms / ${mb(listBytes).padStart(8)} (${((listBytes / size) * 100).toFixed(1).padStart(4)}%) ` +
          `· menor ${String(smallest.size).padStart(9)} B ok (+${readBytes - smallest.compressedSize} B) · ${top}`,
      );
      await archive.close();
    }

    console.log(`\n${rows.join('\n')}\n\nTotal: ${names.length} archivos, ${totalEntries} entradas.\n`);
  }, 600_000);
});
