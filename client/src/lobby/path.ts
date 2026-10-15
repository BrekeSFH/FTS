/**
 * El camino que se va a caminar con un click, para mostrarlo antes.
 *
 * Es el mismo recorrido que hace el servidor (`server/src/rooms/path.ts`),
 * pero sobre el mapa que el cliente conoce. Sirve solo para dibujar: el
 * camino de verdad lo arma el servidor, que es el que sabe todo.
 */
import type { Point } from '../iso/projection';

const PASOS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

export interface PreviewMap {
  width: number;
  height: number;
  /** Una celda por carácter. `#` es pared o algo que no se conoce. */
  cells: string;
}

const ESCALERAS = new Set(['>', '<']);

/**
 * El camino más corto, sin la celda de partida, o `null` si no hay. Con
 * `alLado` alcanza con llegar al lado, como para abrir un contenedor.
 */
export function previewPath(
  map: PreviewMap,
  desde: Point,
  hasta: Point,
  ocupada: (x: number, y: number) => boolean,
  alLado = false,
): Point[] | null {
  const dentro = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height;
  const llego = (x: number, y: number) =>
    alLado ? Math.max(Math.abs(x - hasta.x), Math.abs(y - hasta.y)) <= 1 : x === hasta.x && y === hasta.y;
  if (llego(desde.x, desde.y)) return [];
  if (!dentro(hasta.x, hasta.y)) return null;

  const clave = (x: number, y: number) => y * map.width + x;
  const previo = new Map<number, number>();
  const vistos = new Set([clave(desde.x, desde.y)]);
  let frente: Point[] = [desde];
  while (frente.length > 0) {
    const siguiente: Point[] = [];
    for (const actual of frente) {
      for (const [dx, dy] of PASOS) {
        const x = actual.x + dx;
        const y = actual.y + dy;
        const k = clave(x, y);
        if (!dentro(x, y) || vistos.has(k)) continue;
        const c = map.cells[k];
        const esDestino = x === hasta.x && y === hasta.y;
        if (c === '#' || c === undefined || (ESCALERAS.has(c) && !esDestino)) continue;
        if (!esDestino && ocupada(x, y)) continue;
        vistos.add(k);
        previo.set(k, clave(actual.x, actual.y));
        if (llego(x, y)) {
          const out: Point[] = [];
          for (let p = k; p !== clave(desde.x, desde.y); p = previo.get(p)!) {
            out.push({ x: p % map.width, y: Math.floor(p / map.width) });
          }
          return out.reverse();
        }
        siguiente.push({ x, y });
      }
    }
    frente = siguiente;
  }
  return null;
}
