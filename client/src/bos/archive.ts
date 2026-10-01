/**
 * Lectura de contenedores .BOS (ZIP) con acceso aleatorio.
 *
 * zip.js con BlobReader lee solo el directorio central para listar las
 * entradas; cada entrada se descomprime bajo demanda leyendo únicamente su
 * rango de bytes. El archivo nunca se carga completo en memoria.
 */
import { BlobReader, BlobWriter, Uint8ArrayWriter, ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js';
import { detectFormat, isZipFormat, type SignatureReport } from './signature';

export interface BosEntry {
  /** Ruta dentro del contenedor, con `/` como separador. */
  path: string;
  /** Extensión en minúsculas sin el punto (`spr`, `zar`, ...). Vacía si no tiene. */
  extension: string;
  size: number;
  compressedSize: number;
  directory: boolean;
  lastModified: Date;
}

export class UnsupportedArchiveError extends Error {
  constructor(public readonly report: SignatureReport) {
    super(`El archivo no tiene firma ZIP (cabecera: ${report.headerHex})`);
    this.name = 'UnsupportedArchiveError';
  }
}

export interface BosArchiveOptions {
  /** Desactivar en entornos sin Web Workers (tests en Node). */
  useWebWorkers?: boolean;
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export class BosArchive {
  readonly entries: readonly BosEntry[];

  private constructor(
    readonly name: string,
    readonly size: number,
    readonly signature: SignatureReport,
    private readonly reader: ZipReader<Blob>,
    private readonly rawEntries: ReadonlyMap<string, Entry>,
  ) {
    this.entries = Array.from(rawEntries, ([path, e]) => ({
      path,
      extension: extensionOf(path),
      size: e.uncompressedSize,
      compressedSize: e.compressedSize,
      directory: e.directory,
      lastModified: e.lastModDate,
    }));
  }

  static async open(file: File, options: BosArchiveOptions = {}): Promise<BosArchive> {
    const signature = await detectFormat(file);
    if (!isZipFormat(signature.format)) throw new UnsupportedArchiveError(signature);

    const reader = new ZipReader(new BlobReader(file), {
      useWebWorkers: options.useWebWorkers ?? true,
    });
    const rawEntries = new Map<string, Entry>();
    for (const entry of await reader.getEntries()) {
      // Algunos ZIP generados en Windows usan `\` como separador.
      rawEntries.set(entry.filename.replaceAll('\\', '/'), entry);
    }
    return new BosArchive(file.name, file.size, signature, reader, rawEntries);
  }

  get files(): BosEntry[] {
    return this.entries.filter((e) => !e.directory);
  }

  /** Cantidad de archivos por extensión, ordenado de mayor a menor. */
  extensionStats(): [string, number][] {
    const counts = new Map<string, number>();
    for (const e of this.files) counts.set(e.extension, (counts.get(e.extension) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }

  private rawEntry(path: string): FileEntry {
    const entry = this.rawEntries.get(path);
    if (!entry || entry.directory) throw new Error(`Entrada no encontrada: ${path}`);
    return entry;
  }

  /** Descomprime una entrada a bytes. Pensado para archivos chicos/medianos. */
  async readBytes(path: string): Promise<Uint8Array> {
    return this.rawEntry(path).getData(new Uint8ArrayWriter());
  }

  /** Descomprime una entrada a un Blob (el navegador puede respaldarlo en disco). */
  async readBlob(path: string): Promise<Blob> {
    return this.rawEntry(path).getData(new BlobWriter());
  }

  async close(): Promise<void> {
    await this.reader.close();
  }
}
