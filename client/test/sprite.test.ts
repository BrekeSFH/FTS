import { describe, expect, it } from 'vitest';
import {
  InvalidSpriteError,
  decodeSpriteFrame,
  isSprite,
  readSpriteAnimations,
  readSpriteReference,
} from '../src/sprites/sprite';

type Rgb = [number, number, number];
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
/** Byte de control del RLE: cantidad en los 6 bits altos, tipo en los 2 bajos. */
const run = (count: number, type: number) => (count << 2) | type;

/** Un frame: ZAR en forma corta, sin paleta propia. */
function frame(width: number, height: number, data: number[]): number[] {
  return [
    ...ascii('<zar>'), 0x00, 0x34, 0x00,
    ...u32(width), ...u32(height),
    0x00,
    ...u32(data.length),
    ...data,
  ];
}

/** Las cuatro paletas, cada una con su cantidad de colores al frente. */
function palettes(groups: Rgb[][]): number[] {
  return groups.flatMap((colors) => [...u32(colors.length), ...colors.flatMap(([r, g, b]) => [r, g, b, 0xff])]);
}

/** Un rectángulo de la tabla: izquierda, arriba, derecha, abajo. */
type Rect = [number, number, number, number];

interface AnimSpec {
  name: string;
  rects?: Rect[];
  directions?: number;
  /** Bytes de hueco antes de cada frame; el formato real usa 9, 10 o 12. */
  gaps?: number[];
  frames: number[][];
  palettes: Rgb[][];
  compressed?: boolean;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Arma un `.SPR` con la disposición que documenta `sprite.ts`. */
async function makeSprite(
  specs: AnimSpec[],
  { headerPadding = 0, reference = [0, 0] as [number, number] } = {},
): Promise<Uint8Array> {
  const payloads = specs.map((spec) => {
    const gaps = spec.gaps ?? spec.frames.map(() => 9);
    return [
      ...palettes(spec.palettes),
      ...spec.frames.flatMap((f, i) => [...new Array(gaps[i]).fill(0x00), ...f]),
    ];
  });

  const blocks = await Promise.all(
    specs.map(async (spec, i) => {
      const payload = Uint8Array.from(payloads[i]);
      const magic = [...ascii('<spranim_img>'), 0x00];
      if (!spec.compressed) return [...magic, 0x31, 0x00, ...payload];
      return [...magic, 0x32, 0x00, ...u32(payload.length), ...(await deflate(payload))];
    }),
  );

  // Tras el magic: 00, versión '4', 00, tres bytes, y el punto de referencia.
  const head = [
    ...ascii('<sprite>'), 0x00, 0x34, 0x00, 0x01, 0x01, 0x01,
    ...u32(reference[0]), ...u32(reference[1]),
    ...new Array(headerPadding).fill(0x00),
  ];
  const headers = specs.map((spec) => [
    ...ascii('<spranim>'), 0x00, 0x31, 0x00,
    ...u32(0), // offset, se completa abajo
    ...u32(spec.name.length), ...ascii(spec.name),
    // Primero los frames por dirección y después las direcciones, en ese orden.
    ...u32(spec.frames.length / (spec.directions ?? 1)),
    ...u32(spec.directions ?? 1),
    ...(spec.rects
      ? spec.rects.flatMap((r) => r.flatMap(u32))
      : new Array(spec.frames.length * 16).fill(0x00)),
  ]);

  // Los offsets se miden desde 0x0C y apuntan al ">" que cierra el magic.
  const headersLength = headers.reduce((sum, h) => sum + h.length, 0);
  let blockAt = head.length + headersLength;
  headers.forEach((h, i) => {
    const closing = blockAt + ascii('<spranim_img>').length - 1;
    h.splice(12, 4, ...u32(closing - 0x0c));
    blockAt += blocks[i].length;
  });

  return Uint8Array.from([...head, ...headers.flat(), ...blocks.flat()]);
}

const RED: Rgb = [0xff, 0x00, 0x00];
const GREEN: Rgb = [0x00, 0xff, 0x00];
const BLUE: Rgb = [0x00, 0x00, 0xff];
const GREY: Rgb = [0x80, 0x80, 0x80];
const FOUR = [[RED, GREEN], [GREY, GREY], [GREY, GREY], [GREY, GREY]];

const pixel = (f: { pixels: Uint8ClampedArray }, i: number) => Array.from(f.pixels.slice(i * 4, i * 4 + 4));

describe('isSprite', () => {
  it('reconoce la firma <sprite>', async () => {
    const spr = await makeSprite([{ name: 'a', frames: [frame(1, 1, [run(1, 1), 0])], palettes: FOUR }]);
    expect(isSprite(spr)).toBe(true);
    expect(isSprite(Uint8Array.from(ascii('<zar>')))).toBe(false);
  });
});

describe('readSpriteAnimations', () => {
  it('lee nombre, direcciones y cantidad de frames de cada animación', async () => {
    const spr = await makeSprite([
      { name: 'caminar', directions: 2, frames: [frame(1, 1, [run(1, 1), 0]), frame(1, 1, [run(1, 1), 1])], palettes: FOUR },
      { name: 'morir', frames: [frame(1, 1, [run(1, 1), 0])], palettes: FOUR },
    ]);
    expect(readSpriteAnimations(spr).map((a) => [a.name, a.directions, a.imageCount])).toEqual([
      ['caminar', 2, 2],
      ['morir', 1, 1],
    ]);
  });

  it('encuentra el primer <spranim> aunque la cabecera sea de largo variable', async () => {
    const spr = await makeSprite([{ name: 'a', frames: [frame(1, 1, [run(1, 1), 0])], palettes: FOUR }], {
      headerPadding: 37,
    });
    expect(readSpriteAnimations(spr)[0].name).toBe('a');
  });

  it('rechaza un archivo que no es un sprite', () => {
    expect(() => readSpriteAnimations(Uint8Array.from(ascii('<tile>')))).toThrow(InvalidSpriteError);
  });
});

describe('decodeSpriteFrame', () => {
  it('decodifica un frame con la paleta de la animación', async () => {
    const spr = await makeSprite([
      { name: 'a', frames: [frame(2, 1, [run(2, 1), 0, 1])], palettes: FOUR },
    ]);
    const f = await decodeSpriteFrame(spr);
    expect([f.width, f.height]).toEqual([2, 1]);
    expect(pixel(f, 0)).toEqual([0xff, 0x00, 0x00, 0xff]);
    expect(pixel(f, 1)).toEqual([0x00, 0xff, 0x00, 0xff]);
    expect(f.bytesConsumed).toBe(f.declaredDataSize);
  });

  it('salta al frame siguiente aunque el hueco cambie de tamaño', async () => {
    const spr = await makeSprite([
      {
        name: 'a',
        gaps: [9, 12, 10],
        frames: [frame(1, 1, [run(1, 1), 0]), frame(1, 1, [run(1, 1), 1]), frame(2, 1, [run(2, 1), 1, 0])],
        palettes: FOUR,
      },
    ]);
    expect(pixel(await decodeSpriteFrame(spr, 0, 0), 0)).toEqual([0xff, 0x00, 0x00, 0xff]);
    expect(pixel(await decodeSpriteFrame(spr, 0, 1), 0)).toEqual([0x00, 0xff, 0x00, 0xff]);
    const tercero = await decodeSpriteFrame(spr, 0, 2);
    expect(tercero.width).toBe(2);
    expect(pixel(tercero, 1)).toEqual([0xff, 0x00, 0x00, 0xff]);
  });

  it('da el mismo resultado comprimido que sin comprimir', async () => {
    const spec: AnimSpec = { name: 'a', frames: [frame(2, 1, [run(2, 1), 1, 0])], palettes: FOUR };
    const plano = await decodeSpriteFrame(await makeSprite([spec]));
    const zlib = await decodeSpriteFrame(await makeSprite([{ ...spec, compressed: true }]));
    expect(Array.from(zlib.pixels)).toEqual(Array.from(plano.pixels));
    expect(zlib.bytesConsumed).toBe(plano.bytesConsumed);
  });

  it('permite elegir cualquiera de las cuatro paletas', async () => {
    const spr = await makeSprite([
      { name: 'a', frames: [frame(1, 1, [run(1, 1), 0])], palettes: [[RED], [GREEN], [BLUE], [GREY]] },
    ]);
    expect(pixel(await decodeSpriteFrame(spr, 0, 0, { paletteIndex: 0 }), 0)).toEqual([0xff, 0, 0, 0xff]);
    expect(pixel(await decodeSpriteFrame(spr, 0, 0, { paletteIndex: 2 }), 0)).toEqual([0, 0, 0xff, 0xff]);
    await expect(decodeSpriteFrame(spr, 0, 0, { paletteIndex: 4 })).rejects.toThrow(/Paleta 4/);
  });

  it('devuelve un frame vacío si el bloque no trae datos de imagen', async () => {
    // Como "Projectile Invisi": declara frames y deja todo en cero.
    const spr = await makeSprite([{ name: 'invisi', gaps: [32], frames: [[]], palettes: FOUR }]);
    const f = await decodeSpriteFrame(spr);
    expect([f.width, f.height, f.pixelsWritten]).toEqual([0, 0, 0]);
  });

  it('rechaza índices fuera de rango', async () => {
    const spr = await makeSprite([{ name: 'a', frames: [frame(1, 1, [run(1, 1), 0])], palettes: FOUR }]);
    await expect(decodeSpriteFrame(spr, 5)).rejects.toThrow(/animación 5/);
    await expect(decodeSpriteFrame(spr, 0, 3)).rejects.toThrow(/declara 1 imágenes/);
  });
});

describe('tabla de rectángulos', () => {
  it('lee el punto de referencia del sprite', async () => {
    const spr = await makeSprite([{ name: 'a', frames: [frame(1, 1, [run(1, 1), 0])], palettes: FOUR }], {
      reference: [149, 197],
    });
    expect(readSpriteReference(spr)).toEqual({ x: 149, y: 197 });
  });

  it('expone un rectángulo por imagen, en orden', async () => {
    const rects: Rect[] = [
      [142, 180, 156, 196],
      [140, 180, 156, 194],
    ];
    const spr = await makeSprite([
      {
        name: 'a',
        rects,
        frames: [frame(14, 16, [run(14 * 16, 0)]), frame(16, 14, [run(16 * 14, 0)])],
        palettes: FOUR,
      },
    ]);
    expect(readSpriteAnimations(spr)[0].rects).toEqual([
      { left: 142, top: 180, right: 156, bottom: 196 },
      { left: 140, top: 180, right: 156, bottom: 194 },
    ]);
  });

  it('el rectángulo describe el tamaño de su imagen', async () => {
    // Es la invariante que confirma que la tabla quedó alineada: sobre los
    // archivos reales se cumple en 6016 de 6264 imágenes, y las demás
    // difieren en un píxel.
    const spr = await makeSprite([
      {
        name: 'a',
        rects: [[142, 180, 156, 196]],
        frames: [frame(14, 16, [run(14 * 16, 0)])],
        palettes: FOUR,
      },
    ]);
    const f = await decodeSpriteFrame(spr);
    expect(f.rect).not.toBeNull();
    expect(f.rect!.right - f.rect!.left).toBe(f.width);
    expect(f.rect!.bottom - f.rect!.top).toBe(f.height);
  });
});
