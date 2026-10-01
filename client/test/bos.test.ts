import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { BosArchive, UnsupportedArchiveError } from '../src/bos/archive';
import { detectFormat } from '../src/bos/signature';

const NO_WORKERS = { useWebWorkers: false };

async function makeZip(files: Record<string, Uint8Array | string>, level = 6): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { ...NO_WORKERS, level });
  for (const [name, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    await writer.add(name, new Uint8ArrayReader(bytes));
  }
  return writer.close();
}

/** File que contabiliza los bytes efectivamente leídos vía slice(). */
class CountingFile extends File {
  bytesRead = 0;
  override slice(start?: number, end?: number, contentType?: string): Blob {
    const blob = super.slice(start, end, contentType);
    this.bytesRead += blob.size;
    return blob;
  }
}

describe('detectFormat', () => {
  it('reconoce un ZIP estándar por su firma PK\\x03\\x04', async () => {
    const zip = await makeZip({ 'a.txt': 'hola' });
    expect((await detectFormat(zip)).format).toBe('zip');
  });

  it('reconoce un ZIP vacío', async () => {
    const zip = await makeZip({});
    expect((await detectFormat(zip)).format).toBe('zip-empty');
  });

  it('reconoce un ZIP con datos antepuestos buscando el EOCD', async () => {
    const zip = await makeZip({ 'a.txt': 'hola' });
    const prefixed = new Blob([new Uint8Array([1, 2, 3, 4, 5]), zip]);
    expect((await detectFormat(prefixed)).format).toBe('zip-with-prefix');
  });

  it('rechaza archivos sin firma ZIP e informa la cabecera', async () => {
    const report = await detectFormat(new Blob([new Uint8Array([0xde, 0xad, 0xbe, 0xef])]));
    expect(report).toEqual({ format: 'unknown', headerHex: 'de ad be ef' });
  });
});

describe('BosArchive', () => {
  it('lista entradas con extensión normalizada', async () => {
    const zip = await makeZip({
      'core/sprites/hero.SPR': new Uint8Array(10),
      'core/tiles/floor.zar': new Uint8Array(20),
      'core/readme': 'sin extensión',
    });
    const archive = await BosArchive.open(new File([zip], 'core.bos'), NO_WORKERS);

    expect(archive.files.map((e) => [e.path, e.extension, e.size])).toEqual([
      ['core/sprites/hero.SPR', 'spr', 10],
      ['core/tiles/floor.zar', 'zar', 20],
      ['core/readme', '', 14],
    ]);
    expect(archive.extensionStats()).toEqual([
      ['spr', 1],
      ['zar', 1],
      ['', 1],
    ]);
    await archive.close();
  });

  it('descomprime una entrada bajo demanda', async () => {
    const zip = await makeZip({ 'a.txt': 'hola mundo', 'b.bin': new Uint8Array([1, 2, 3]) });
    const archive = await BosArchive.open(new File([zip], 'test.bos'), NO_WORKERS);

    expect(new TextDecoder().decode(await archive.readBytes('a.txt'))).toBe('hola mundo');
    expect(Array.from(await archive.readBytes('b.bin'))).toEqual([1, 2, 3]);
    expect((await archive.readBlob('b.bin')).size).toBe(3);
    await expect(archive.readBytes('no-existe')).rejects.toThrow('Entrada no encontrada');
    await archive.close();
  });

  it('no lee el archivo completo para listar ni para extraer una entrada', async () => {
    // Datos pseudoaleatorios sin comprimir (level 0) para que el ZIP pese ~4 MB.
    const big = new Uint8Array(4 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24;
    const zip = await makeZip({ 'big.bin': big, 'small.txt': 'chico' }, 0);
    const file = new CountingFile([zip], 'big.bos');

    const archive = await BosArchive.open(file, NO_WORKERS);
    expect(archive.files).toHaveLength(2);
    expect(file.bytesRead).toBeLessThan(zip.size / 10);

    await archive.readBytes('small.txt');
    expect(file.bytesRead).toBeLessThan(zip.size / 10);
    await archive.close();
  });

  it('lanza UnsupportedArchiveError si el archivo no es ZIP', async () => {
    const file = new File([new Uint8Array(64).fill(0x41)], 'raro.bos');
    await expect(BosArchive.open(file, NO_WORKERS)).rejects.toBeInstanceOf(UnsupportedArchiveError);
  });
});
