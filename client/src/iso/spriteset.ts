/**
 * Puente entre los `.SPR` del `.BOS` del usuario y el render isométrico.
 *
 * Igual que con los tiles, la imagen se decodifica una vez y se cachea como
 * `ImageBitmap`: el lobby la vuelve a dibujar en cada cuadro.
 */
import {
  decodeSpriteAnimation,
  decodeSpriteFrame,
  readSpriteAnimations,
  readSpriteReference,
} from '../sprites/sprite';

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
const animationCache = new Map<string, LoadedAnimation>();

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

/** Una animación entera, lista para dibujar: `images[dirección][frame]`. */
export interface LoadedAnimation {
  name: string;
  /** Imágenes por dirección. Puede haber menos direcciones de las declaradas. */
  images: LoadedSprite[][];
  framesPerDirection: number;
}

/**
 * Carga todas las imágenes de una animación, indexadas por dirección y frame.
 *
 * Las direcciones van en el mismo orden que el campo `facing` del servidor.
 * Se toman como mucho ocho; si alguna imagen falta, se corta ahí y quien
 * dibuja cae a lo que haya.
 */
export async function loadSpriteAnimation(
  key: string,
  bytes: Uint8Array,
  animationIndex = 0,
): Promise<LoadedAnimation> {
  const animation = readSpriteAnimations(bytes)[animationIndex];
  if (!animation) throw new Error(`No existe la animación ${animationIndex}`);

  const cacheKey = `${key}#anim${animationIndex}`;
  const cached = animationCache.get(cacheKey);
  if (cached) return cached;

  const reference = readSpriteReference(bytes);
  // De una sola pasada: pedir las imágenes por separado volvería a inflar el
  // bloque comprimido una vez por cada una.
  const frames = await decodeSpriteAnimation(bytes, animationIndex);

  const images: LoadedSprite[][] = [];
  const total = Math.min(animation.directions, DIRECTIONS);
  for (let direction = 0; direction < total; direction++) {
    const porDireccion: LoadedSprite[] = [];
    for (let frame = 0; frame < animation.framesPerDirection; frame++) {
      const decoded = frames[direction * animation.framesPerDirection + frame];
      if (!decoded || decoded.width === 0) break;
      porDireccion.push({
        bitmap: await createImageBitmap(new ImageData(decoded.pixels, decoded.width, decoded.height)),
        width: decoded.width,
        height: decoded.height,
        anchorX: decoded.rect ? reference.x - decoded.rect.left : Math.floor(decoded.width / 2),
        anchorY: decoded.rect ? reference.y - decoded.rect.top : decoded.height,
        animation: decoded.animation,
      });
    }
    if (porDireccion.length === 0) break;
    images.push(porDireccion);
  }
  if (images.length === 0) throw new Error(`"${animation.name}" no tiene ninguna imagen utilizable`);

  const loaded: LoadedAnimation = {
    name: animation.name,
    images,
    framesPerDirection: images[0].length,
  };
  animationCache.set(cacheKey, loaded);
  return loaded;
}

/** Nombres de las animaciones, para elegir cuál mostrar. */
export function spriteAnimationNames(bytes: Uint8Array): string[] {
  return readSpriteAnimations(bytes).map((a) => a.name);
}

/**
 * Animación con la que mostrar al personaje moviéndose.
 *
 * Se busca primero un ciclo de desplazamiento —en estos sprites se llama
 * "Run", no "Walk"— y se exige que cubra los ocho rumbos. Si no hay, cualquiera
 * de ocho direcciones sirve para al menos girar.
 */
/** Si el nombre de una animacion la delata como un ciclo de desplazamiento. */
function esDesplazamiento(name: string): boolean {
  // Se compara por palabra entera para no confundir "Run" con "Brunswick".
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((palabra) => palabra === 'run' || palabra === 'walk');
}

export function pickDirectionalAnimation(bytes: Uint8Array): number {
  const animations = readSpriteAnimations(bytes);
  const cubreLosOcho = (a: { directions: number }) => a.directions >= DIRECTIONS;
  const caminando = animations.findIndex(
    (a) => cubreLosOcho(a) && esDesplazamiento(a.name),
  );
  if (caminando >= 0) return caminando;
  const cualquiera = animations.findIndex(cubreLosOcho);
  return cualquiera >= 0 ? cualquiera : 0;
}

export function clearSpriteCache(): void {
  for (const sprite of cache.values()) sprite.bitmap.close();
  cache.clear();
  for (const animation of animationCache.values()) {
    for (const direccion of animation.images) for (const img of direccion) img.bitmap.close();
  }
  animationCache.clear();
}
