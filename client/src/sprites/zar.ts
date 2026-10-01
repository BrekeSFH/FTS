/**
 * Decodificador de imágenes ZAR de Fallout Tactics.
 *
 * ZAR no es un formato documentado: la disposición de abajo se dedujo por
 * ingeniería inversa sobre los 839 `.ZAR` de `gui_0.bos` y los 29.957 `.TIL`
 * de `tiles_0.bos`. Los campos marcados como constantes lo son en todos ellos.
 *
 *   0x00   "<zar>"                  firma
 *   0x05   00 34 00                 constante (0x34 es '4', probablemente la versión)
 *   0x08   uint32 LE                ancho
 *   0x0C   uint32 LE                alto
 *   0x10   01 00 01 00 00           constante
 *   0x15   256 x (R, G, B, relleno) paleta; el 4º byte no se usa al dibujar
 *   0x415  uint8                    relleno; presente en los ZAR sueltos, ausente en
 *                                  algunos ZAR embebidos en tiles
 *   0x416  uint32 LE                tamaño en bytes de los datos
 *   0x41A  datos RLE
 *
 * Ese relleno no siempre está, así que el campo de tamaño se ubica probando
 * los dos offsets posibles y validando; ver `findSizeField`.
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
/**
 * Dónde puede estar el uint32 con el tamaño de los datos, en orden de
 * preferencia. 0x416 es el de los ZAR sueltos; 0x415 aparece en los ZAR
 * embebidos en tiles de versión '7' y '6', que no traen el byte intermedio.
 */
const SIZE_OFFSET_CANDIDATES = [0x416, 0x415] as const;
/** Mínimo para que la cabecera y la paleta entren completas. */
const DATA_OFFSET = 0x415 + 4;

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
 * Recorre los runs sin escribir píxeles, para validar un candidato a campo de
 * tamaño. Es barato: avanza de run en run, no de píxel en píxel.
 */
function scanRuns(data: Uint8Array, total: number): { pixels: number; bytes: number } {
  let pixel = 0;
  let read = 0;
  while (read < data.length && pixel < total) {
    const control = data[read++];
    const count = control >> 2;
    const type = control & 3;
    if (type !== 0) {
      const needed = count * (type === 2 ? 2 : 1);
      if (read + needed > data.length) return { pixels: -1, bytes: -1 };
      read += needed;
    }
    pixel = Math.min(pixel + count, total);
  }
  return { pixels: pixel, bytes: read };
}

/**
 * Ubica el uint32 con el tamaño de los datos.
 *
 * En los ZAR sueltos hay un byte entre la paleta y ese campo, que queda en
 * 0x416; los ZAR dentro de tiles de versión '7' y '6' no lo tienen y el campo
 * arranca en 0x415. En vez de decidirlo por la versión del envoltorio —que el
 * decodificador no conoce— se prueban ambos y se acepta el que cierre: los
 * datos tienen que consumir exactamente el tamaño declarado y llenar la
 * imagen. Es una validación fuerte; un offset equivocado casi nunca cierra.
 */
function findSizeField(
  bytes: Uint8Array,
  view: DataView,
  total: number,
): { sizeAt: number; declaredDataSize: number } {
  for (const sizeAt of SIZE_OFFSET_CANDIDATES) {
    if (sizeAt + 4 > bytes.length) continue;
    const size = view.getUint32(sizeAt, true);
    const start = sizeAt + 4;
    if (size > bytes.length - start) continue;
    const scan = scanRuns(bytes.subarray(start, start + size), total);
    if (scan.bytes === size && scan.pixels === total) return { sizeAt, declaredDataSize: size };
  }
  // Ninguno valida: se sigue con el layout habitual y el resultado dirá
  // cuántos píxeles y bytes se pudieron leer.
  const fallback = SIZE_OFFSET_CANDIDATES[0];
  return { sizeAt: fallback, declaredDataSize: view.getUint32(fallback, true) };
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

  const total = width * height;
  const { sizeAt, declaredDataSize } = findSizeField(bytes, view, total);
  const dataStart = sizeAt + 4;
  const available = Math.max(0, bytes.length - dataStart);
  const data = bytes.subarray(dataStart, dataStart + Math.min(declaredDataSize, available));

  return { ...decodeZarRuns(data, width, height, bytes, PALETTE_OFFSET), declaredDataSize };
}

/**
 * Decodifica los runs a pixeles RGBA.
 *
 * La paleta se pasa aparte porque no siempre vive junto a los datos: los ZAR
 * sueltos la traen en su propia cabecera, y los frames de un `.SPR` la
 * comparten a nivel de animacion.
 */
export function decodeZarRuns(
  data: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
  paletteOffset: number,
): Omit<ZarImage, 'declaredDataSize'> {
  const total = width * height;
  const pixels = new Uint8ClampedArray(total * 4);

  let read = 0;
  let pixel = 0;
  while (read < data.length && pixel < total) {
    const control = data[read++];
    const count = control >> 2;
    const type = control & 3;

    if (type === 0) {
      // Transparentes: el bufer ya viene en cero. El ultimo run suele pasarse
      // del final de la imagen, asi que se acota.
      pixel = Math.min(pixel + count, total);
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

      const entry = paletteOffset + color * 4;
      const out = pixel * 4;
      pixels[out] = palette[entry];
      pixels[out + 1] = palette[entry + 1];
      pixels[out + 2] = palette[entry + 2];
      pixels[out + 3] = alpha;
      pixel++;
    }
  }

  return { width, height, pixels, pixelsWritten: pixel, bytesConsumed: read };
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
