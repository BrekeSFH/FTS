/**
 * Generación del mapa de una instancia.
 *
 * El GDD pide mazmorras generadas en el servidor ensamblando piezas. Esto es
 * el primer escalón de eso: una sala rectangular con sus paredes y algunos
 * bloques adentro. Lo que importa acá no es la forma sino que el mapa sea
 * **dato del servidor**: hasta ahora el cliente dibujaba paredes donde se le
 * ocurría y no bloqueaban nada.
 *
 * Se representa como una cadena de un carácter por celda, en orden de fila.
 * Es compacto, se sincroniza como un campo más y se lee de un vistazo en un
 * test, que para un mapa estático alcanza y sobra.
 */

export const FLOOR = '.';
export const WALL = '#';

export interface GameMap {
  width: number;
  height: number;
  /** Una celda por carácter, fila por fila. */
  cells: string;
}

/**
 * Generador reproducible. Con la misma semilla sale el mismo mapa, que es lo
 * que permite testear la generación y, más adelante, que todos los clientes
 * de una instancia vean lo mismo sin mandar el mapa entero.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32: alcanza de sobra y cabe en cinco líneas.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

export function isBlocked(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.cells[y * map.width + x] === WALL;
}

export interface GenerateOptions {
  /** Cuántos bloques sueltos poner adentro. */
  obstacles?: number;
}

/**
 * Sala rectangular: paredes en todo el perímetro y algunos bloques adentro.
 *
 * Los bloques nunca tocan el borde interior ni se pegan entre sí, para que no
 * puedan encerrar una zona. No es una comprobación de conectividad —eso hará
 * falta cuando haya pasillos— pero evita el caso que rompe una sala simple.
 */
export function generateRoom(
  width: number,
  height: number,
  seed: number,
  { obstacles = 10 }: GenerateOptions = {},
): GameMap {
  if (width < 3 || height < 3) throw new Error(`Sala demasiado chica: ${width}x${height}`);

  const cells = new Array<string>(width * height).fill(FLOOR);
  const at = (x: number, y: number) => y * width + x;
  const perimetro = (x: number, y: number) => x === 0 || y === 0 || x === width - 1 || y === height - 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (perimetro(x, y)) cells[at(x, y)] = WALL;
    }
  }

  const random = createRandom(seed);
  const libreAlrededor = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (perimetro(nx, ny)) continue;
        if (cells[at(nx, ny)] === WALL) return false;
      }
    }
    return true;
  };

  // Margen de dos celdas: pegado a la pared tampoco, para no hacer rincones.
  let intentos = obstacles * 20;
  let puestos = 0;
  while (puestos < obstacles && intentos-- > 0) {
    const x = 2 + Math.floor(random() * Math.max(1, width - 4));
    const y = 2 + Math.floor(random() * Math.max(1, height - 4));
    if (x >= width - 2 || y >= height - 2) continue;
    if (!libreAlrededor(x, y)) continue;
    cells[at(x, y)] = WALL;
    puestos++;
  }

  return { width, height, cells: cells.join('') };
}
