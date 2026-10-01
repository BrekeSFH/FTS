/**
 * Puente entre los `.SPR` del `.BOS` del usuario y el render isométrico.
 *
 * Igual que con los tiles, la imagen se decodifica una vez y se cachea como
 * `ImageBitmap`: el lobby la vuelve a dibujar en cada cuadro.
 */
import { decodeSpriteFrame, readSpriteAnimations, readSpriteReference } from '../sprites/sprite';

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

/** Nombres de las animaciones, para elegir cuál mostrar. */
export function spriteAnimationNames(bytes: Uint8Array): string[] {
  return readSpriteAnimations(bytes).map((a) => a.name);
}

export function clearSpriteCache(): void {
  for (const sprite of cache.values()) sprite.bitmap.close();
  cache.clear();
}
