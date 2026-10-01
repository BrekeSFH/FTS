/**
 * Puente entre el decodificador ZAR y un `<canvas>`.
 *
 * Vive en su propio módulo para poder ejercitarlo en un navegador real:
 * jsdom no implementa canvas, así que esta parte no entra en los tests
 * unitarios.
 */
import { decodeZar, type ZarImage } from './zar';

export class CanvasUnavailableError extends Error {
  constructor() {
    super('El navegador no devolvió un contexto 2D');
    this.name = 'CanvasUnavailableError';
  }
}

/**
 * Decodifica un ZAR y lo dibuja en el canvas, que queda del tamaño de la
 * imagen. Devuelve la imagen decodificada para poder informar dimensiones o
 * detectar un archivo truncado.
 */
export function drawZarToCanvas(canvas: HTMLCanvasElement, bytes: Uint8Array): ZarImage {
  const image = decodeZar(bytes);
  const context = canvas.getContext('2d');
  if (!context) throw new CanvasUnavailableError();

  canvas.width = image.width;
  canvas.height = image.height;
  context.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
  return image;
}

/** Texto corto para el encabezado de la vista previa. */
export function describeZar(image: ZarImage): string {
  const expected = image.width * image.height;
  const partial =
    image.pixelsWritten < expected ? ` — truncado: ${image.pixelsWritten} de ${expected} píxeles` : '';
  return `ZAR ${image.width}×${image.height}${partial}`;
}
