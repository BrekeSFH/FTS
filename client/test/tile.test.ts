import { describe, expect, it } from 'vitest';
import { InvalidTileError, decodeTile, isTile } from '../src/sprites/tile';

const PALETTE_OFFSET = 0x15;
const DATA_SIZE_OFFSET = 0x416;
const DATA_OFFSET = DATA_SIZE_OFFSET + 4;

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

/** ZAR en forma completa, igual que el de `zar.test.ts`. */
function makeZar(width: number, height: number, rgb: [number, number, number], data: number[]): Uint8Array {
  const bytes = new Uint8Array(DATA_OFFSET + data.length);
  bytes.set([0x3c, 0x7a, 0x61, 0x72, 0x3e, 0x00, 0x34, 0x00]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, width, true);
  view.setUint32(12, height, true);
  bytes.set([0x01, 0x00, 0x01, 0x00, 0x00], 0x10);
  bytes.set([...rgb, 0xff], PALETTE_OFFSET);
  view.setUint32(DATA_SIZE_OFFSET, data.length, true);
  bytes.set(data, DATA_OFFSET);
  return bytes;
}

/**
 * Envuelve un ZAR como `.TIL`. `padding` simula que la cabecera de `<tile>`
 * cambia de largo según la versión.
 */
function makeTile(zar: Uint8Array, { version = 0x39, padding = 1, zarCount = 1 } = {}): Uint8Array {
  const head = [...ascii('<tile>'), 0x00, version, ...new Array(padding).fill(0x00)];
  const mid = [...ascii('<tiledata>'), 0x00, 0x31, 0x00];
  const bytes = new Uint8Array(head.length + mid.length + 4 + zar.length);
  bytes.set(head);
  bytes.set(mid, head.length);
  new DataView(bytes.buffer).setUint32(head.length + mid.length, zarCount, true);
  bytes.set(zar, head.length + mid.length + 4);
  return bytes;
}

const RED: [number, number, number] = [0xff, 0x00, 0x00];
const run = (count: number, type: number) => (count << 2) | type;

describe('isTile', () => {
  it('reconoce la firma <tile>', () => {
    expect(isTile(makeTile(makeZar(1, 1, RED, [run(1, 1), 0])))).toBe(true);
  });

  it('rechaza un ZAR suelto', () => {
    expect(isTile(makeZar(1, 1, RED, [run(1, 1), 0]))).toBe(false);
  });
});

describe('decodeTile', () => {
  it('decodifica el ZAR que envuelve', () => {
    const tile = decodeTile(makeTile(makeZar(2, 1, RED, [run(2, 1), 0, 0])));
    expect([tile.width, tile.height]).toEqual([2, 1]);
    expect(Array.from(tile.pixels.slice(0, 4))).toEqual([0xff, 0x00, 0x00, 0xff]);
    expect(tile.pixelsWritten).toBe(2);
  });

  it('encuentra el ZAR aunque la cabecera cambie de largo según la versión', () => {
    // Las cuatro versiones vistas en los archivos reales desplazan <tiledata>.
    for (const [version, padding] of [
      [0x39, 1],
      [0x38, 2],
      [0x37, 3],
      [0x36, 4],
    ]) {
      const tile = decodeTile(makeTile(makeZar(2, 1, RED, [run(2, 1), 0, 0]), { version, padding }));
      expect(tile.version).toBe(version);
      expect(tile.pixelsWritten).toBe(2);
    }
  });

  it('informa cuántos ZAR declara el envoltorio', () => {
    const tile = decodeTile(makeTile(makeZar(1, 1, RED, [run(1, 1), 0]), { zarCount: 11 }));
    expect(tile.zarCount).toBe(11);
  });

  it('no se confunde con los bytes de <zar> dentro de los píxeles', () => {
    // Un run opaco cuyos índices son justo los bytes de la firma <zar>.
    const zar = makeZar(5, 1, RED, [run(5, 1), ...ascii('<zar>')]);
    const tile = decodeTile(makeTile(zar));
    expect(tile.pixelsWritten).toBe(5);
    expect(tile.width).toBe(5);
  });

  it('rechaza un archivo que no es un tile', () => {
    expect(() => decodeTile(makeZar(1, 1, RED, [run(1, 1), 0]))).toThrow(InvalidTileError);
  });

  it('rechaza un tile sin <tiledata>', () => {
    const roto = new Uint8Array([...ascii('<tile>'), 0x00, 0x39, ...new Array(64).fill(0)]);
    expect(() => decodeTile(roto)).toThrow(/tiledata/);
  });
});
