/**
 * Lector de sprites `.SPR` de Fallout Tactics.
 *
 * Un `.SPR` es un contenedor de animaciones con nombre. Cada animación tiene
 * su propio bloque de datos con cuatro paletas y sus frames, que son ZAR en
 * forma corta: sin paleta propia y sin los campos constantes del ZAR suelto.
 *
 * Deducido sobre los `.SPR` de `spr-extra_0.bos` y los demás `spr-*.bos`.
 *
 *   0x00  "<sprite>" 00 '4' 00
 *   0x0B  …                       campos de cabecera
 *   0x66  cadena de encabezados <spranim>, uno por animación
 *
 * Cada encabezado `<spranim>`:
 *
 *   +0   "<spranim>" 00 '1' 00
 *   +12  uint32                  offset del bloque de datos, medido desde 0x0C
 *   +16  uint32 + nombre         largo y nombre de la animación
 *   +N   uint32                  frames por dirección
 *   +N+4 uint32                  cantidad de direcciones
 *   +N+8 direcciones x frames    tabla de rectángulos, 16 bytes por imagen:
 *                                izquierda, arriba, derecha y abajo en uint32.
 *                                El siguiente encabezado arranca justo después
 *
 * El bloque de datos empieza con el magic `<spranim_img>` y un byte de versión:
 *
 *   '1'  el contenido sigue en claro
 *   '2'  uint32 con el tamaño sin comprimir y después un flujo zlib que, al
 *        inflarse, da exactamente el mismo contenido que la versión '1'
 *
 * Contenido (en claro o inflado):
 *
 *   4 bloques de paleta, cada uno uint32 con la cantidad de colores (256 en
 *   todo lo observado) seguido de count x (R, G, B, relleno); luego 9 bytes
 *   sin identificar y después los frames, separados por 12 bytes entre sí.
 *
 * El rectángulo de cada imagen da su posición respecto del punto de apoyo que
 * declara la cabecera del sprite, y eso es lo que permite plantar un personaje
 * sobre una celda. Casi siempre da también su tamaño: sobre 6264 imágenes,
 * 6016 coinciden exacto y las demás difieren en un píxel. En los sprites
 * animados el rectángulo es bastante más grande que la imagen, probablemente
 * porque conserva la caja original mientras el ZAR viene recortado a su
 * contenido; eso no está confirmado.
 *
 * Qué falta: para qué sirven las otras tres paletas. La primera es la de
 * color y las otras tres son escalas de grises; la hipótesis es recoloreo por
 * facción, pero no está verificada. Tampoco se identificaron los 9 y 12 bytes
 * entre imágenes.
 */
import { decodeZarRuns, type ZarImage } from './zar';

const SPRITE_MAGIC = '<sprite>';
const SPRANIM_MAGIC = '<spranim>';
const ANIM_IMG_MAGIC = '<spranim_img>';
/**
 * Hasta dónde buscar el primer `<spranim>`. La cabecera de `<sprite>` es de
 * largo variable porque incluye la lista de variantes con nombre, así que no
 * se puede asumir un offset fijo.
 */
const SPRANIM_SEARCH_LIMIT = 64 * 1024;
/** Los offsets de `<spranim>` se miden desde este byte. */
const OFFSET_BASE = 0x0c;
/** Bytes por imagen en la tabla de rectángulos; hay una por dirección y frame. */
const FRAME_TABLE_STRIDE = 16;
const PALETTE_BLOCKS = 4;
/**
 * Entre las paletas y el primer frame, y entre un frame y el siguiente, hay
 * bloques chicos de metadatos de largo variable: se vieron 9, 10 y 12 bytes.
 * No están descifrados, así que el frame se ubica buscando su firma dentro de
 * esta ventana en vez de asumir un salto fijo.
 */
const FRAME_SEARCH_WINDOW = 64;
const FRAME_MAGIC = '<zar>';
/** Cabecera de un frame: "<zar>" 00 '4' 00 + ancho + alto + 1 byte + tamaño. */
const FRAME_HEADER = 21;
const FRAME_SIZE_OFFSET = 17;

export class InvalidSpriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSpriteError';
  }
}

/** Rectángulo de una imagen dentro del espacio del sprite. */
export interface SpriteRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SpriteAnimation {
  name: string;
  directions: number;
  framesPerDirection: number;
  /**
   * Imágenes que declara el encabezado: direcciones por frames. Es una cota
   * superior; `countSpriteImages` dice cuántas hay realmente guardadas.
   */
  imageCount: number;
  /** Offset absoluto del cierre del magic `<spranim_img>` de esta animación. */
  dataOffset: number;
  /** Dónde termina el bloque de esta animación: donde arranca el siguiente, o el fin del archivo. */
  dataEnd: number;
  /** Una entrada por imagen declarada, en el mismo orden. */
  rects: readonly SpriteRect[];
}

/**
 * Punto de apoyo del sprite, en el mismo espacio que los rectángulos.
 * Restarlo a la esquina del rectángulo da dónde dibujar la imagen respecto de
 * la celda, igual que el ancla de un tile.
 */
export function readSpriteReference(bytes: Uint8Array): { x: number; y: number } {
  if (!isSprite(bytes)) throw new InvalidSpriteError('El archivo no empieza con la firma <sprite>');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { x: view.getUint32(14, true), y: view.getUint32(18, true) };
}

export interface SpriteFrame extends ZarImage {
  animation: string;
  frameIndex: number;
  /**
   * Rectángulo declarado para esta imagen, o null si no lo trae. Algunas
   * animaciones —casi todas overlays de efectos— lo dejan en ceros.
   */
  rect: SpriteRect | null;
}

function readAscii(bytes: Uint8Array, at: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[at + i]);
  return text;
}

function matchesAscii(bytes: Uint8Array, text: string, at: number): boolean {
  if (at < 0 || at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export function isSprite(bytes: Uint8Array): boolean {
  return matchesAscii(bytes, SPRITE_MAGIC, 0);
}

/** Ubica el primer encabezado de animación. Devuelve -1 si no hay ninguno. */
function findFirstSpranim(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - SPRANIM_MAGIC.length, SPRANIM_SEARCH_LIMIT);
  for (let at = SPRITE_MAGIC.length; at <= limit; at++) {
    if (matchesAscii(bytes, SPRANIM_MAGIC, at)) return at;
  }
  return -1;
}

/**
 * Lee la cadena de encabezados de animación. Es barato: no toca los datos de
 * imagen ni descomprime nada.
 */
export function readSpriteAnimations(bytes: Uint8Array): SpriteAnimation[] {
  if (!isSprite(bytes)) throw new InvalidSpriteError('El archivo no empieza con la firma <sprite>');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const animations: SpriteAnimation[] = [];
  let at = findFirstSpranim(bytes);
  if (at < 0) throw new InvalidSpriteError('El sprite no declara ninguna animación');

  while (matchesAscii(bytes, SPRANIM_MAGIC, at)) {
    if (at + 20 > bytes.length) break;
    const dataOffset = view.getUint32(at + 12, true) + OFFSET_BASE;
    const nameLength = view.getUint32(at + 16, true);
    const nameAt = at + 20;
    if (nameAt + nameLength + 8 > bytes.length) {
      throw new InvalidSpriteError(`El encabezado de animación en 0x${at.toString(16)} se sale del archivo`);
    }

    const after = nameAt + nameLength;
    // El primero es la cantidad de frames y el segundo la de direcciones, no
    // al revés: se comprobó sobre "MF Upright Run", que declara 10 y 8. Los
    // índices 0..9 son diez frames de la misma orientación y saltando de a 10
    // salen las ocho orientaciones. Leerlo invertido pasa inadvertido en las
    // animaciones de 8x8, que son muchas, y el total no cambia porque es el
    // producto.
    const framesPerDirection = view.getUint32(after, true);
    const directions = view.getUint32(after + 4, true);
    const imageCount = directions * framesPerDirection;
    const tableAt = after + 8;
    if (tableAt + imageCount * FRAME_TABLE_STRIDE > bytes.length) {
      throw new InvalidSpriteError(`La tabla de rectángulos de 0x${at.toString(16)} se sale del archivo`);
    }
    const rects: SpriteRect[] = [];
    for (let i = 0; i < imageCount; i++) {
      const base = tableAt + i * FRAME_TABLE_STRIDE;
      rects.push({
        left: view.getUint32(base, true),
        top: view.getUint32(base + 4, true),
        right: view.getUint32(base + 8, true),
        bottom: view.getUint32(base + 12, true),
      });
    }

    animations.push({
      name: readAscii(bytes, nameAt, nameLength),
      directions,
      framesPerDirection,
      imageCount,
      dataOffset,
      dataEnd: bytes.length,
      rects,
    });

    at = after + 8 + imageCount * FRAME_TABLE_STRIDE;
  }

  if (animations.length === 0) throw new InvalidSpriteError('El sprite no declara ninguna animación');

  // Cada bloque termina donde empieza el siguiente. Hace falta saberlo para no
  // pasarle al descompresor los bloques que vienen después, que lo hacen fallar.
  const starts = animations.map((a) => a.dataOffset - (ANIM_IMG_MAGIC.length - 1)).sort((x, y) => x - y);
  for (const animation of animations) {
    const next = starts.find((start) => start > animation.dataOffset);
    if (next !== undefined) animation.dataEnd = next;
  }
  return animations;
}

/**
 * Infla un flujo zlib del que no se conoce el largo comprimido: después del
 * flujo vienen las demás animaciones. Se lee hasta juntar `expected` bytes y
 * se corta ahí; dejar que el stream siga hasta el final lo haría fallar por
 * los bytes de más.
 */
async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const out = new Uint8Array(expected);
  let filled = 0;
  try {
    while (filled < expected) {
      const { value, done } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, expected - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (filled !== expected) {
    throw new InvalidSpriteError(`El flujo comprimido dio ${filled} bytes y declaraba ${expected}`);
  }
  return out;
}

/**
 * Devuelve el contenido del bloque `<spranim_img>`, descomprimiéndolo si hace
 * falta. El resultado tiene la misma forma en las dos versiones.
 */
async function readAnimationPayload(bytes: Uint8Array, animation: SpriteAnimation): Promise<Uint8Array> {
  // `dataOffset` cae sobre el ">" que cierra el magic.
  const magicAt = animation.dataOffset - (ANIM_IMG_MAGIC.length - 1);
  if (!matchesAscii(bytes, ANIM_IMG_MAGIC, magicAt)) {
    throw new InvalidSpriteError(`No hay <spranim_img> en 0x${magicAt.toString(16)} para "${animation.name}"`);
  }

  const version = String.fromCharCode(bytes[animation.dataOffset + 2]);
  if (version === '1') return bytes.subarray(animation.dataOffset + 4);
  if (version !== '2') {
    throw new InvalidSpriteError(`Versión de <spranim_img> no soportada: '${version}'`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expected = view.getUint32(animation.dataOffset + 4, true);
  return inflate(bytes.subarray(animation.dataOffset + 8, animation.dataEnd), expected);
}

function isAllZero(bytes: Uint8Array, from: number): boolean {
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

/** Busca la firma de la próxima imagen a partir de `from`. -1 si no hay más. */
function findFrame(payload: Uint8Array, from: number): number {
  const limit = Math.min(payload.length - FRAME_MAGIC.length, from + FRAME_SEARCH_WINDOW);
  for (let at = from; at <= limit; at++) {
    if (matchesAscii(payload, FRAME_MAGIC, at)) return at;
  }
  return -1;
}

/** Salta las cuatro paletas y devuelve dónde termina la última. */
function afterPalettes(payload: Uint8Array, view: DataView): number {
  let at = 0;
  for (let i = 0; i < PALETTE_BLOCKS; i++) {
    if (at + 4 > payload.length) throw new InvalidSpriteError('El bloque se corta en las paletas');
    at += 4 + view.getUint32(at, true) * 4;
  }
  return at;
}

/**
 * Recorre las imágenes guardadas hasta la `index`-ésima.
 *
 * Las imágenes efectivamente guardadas pueden ser menos que las que declara el
 * encabezado: `direcciones x frames` describe la animación, no el contenido.
 * Por eso el recorrido es la única fuente confiable de cuántas hay.
 */
function walkToImage(
  payload: Uint8Array,
  view: DataView,
  index: number,
): { offset: number; stored: number } {
  let at = findFrame(payload, afterPalettes(payload, view));
  if (at < 0) return { offset: -1, stored: 0 };

  for (let i = 0; i < index; i++) {
    if (at + FRAME_HEADER > payload.length) return { offset: -1, stored: i + 1 };
    const next = findFrame(payload, at + FRAME_HEADER + view.getUint32(at + FRAME_SIZE_OFFSET, true));
    if (next < 0) return { offset: -1, stored: i + 1 };
    at = next;
  }
  return { offset: at, stored: index + 1 };
}

/** Cuenta las imágenes realmente guardadas en una animación. */
export async function countSpriteImages(bytes: Uint8Array, animationIndex = 0): Promise<number> {
  const animation = readSpriteAnimations(bytes)[animationIndex];
  if (!animation) throw new InvalidSpriteError(`No existe la animación ${animationIndex}`);
  const payload = await readAnimationPayload(bytes, animation);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  let at = findFrame(payload, afterPalettes(payload, view));
  let count = 0;
  while (at >= 0 && at + FRAME_HEADER <= payload.length) {
    count++;
    at = findFrame(payload, at + FRAME_HEADER + view.getUint32(at + FRAME_SIZE_OFFSET, true));
  }
  return count;
}

/** Un rectángulo en ceros significa que la animación no lo declara. */
function declaredRect(rect: SpriteRect | undefined): SpriteRect | null {
  if (!rect) return null;
  if (rect.left === 0 && rect.top === 0 && rect.right === 0 && rect.bottom === 0) return null;
  return rect;
}

/** Frame sin datos de imagen; ver `findFrame`. */
function emptyFrame(animation: string, frameIndex: number): SpriteFrame {
  return {
    width: 0,
    height: 0,
    pixels: new Uint8ClampedArray(0),
    pixelsWritten: 0,
    bytesConsumed: 0,
    declaredDataSize: 0,
    animation,
    frameIndex,
    rect: null,
  };
}

export interface DecodeSpriteFrameOptions {
  /** Cuál de las cuatro paletas usar. La 0 es la de color. */
  paletteIndex?: number;
}

/**
 * Decodifica todas las imágenes guardadas de una animación.
 *
 * Existe aparte de `decodeSpriteFrame` porque el bloque de la animación puede
 * venir comprimido, y pedir las imágenes de a una lo infla otras tantas
 * veces. En un sprite de personaje eso son decenas de inflados de varios
 * megabytes cada uno; acá se infla una sola vez.
 */
export async function decodeSpriteAnimation(
  bytes: Uint8Array,
  animationIndex = 0,
  { paletteIndex = 0 }: DecodeSpriteFrameOptions = {},
): Promise<SpriteFrame[]> {
  const animations = readSpriteAnimations(bytes);
  const animation = animations[animationIndex];
  if (!animation) throw new InvalidSpriteError(`No existe la animación ${animationIndex}`);
  if (paletteIndex < 0 || paletteIndex >= PALETTE_BLOCKS) {
    throw new InvalidSpriteError(`Paleta ${paletteIndex} fuera de rango`);
  }

  const payload = await readAnimationPayload(bytes, animation);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const paletteAt = paletteOffset(view, paletteIndex);

  const out: SpriteFrame[] = [];
  let at = findFrame(payload, afterPalettes(payload, view));
  // El bloque puede tener más imágenes de las que la animación declara; se
  // corta en el total declarado para no arrastrar las que no le pertenecen.
  while (at >= 0 && at + FRAME_HEADER <= payload.length && out.length < animation.imageCount) {
    out.push(frameAt(payload, view, at, paletteAt, animation.name, out.length, animation.rects));
    at = findFrame(payload, at + FRAME_HEADER + view.getUint32(at + FRAME_SIZE_OFFSET, true));
  }
  if (out.length === 0 && isAllZero(payload, afterPalettes(payload, view))) {
    out.push(emptyFrame(animation.name, 0));
  }
  return out;
}

/** Offset de los colores de una paleta dentro del bloque. */
function paletteOffset(view: DataView, paletteIndex: number): number {
  let at = 0;
  for (let i = 0; i < paletteIndex; i++) at += 4 + view.getUint32(at, true) * 4;
  return at + 4; // saltear la cantidad de colores
}

/** Decodifica la imagen que empieza en `at`. */
function frameAt(
  payload: Uint8Array,
  view: DataView,
  at: number,
  paletteAt: number,
  animationName: string,
  frameIndex: number,
  rects: readonly SpriteRect[],
): SpriteFrame {
  const width = view.getUint32(at + 8, true);
  const height = view.getUint32(at + 12, true);
  const declaredDataSize = view.getUint32(at + FRAME_SIZE_OFFSET, true);
  if (width * height > 64 * 1024 * 1024) {
    throw new InvalidSpriteError(`Frame demasiado grande: ${width}x${height}`);
  }

  const dataStart = at + FRAME_HEADER;
  const available = Math.max(0, payload.length - dataStart);
  const data = payload.subarray(dataStart, dataStart + Math.min(declaredDataSize, available));
  return {
    ...decodeZarRuns(data, width, height, payload, paletteAt),
    declaredDataSize,
    animation: animationName,
    frameIndex,
    rect: declaredRect(rects[frameIndex]),
  };
}

/**
 * Decodifica un frame. `animationIndex` y `frameIndex` se validan contra lo
 * que declara el archivo, que puede venir de una instalación cualquiera.
 */
export async function decodeSpriteFrame(
  bytes: Uint8Array,
  animationIndex = 0,
  frameIndex = 0,
  { paletteIndex = 0 }: DecodeSpriteFrameOptions = {},
): Promise<SpriteFrame> {
  const animations = readSpriteAnimations(bytes);
  const animation = animations[animationIndex];
  if (!animation) throw new InvalidSpriteError(`No existe la animación ${animationIndex}`);
  // Cota superior barata; el recorrido de abajo da la cuenta exacta.
  if (frameIndex < 0 || frameIndex >= animation.imageCount) {
    throw new InvalidSpriteError(`"${animation.name}" declara ${animation.imageCount} imágenes, se pidió la ${frameIndex}`);
  }
  if (paletteIndex < 0 || paletteIndex >= PALETTE_BLOCKS) {
    throw new InvalidSpriteError(`Paleta ${paletteIndex} fuera de rango`);
  }

  const payload = await readAnimationPayload(bytes, animation);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  let paletteAt = 0;
  for (let i = 0; i < paletteIndex; i++) paletteAt += 4 + view.getUint32(paletteAt, true) * 4;
  paletteAt += 4; // saltear la cantidad de colores

  // Los frames van encadenados: cada uno declara su tamaño y los separa un hueco fijo.
  const { offset: at, stored } = walkToImage(payload, view, frameIndex);
  if (at < 0) {
    // Un bloque en cero es dato legítimo: "Projectile Invisi" declara ocho
    // imágenes y no guarda ninguna.
    if (stored === 0 && isAllZero(payload, afterPalettes(payload, view))) {
      return emptyFrame(animation.name, frameIndex);
    }
    throw new InvalidSpriteError(
      `"${animation.name}" guarda ${stored} imágenes, se pidió la ${frameIndex}`,
    );
  }
  if (at + FRAME_HEADER > payload.length) {
    throw new InvalidSpriteError(`El frame ${frameIndex} de "${animation.name}" se sale del bloque`);
  }

  const width = view.getUint32(at + 8, true);
  const height = view.getUint32(at + 12, true);
  const declaredDataSize = view.getUint32(at + FRAME_SIZE_OFFSET, true);
  // Un frame de 0x0 es dato legítimo: "Projectile Invisi" declara ocho.
  if (width * height > 64 * 1024 * 1024) throw new InvalidSpriteError(`Frame demasiado grande: ${width}x${height}`);

  const dataStart = at + FRAME_HEADER;
  const available = Math.max(0, payload.length - dataStart);
  const data = payload.subarray(dataStart, dataStart + Math.min(declaredDataSize, available));
  const decoded = decodeZarRuns(data, width, height, payload, paletteAt);

  return {
    ...decoded,
    declaredDataSize,
    animation: animation.name,
    frameIndex,
    rect: declaredRect(animation.rects[frameIndex]),
  };
}
