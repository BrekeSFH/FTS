import { describe, expect, it } from 'vitest';
import { InvalidZarError, decodeZar, isZar, readPalette } from '../src/sprites/zar';

const PALETTE_OFFSET = 0x15;
const DATA_SIZE_OFFSET = 0x416;
const DATA_OFFSET = DATA_SIZE_OFFSET + 4;

type Rgb = [number, number, number];

/** Arma un ZAR mínimo con la disposición que documenta `zar.ts`. */
function makeZar(width: number, height: number, palette: Rgb[], data: number[]): Uint8Array {
  const bytes = new Uint8Array(DATA_OFFSET + data.length);
  bytes.set([0x3c, 0x7a, 0x61, 0x72, 0x3e, 0x00, 0x34, 0x00]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, width, true);
  view.setUint32(12, height, true);
  bytes.set([0x01, 0x00, 0x01, 0x00, 0x00], 0x10);
  palette.forEach(([r, g, b], i) => bytes.set([r, g, b, 0xff], PALETTE_OFFSET + i * 4));
  view.setUint32(DATA_SIZE_OFFSET, data.length, true);
  bytes.set(data, DATA_OFFSET);
  return bytes;
}

/** Byte de control: cantidad en los 6 bits altos, tipo en los 2 bajos. */
const run = (count: number, type: number) => (count << 2) | type;

const pixelAt = (img: { pixels: Uint8ClampedArray }, i: number) => Array.from(img.pixels.slice(i * 4, i * 4 + 4));

const RED: Rgb = [0xff, 0x00, 0x00];
const GREEN: Rgb = [0x00, 0xff, 0x00];

describe('isZar', () => {
  it('reconoce la firma <zar>', () => {
    expect(isZar(makeZar(1, 1, [RED], [run(1, 1), 0]))).toBe(true);
  });

  it('rechaza otros formatos y archivos demasiado cortos', () => {
    const notZar = makeZar(1, 1, [RED], [run(1, 1), 0]);
    notZar[0] = 0x50;
    expect(isZar(notZar)).toBe(false);
    expect(isZar(new Uint8Array([0x3c, 0x7a, 0x61, 0x72, 0x3e]))).toBe(false);
  });
});

describe('decodeZar', () => {
  it('lee ancho y alto de la cabecera', () => {
    const img = decodeZar(makeZar(4, 3, [RED], [run(12, 0)]));
    expect([img.width, img.height]).toEqual([4, 3]);
    expect(img.pixels).toHaveLength(4 * 3 * 4);
  });

  it('tipo 0: saltea píxeles y los deja transparentes', () => {
    const img = decodeZar(makeZar(2, 1, [RED], [run(2, 0)]));
    expect(pixelAt(img, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(img, 1)).toEqual([0, 0, 0, 0]);
    expect(img.pixelsWritten).toBe(2);
  });

  it('tipo 1: índices de paleta opacos', () => {
    const img = decodeZar(makeZar(2, 1, [RED, GREEN], [run(2, 1), 0, 1]));
    expect(pixelAt(img, 0)).toEqual([0xff, 0x00, 0x00, 0xff]);
    expect(pixelAt(img, 1)).toEqual([0x00, 0xff, 0x00, 0xff]);
  });

  it('tipo 2: pares de índice y alpha', () => {
    const img = decodeZar(makeZar(2, 1, [RED, GREEN], [run(2, 2), 1, 0x80, 0, 0x20]));
    expect(pixelAt(img, 0)).toEqual([0x00, 0xff, 0x00, 0x80]);
    expect(pixelAt(img, 1)).toEqual([0xff, 0x00, 0x00, 0x20]);
  });

  it('tipo 3: alphas sobre el color 0 de la paleta', () => {
    const img = decodeZar(makeZar(2, 1, [RED, GREEN], [run(2, 3), 0x40, 0xf0]));
    expect(pixelAt(img, 0)).toEqual([0xff, 0x00, 0x00, 0x40]);
    expect(pixelAt(img, 1)).toEqual([0xff, 0x00, 0x00, 0xf0]);
  });

  it('combina varios runs en una misma imagen', () => {
    // Fila de 4: uno opaco, uno saltado, dos con alpha.
    const img = decodeZar(makeZar(4, 1, [RED, GREEN], [run(1, 1), 1, run(1, 0), run(2, 2), 0, 0x10, 1, 0x20]));
    expect(pixelAt(img, 0)).toEqual([0x00, 0xff, 0x00, 0xff]);
    expect(pixelAt(img, 1)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(img, 2)).toEqual([0xff, 0x00, 0x00, 0x10]);
    expect(pixelAt(img, 3)).toEqual([0x00, 0xff, 0x00, 0x20]);
    expect(img.pixelsWritten).toBe(4);
  });

  it('informa cuántos bytes consumió frente al tamaño declarado', () => {
    const img = decodeZar(makeZar(2, 1, [RED], [run(2, 1), 0, 0]));
    expect(img.bytesConsumed).toBe(img.declaredDataSize);
  });

  it('no escribe más allá del alto declarado', () => {
    // El run pide 8 píxeles pero la imagen tiene 2.
    const img = decodeZar(makeZar(2, 1, [RED], [run(8, 1), 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(img.pixelsWritten).toBe(2);
    expect(img.pixels).toHaveLength(2 * 4);
  });

  it('devuelve la imagen parcial si los datos están truncados', () => {
    const full = makeZar(4, 1, [RED], [run(4, 1), 0, 0, 0, 0]);
    const img = decodeZar(full.subarray(0, full.length - 2));
    expect(img.pixelsWritten).toBeLessThan(4);
    expect(img.bytesConsumed).toBeLessThan(img.declaredDataSize);
  });

  it('rechaza un archivo que no es ZAR', () => {
    const notZar = makeZar(1, 1, [RED], [run(1, 1), 0]);
    notZar[0] = 0x50;
    expect(() => decodeZar(notZar)).toThrow(InvalidZarError);
  });

  it('rechaza dimensiones inválidas', () => {
    expect(() => decodeZar(makeZar(0, 5, [RED], []))).toThrow(/Dimensiones inválidas/);
  });
});

describe('readPalette', () => {
  it('devuelve los 256 colores como RGB', () => {
    const pal = readPalette(makeZar(1, 1, [RED, GREEN], [run(1, 0)]));
    expect(pal).toHaveLength(256 * 3);
    expect(Array.from(pal.slice(0, 6))).toEqual([0xff, 0x00, 0x00, 0x00, 0xff, 0x00]);
  });
});
