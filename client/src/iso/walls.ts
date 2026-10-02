/**
 * Orientación de las paredes.
 *
 * Los tiles de Fallout Tactics vienen en juegos de hasta cuatro, con la
 * orientación al final del nombre: `..._NE.til`, `_NW`, `_SE`, `_SW`. De los
 * 29.957 tiles de una instalación, 9.162 familias usan ese sufijo y solo 11
 * archivos no lo tienen.
 *
 * Dibujar siempre el mismo archivo deja todas las paredes mirando para el
 * mismo lado, que es lo que pasaba antes de esto.
 *
 * Qué sufijo va en cada celda salió de medirlo sobre `bunker01.mis`, cruzando
 * cada pared con dónde tenía piso al lado:
 *
 *   piso en +X del mundo →  NE 94, SW 79
 *   piso en +Z del mundo →  NW 93, SE 75
 *
 * O sea que el eje manda y cada eje tiene dos caras: la de atrás (NE, NW) y
 * la de adelante (SW, SE). Que las de adelante son las que importan lo
 * confirma el catálogo: de las 1.136 familias de pared que no traen las
 * cuatro, 1.105 traen justamente `SE` y `SW`.
 *
 * Ojo con los ejes: la X del mundo es la **fila** de la grilla propia, no la
 * columna (ver `maps/world.ts`). Por eso `SW` va donde hay piso en `+y` y no
 * en `+x`. Haberlo tomado al revés daba paredes con huecos: cada pieza va
 * inclinada para encastrar con la siguiente, y puesta sobre el otro eje se
 * separa en vez de unirse.
 *
 * La cámara isométrica mira desde arriba, así que de una sala se ven las
 * paredes del fondo, y de esas, su cara de adelante.
 */

import { WALL_SUFFIXES, type WallSuffix } from '../tiles/catalogo';

export { WALL_SUFFIXES, type WallSuffix };

/** Si hay piso transitable en esa celda. */
export type IsFloor = (x: number, y: number) => boolean;

const SUFFIX_PATTERN = /^(.*)_(NE|NW|SE|SW)(\.til)$/i;

export interface TileName {
  /** La ruta sin el sufijo ni la extensión. */
  family: string;
  suffix: WallSuffix;
  extension: string;
}

/** Separa una ruta `.til` en familia y orientación, o `null` si no la tiene. */
export function splitOrientation(path: string): TileName | null {
  const match = SUFFIX_PATTERN.exec(path);
  if (!match) return null;
  return {
    family: match[1],
    suffix: match[2].toUpperCase() as WallSuffix,
    extension: match[3],
  };
}

/**
 * La ruta del hermano con otra orientación, conservando la caja del nombre
 * original. `null` si la ruta no declara orientación.
 */
export function siblingPath(path: string, suffix: WallSuffix): string | null {
  const parts = splitOrientation(path);
  if (!parts) return null;
  return `${parts.family}_${suffix}${parts.extension}`;
}

/** Las cuatro rutas hermanas, la propia incluida. */
export function siblingPaths(path: string): Record<WallSuffix, string> | null {
  if (!splitOrientation(path)) return null;
  const out = {} as Record<WallSuffix, string>;
  for (const suffix of WALL_SUFFIXES) out[suffix] = siblingPath(path, suffix)!;
  return out;
}

/** Qué dibujar en una celda de roca. */
export interface WallPlan {
  /** Caras de pared recta, en orden de dibujo. */
  faces: WallSuffix[];
  /** Si la celda es el vértice donde se juntan dos tramos. */
  corner: boolean;
}

/**
 * Qué dibujar en una celda de roca.
 *
 * Sin caras no hay que dibujar nada: la roca que solo tiene piso detrás sería
 * la pared cercana y taparía la sala, y la rodeada de roca no la ve nadie.
 *
 * La diagonal cuenta, pero solo cuando no hay piso en ninguno de los dos
 * lados rectos. El vértice de una sala está en esa situación: sin él la
 * esquina queda abierta. En medio de un tramo la diagonal también da a la
 * sala, y contarla ahí agregaría una cara perpendicular que no corresponde.
 *
 * El vértice se marca aparte porque ahí los dos tramos se cruzan: dibujar las
 * dos caras sobre la misma celda las superpone a la vista. Con una pieza de
 * esquina del juego queda una L; sin ella se cae a las dos caras, que cierra
 * el hueco aunque se note el cruce.
 */
export function wallPlan(isFloor: IsFloor, x: number, y: number): WallPlan {
  const alLadoX = isFloor(x + 1, y);
  const alLadoY = isFloor(x, y + 1);
  const vertice = !alLadoX && !alLadoY && isFloor(x + 1, y + 1);

  const faces: WallSuffix[] = [];
  if (alLadoY || vertice) faces.push('SW');
  if (alLadoX || vertice) faces.push('SE');
  return { faces, corner: vertice };
}

/** Las caras de pared recta de una celda. */
export function wallFaces(isFloor: IsFloor, x: number, y: number): WallSuffix[] {
  return wallPlan(isFloor, x, y).faces;
}

/** Si una celda de roca hay que dibujarla como pared. */
export function shouldDrawWall(isFloor: IsFloor, x: number, y: number): boolean {
  return wallFaces(isFloor, x, y).length > 0;
}
