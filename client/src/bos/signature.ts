/**
 * Detección del formato de un contenedor .BOS antes de asumir que es un ZIP.
 *
 * Solo se leen unos pocos bytes del inicio y del final del archivo
 * (Blob.slice), nunca el archivo completo.
 */

/** Firma de un "local file header" ZIP: `PK\x03\x04`. */
export const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04] as const;
/** Firma del "end of central directory record": `PK\x05\x06`. */
export const ZIP_EOCD = [0x50, 0x4b, 0x05, 0x06] as const;

/** Tamaño mínimo del EOCD; puede ir seguido de un comentario de hasta 65535 bytes. */
const EOCD_MIN_SIZE = 22;
const EOCD_SEARCH_WINDOW = EOCD_MIN_SIZE + 0xffff;

export type ArchiveFormat =
  /** Empieza con `PK\x03\x04`: ZIP estándar. */
  | 'zip'
  /** ZIP vacío: solo contiene el EOCD. */
  | 'zip-empty'
  /** No empieza con la firma, pero tiene EOCD al final (ZIP con datos antepuestos). */
  | 'zip-with-prefix'
  | 'unknown';

export interface SignatureReport {
  format: ArchiveFormat;
  /** Primeros bytes del archivo en hexadecimal, útil para diagnosticar formatos desconocidos. */
  headerHex: string;
}

export function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/** Busca la firma del EOCD desde el final hacia atrás. Devuelve el offset o -1. */
export function findEocd(tail: Uint8Array): number {
  for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (startsWith(tail, ZIP_EOCD, i)) return i;
  }
  return -1;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export async function detectFormat(blob: Blob): Promise<SignatureReport> {
  const header = await readRange(blob, 0, 16);
  const headerHex = toHex(header);

  if (startsWith(header, ZIP_LOCAL_HEADER)) return { format: 'zip', headerHex };
  if (startsWith(header, ZIP_EOCD)) return { format: 'zip-empty', headerHex };

  const tail = await readRange(blob, Math.max(0, blob.size - EOCD_SEARCH_WINDOW), blob.size);
  if (findEocd(tail) >= 0) return { format: 'zip-with-prefix', headerHex };

  return { format: 'unknown', headerHex };
}

export function isZipFormat(format: ArchiveFormat): boolean {
  return format !== 'unknown';
}
