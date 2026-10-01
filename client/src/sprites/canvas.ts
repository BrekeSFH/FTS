/**
 * Puente entre el decodificador ZAR y un `<canvas>`.
 *
 * Vive en su propio módulo para poder ejercitarlo en un navegador real:
 * jsdom no implementa canvas, así que esta parte no entra en los tests
 * unitarios.
 */
import { decodeTile, type TileImage } from './tile';
import { decodeZar, type ZarImage } from './zar';

export class CanvasUnavailableError extends Error {
  constructor() {
    super('El navegador no devolvió un contexto 2D');
    this.name = 'CanvasUnavailableError';
  }
}

/** Vuelca una imagen ya decodificada; el canvas queda de su tamaño. */
function paint(canvas: HTMLCanvasElement, image: ZarImage): void {
  const context = canvas.getContext('2d');
  if (!context) throw new CanvasUnavailableError();

  canvas.width = image.width;
  canvas.height = image.height;
  context.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
}

/**
 * Decodifica un ZAR y lo dibuja. Devuelve la imagen para poder informar
 * dimensiones o detectar un archivo truncado.
 */
export function drawZarToCanvas(canvas: HTMLCanvasElement, bytes: Uint8Array): ZarImage {
  const image = decodeZar(bytes);
  paint(canvas, image);
  return image;
}

/** Decodifica el primer ZAR de un tile `.TIL` y lo dibuja. */
export function drawTileToCanvas(canvas: HTMLCanvasElement, bytes: Uint8Array): TileImage {
  const tile = decodeTile(bytes);
  paint(canvas, tile);
  return tile;
}

/** Texto corto para el encabezado de la vista previa. */
export function describeZar(image: ZarImage): string {
  const expected = image.width * image.height;
  const partial =
    image.pixelsWritten < expected ? ` — truncado: ${image.pixelsWritten} de ${expected} píxeles` : '';
  return `ZAR ${image.width}×${image.height}${partial}`;
}

/** Como `describeZar`, más la advertencia de que el tile trae varios ZAR. */
export function describeTile(tile: TileImage): string {
  const extra = tile.zarCount > 1 ? ` — ${tile.zarCount} ZAR, se muestra el primero` : '';
  return `TIL ${tile.width}×${tile.height}${extra}`;
}
