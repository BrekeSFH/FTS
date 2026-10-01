/**
 * Decodificador de imágenes ZAR de Fallout Tactics.
 *
 * ZAR no es un formato documentado: la disposición de abajo se dedujo por
 * ingeniería inversa sobre los 839 `.ZAR` de `gui_0.bos` (18,7 M de píxeles).
 * Los campos marcados como constantes lo son en los 839 archivos; el byte
 * 0x415 es el único que varía sin que sepamos qué significa.
 *
 *   0x00   "<zar>"                  firma
 *   0x05   00 34 00                 constante (0x34 es '4', probablemente la versión)
 *   0x08   uint32 LE                ancho
 *   0x0C   uint32 LE                alto
 *   0x10   01 00 01 00 00           constante
 *   0x15   256 x (R, G, B, relleno) paleta; el 4º byte no se usa al dibujar
 *   0x415  uint8                    desconocido (vale 0 en 791 de 839 archivos)
 *   0x416  uint32 LE                tamaño en bytes de los datos
 *   0x41A  datos RLE
 *
 * El RLE recorre la imagen fila por fila. Cada byte de control codifica una
 * cantidad en sus 6 bits altos y un tipo en los 2 bajos:
 *
 *   tipo 0  saltea `count` píxeles, que quedan transparentes
 *   tipo 1  siguen `count` índices de paleta, opacos
 *   tipo 2  siguen `count` pares (índice, alpha)
 *   tipo 3  siguen `count` alphas; el color es siempre el índice 0 de la paleta
 *
 * El tipo 3 es lo que da el antialiasing de las ilustraciones a tinta del
 * Pip-Boy: trazo negro con el borde suavizado.
 */

/** Firma de un archivo ZAR: `<zar>`. */
export const ZAR_SIGNATURE = [0x3c, 0x7a, 0x61, 0x72, 0x3e] as const;

const PALETTE_OFFSET = 0x15;
const PALETTE_COLORS = 256;
const DATA_SIZE_OFFSET = 0x416;
const DATA_OFFSET = DATA_SIZE_OFFSET + 4;

export interface ZarImage {
  width: number;
  height: number;
  /** RGBA sin premultiplicar, en orden de fila. Apto para `new ImageData(pixels, width)`. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
  /** Píxeles efectivamente escritos. Menor que `width * height` si los datos se cortan. */
  pixelsWritten: number;
  /** Bytes de datos consumidos, para contrastar con el tamaño declarado. */
  bytesConsumed: number;
  declaredDataSize: number;
}

export class InvalidZarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidZarError';
  }
}

export function isZar(bytes: Uint8Array): boolean {
  if (bytes.length < DATA_OFFSET) return false;
  return ZAR_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Decodifica un ZAR a píxeles RGBA.
 *
 * Los datos vienen de archivos del usuario, así que nada se da por bueno: las
 * dimensiones se validan y el recorrido corta al llegar al final del búfer en
 * vez de leer fuera de rango. Un archivo truncado devuelve la imagen parcial;
 * compará `pixelsWritten` con `width * height` para detectarlo.
 */
export function decodeZar(bytes: Uint8Array): ZarImage {
  if (!isZar(bytes)) {
    throw new InvalidZarError(
      bytes.length < DATA_OFFSET
        ? `El archivo es demasiado corto para ser un ZAR (${bytes.length} bytes)`
        : 'El archivo no empieza con la firma <zar>',
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  if (width === 0 || height === 0) {
    throw new InvalidZarError(`Dimensiones inválidas: ${width}x${height}`);
  }
  // Techo defensivo: evita reservar gigabytes por una cabecera corrupta.
  if (width * height > 64 * 1024 * 1024) {
    throw new InvalidZarError(`Imagen demasiado grande: ${width}x${height}`);
  }

  const declaredDataSize = view.getUint32(DATA_SIZE_OFFSET, true);
  const available = Math.max(0, bytes.length - DATA_OFFSET);
  const data = bytes.subarray(DATA_OFFSET, DATA_OFFSET + Math.min(declaredDataSize, available));

  const total = width * height;
  const pixels = new Uint8ClampedArray(total * 4);

  let read = 0;
  let pixel = 0;
  while (read < data.length && pixel < total) {
    const control = data[read++];
    const count = control >> 2;
    const type = control & 3;

    if (type === 0) {
      pixel += count; // transparentes: el búfer ya viene en cero
      continue;
    }

    for (let i = 0; i < count && pixel < total; i++) {
      let color: number;
      let alpha: number;

      if (type === 1) {
        if (read >= data.length) break;
        color = data[read++];
        alpha = 0xff;
      } else if (type === 2) {
        if (read + 1 >= data.length) break;
        color = data[read++];
        alpha = data[read++];
      } else {
        if (read >= data.length) break;
        color = 0;
        alpha = data[read++];
      }

      const palette = PALETTE_OFFSET + color * 4;
      const out = pixel * 4;
      pixels[out] = bytes[palette];
      pixels[out + 1] = bytes[palette + 1];
      pixels[out + 2] = bytes[palette + 2];
      pixels[out + 3] = alpha;
      pixel++;
    }
  }

  return { width, height, pixels, pixelsWritten: pixel, bytesConsumed: read, declaredDataSize };
}

/** Lee la paleta cruda como RGB. Útil para inspeccionar y para los tests. */
export function readPalette(bytes: Uint8Array): Uint8Array {
  if (!isZar(bytes)) throw new InvalidZarError('El archivo no empieza con la firma <zar>');
  const rgb = new Uint8Array(PALETTE_COLORS * 3);
  for (let i = 0; i < PALETTE_COLORS; i++) {
    const src = PALETTE_OFFSET + i * 4;
    rgb[i * 3] = bytes[src];
    rgb[i * 3 + 1] = bytes[src + 1];
    rgb[i * 3 + 2] = bytes[src + 2];
  }
  return rgb;
}
