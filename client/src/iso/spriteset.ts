/**
 * Puente entre los `.SPR` del `.BOS` del usuario y el render isométrico.
 *
 * Igual que con los tiles, la imagen se decodifica una vez y se cachea como
 * `ImageBitmap`: el lobby la vuelve a dibujar en cada cuadro.
 */
import { decodeSpriteFrame, readSpriteAnimations, readSpriteReference } from '../sprites/sprite';

/** Octantes que entiende el servidor. Algunas animaciones declaran más. */
export const DIRECTIONS = 8;

export interface LoadedSprite {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /**
   * Punto de la imagen que se apoya en la celda. Sale de restarle al punto de
   * referencia del sprite la esquina del rectángulo de esta imagen, que es lo
   * que declara dónde va cada una dentro del espacio del sprite.
   */
  anchorX: number;
  anchorY: number;
  animation: string;
}

const cache = new Map<string, LoadedSprite>();

/**
 * Decodifica una imagen de un `.SPR` y la deja lista para dibujar.
 *
 * Las imágenes van agrupadas por dirección: el índice es
 * `dirección * framesPorDirección + frame`. Se comprobó dibujando las ocho
 * direcciones de un vehículo, que con ese orden salen distintas y con el otro
 * salen todas iguales.
 */
export async function loadSpriteImage(
  key: string,
  bytes: Uint8Array,
  animationIndex = 0,
  imageIndex = 0,
): Promise<LoadedSprite> {
  const cacheKey = `${key}#${animationIndex}:${imageIndex}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const reference = readSpriteReference(bytes);
  const frame = await decodeSpriteFrame(bytes, animationIndex, imageIndex);
  if (frame.width === 0 || frame.height === 0) {
    throw new Error(`La imagen ${imageIndex} de "${frame.animation}" no tiene píxeles`);
  }

  const bitmap = await createImageBitmap(new ImageData(frame.pixels, frame.width, frame.height));
  // Sin rectángulo no se sabe dónde va: se la planta centrada y por su base.
  const anchorX = frame.rect ? reference.x - frame.rect.left : Math.floor(frame.width / 2);
  const anchorY = frame.rect ? reference.y - frame.rect.top : frame.height;

  const loaded: LoadedSprite = {
    bitmap,
    width: frame.width,
    height: frame.height,
    anchorX,
    anchorY,
    animation: frame.animation,
  };
  cache.set(cacheKey, loaded);
  return loaded;
}

/**
 * Carga una imagen por dirección de una animación, en el orden que usa el
 * servidor para el campo `facing`.
 *
 * Se toman como mucho ocho: hay animaciones que declaran nueve, y la novena
 * no es un rumbo más. Si declara menos de ocho, o alguna no tiene imagen, se
 * devuelven las que haya y quien dibuja cae a la primera.
 */
export async function loadSpriteDirections(
  key: string,
  bytes: Uint8Array,
  animationIndex = 0,
  frame = 0,
): Promise<LoadedSprite[]> {
  const animation = readSpriteAnimations(bytes)[animationIndex];
  if (!animation) throw new Error(`No existe la animación ${animationIndex}`);

  const out: LoadedSprite[] = [];
  const total = Math.min(animation.directions, DIRECTIONS);
  for (let direction = 0; direction < total; direction++) {
    const index = direction * animation.framesPerDirection + frame;
    if (index >= animation.imageCount) break;
    try {
      out.push(await loadSpriteImage(key, bytes, animationIndex, index));
    } catch {
      // Una dirección sin imagen no debería tirar abajo a las demás.
      break;
    }
  }
  if (out.length === 0) throw new Error(`"${animation.name}" no tiene ninguna imagen utilizable`);
  return out;
}

/** Nombres de las animaciones, para elegir cuál mostrar. */
export function spriteAnimationNames(bytes: Uint8Array): string[] {
  return readSpriteAnimations(bytes).map((a) => a.name);
}

/**
 * Animación con la que mostrar al personaje girando.
 *
 * Se prefiere una que declare exactamente ocho direcciones: el orden de los
 * rumbos se verificó sobre una de esas, y las que declaran nueve podrían usar
 * otro. Si no hay ninguna se cae a cualquiera que cubra los ocho, y si
 * tampoco, a la primera.
 */
export function pickDirectionalAnimation(bytes: Uint8Array): number {
  const animations = readSpriteAnimations(bytes);
  const exacta = animations.findIndex((a) => a.directions === DIRECTIONS);
  if (exacta >= 0) return exacta;
  const alguna = animations.findIndex((a) => a.directions >= DIRECTIONS);
  return alguna >= 0 ? alguna : 0;
}

export function clearSpriteCache(): void {
  for (const sprite of cache.values()) sprite.bitmap.close();
  cache.clear();
}
