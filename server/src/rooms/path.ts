/**
 * Caminos sobre la grilla: lo que hace falta para moverse con un click.
 *
 * Es un recorrido en anchura en ocho direcciones, primero las rectas para
 * que el camino no zigzaguee. Lo usan el jugador que hace click en una celda
 * y los enemigos que van a buscar a alguien.
 */
import { STAIRS_DOWN, STAIRS_UP, isBlocked, type Cell, type GameMap } from './map';

/**
 * Cada cuánto da un paso quien sigue una ruta. Es la duración de un paso en
 * el cliente (`PASO_MS` de `motion.ts`): si no coinciden, la caminata se ve
 * a tirones.
 */
export const PASO_RUTA_MS = 300;

/** Los ocho pasos posibles. Primero los rectos, para que el camino no zigzaguee. */
export const PASOS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 },
] as const;

export interface PathOptions {
  /** Qué celdas tienen a alguien. No se las atraviesa. */
  ocupada?: (x: number, y: number) => boolean;
  /**
   * Si se puede pisar una celda que no es pared. Por defecto, todo menos las
   * escaleras, que solo valen como destino: pisar una cambia de piso, y eso
   * no puede pasar por accidente en medio de un camino.
   */
  pisable?: (x: number, y: number, esDestino: boolean) => boolean;
  /**
   * Con esto alcanza con llegar al lado del destino: es para ir a abrir un
   * contenedor o una puerta, o a alguien, que no se pueden pisar.
   */
  alLado?: boolean;
  /** Largo máximo del camino. Más que esto se considera que no hay. */
  max?: number;
}

const esEscalera = (map: GameMap, x: number, y: number): boolean => {
  const c = map.cells[y * map.width + x];
  return c === STAIRS_DOWN || c === STAIRS_UP;
};

/** Si dos celdas se tocan, también en diagonal, o son la misma. */
export const alcanza = (a: Cell, b: Cell): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;

/**
 * El camino más corto de `desde` a `hasta`, sin contar la celda de partida:
 * vacío si ya se está ahí (o al lado, con `alLado`), `null` si no hay.
 */
export function findPath(map: GameMap, desde: Cell, hasta: Cell, opciones: PathOptions = {}): Cell[] | null {
  const { ocupada = () => false, alLado = false, max = map.width * map.height } = opciones;
  const pisable = opciones.pisable ?? ((x, y, esDestino) => !esEscalera(map, x, y) || esDestino);
  const llego = (c: Cell) => (alLado ? alcanza(c, hasta) : c.x === hasta.x && c.y === hasta.y);
  if (llego(desde)) return [];

  const clave = (x: number, y: number) => y * map.width + x;
  const previo = new Map<number, number>();
  const vistos = new Set([clave(desde.x, desde.y)]);
  let frente: Cell[] = [desde];
  for (let largo = 1; largo <= max && frente.length > 0; largo++) {
    const siguiente: Cell[] = [];
    for (const actual of frente) {
      for (const { dx, dy } of PASOS) {
        const x = actual.x + dx;
        const y = actual.y + dy;
        const k = clave(x, y);
        if (vistos.has(k) || isBlocked(map, x, y)) continue;
        const esDestino = x === hasta.x && y === hasta.y;
        if (!pisable(x, y, esDestino)) continue;
        // El destino se acepta ocupado: sin eso no se podría ir hacia alguien.
        if (!esDestino && ocupada(x, y)) continue;
        vistos.add(k);
        previo.set(k, clave(actual.x, actual.y));
        if (llego({ x, y }) && !(alLado && ocupada(x, y))) return reconstruir(previo, k, clave(desde.x, desde.y), map.width);
        siguiente.push({ x, y });
      }
    }
    frente = siguiente;
  }
  return null;
}

function reconstruir(previo: Map<number, number>, fin: number, inicio: number, ancho: number): Cell[] {
  const out: Cell[] = [];
  for (let k = fin; k !== inicio; k = previo.get(k)!) out.push({ x: k % ancho, y: Math.floor(k / ancho) });
  return out.reverse();
}
