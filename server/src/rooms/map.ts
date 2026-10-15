/**
 * Generación del mapa de una instancia.
 *
 * El GDD pide mazmorras generadas en el servidor ensamblando piezas. Esto
 * genera salas rectangulares conectadas por pasillos en L, que es el escalón
 * anterior a ensamblar piezas reales de los archivos del juego.
 *
 * La conectividad sale por construcción: cada sala nueva se conecta con la
 * anterior, así que todas quedan alcanzables desde cualquiera. Igual se
 * comprueba con un recorrido en los tests, porque "por construcción" es
 * justamente el tipo de afirmación que conviene verificar.
 *
 * Se representa como una cadena de un carácter por celda, en orden de fila.
 * Es compacto, se sincroniza como un campo más y se lee de un vistazo en un
 * test.
 */

export const FLOOR = '.';
export const WALL = '#';
/** Escalera que baja al piso siguiente. Se camina como un piso más. */
export const STAIRS_DOWN = '>';
/** Escalera que sube al piso anterior. */
export const STAIRS_UP = '<';

export interface GameMap {
  width: number;
  height: number;
  /** Una celda por carácter, fila por fila. */
  cells: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Generador reproducible. Con la misma semilla sale el mismo mapa, que es lo
 * que permite testear la generación y, más adelante, que todos los clientes
 * de una instancia vean lo mismo sin mandar el mapa entero.
 */
export function createRandom(seed: number): () => number {
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

/**
 * Una semilla para una instancia nueva.
 *
 * Sale de `Math.random` y no del reloj: dos salas creadas en el mismo
 * milisegundo compartirían mazmorra y decoración. La reproducibilidad no se
 * pierde, porque quien quiera repetir una instancia pasa la semilla a mano,
 * que es lo que hacen los tests.
 */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffff_ffff) >>> 0) || 1;
}

export function isBlocked(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.cells[y * map.width + x] === WALL;
}

/** Celdas transitables del mapa. */
export function floorCells(map: GameMap): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isBlocked(map, x, y)) out.push({ x, y });
    }
  }
  return out;
}

/** Si dos rectángulos se tocan dejando al menos `gap` celdas entre ellos. */
function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x - gap < b.x + b.width &&
    b.x - gap < a.x + a.width &&
    a.y - gap < b.y + b.height &&
    b.y - gap < a.y + a.height
  );
}

const center = (r: Rect) => ({
  x: r.x + Math.floor(r.width / 2),
  y: r.y + Math.floor(r.height / 2),
});

export interface GenerateOptions {
  /** Cuántas salas intentar colocar. */
  rooms?: number;
  minRoom?: number;
  maxRoom?: number;
}

export interface GeneratedMap extends GameMap {
  /** Las salas colocadas, útiles para decidir dónde aparece la gente. */
  rooms: Rect[];
}

/**
 * Salas rectangulares conectadas por pasillos en L.
 *
 * Todo arranca como roca y se excava. El perímetro nunca se toca: las salas
 * se colocan con un margen y los pasillos van de centro a centro, así que no
 * pueden llegar al borde.
 */
export function generateMap(
  width: number,
  height: number,
  seed: number,
  { rooms = 6, minRoom = 4, maxRoom = 8 }: GenerateOptions = {},
): GeneratedMap {
  if (width < minRoom + 4 || height < minRoom + 4) {
    throw new Error(`Mapa demasiado chico para salas de ${minRoom}: ${width}x${height}`);
  }

  const cells = new Array<string>(width * height).fill(WALL);
  const at = (x: number, y: number) => y * width + x;
  const random = createRandom(seed);
  const entero = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

  const placed: Rect[] = [];
  // Muchos intentos y pocas salas: colocar al azar sin solaparse falla seguido.
  for (let intento = 0; intento < rooms * 40 && placed.length < rooms; intento++) {
    const w = entero(minRoom, Math.min(maxRoom, width - 4));
    const h = entero(minRoom, Math.min(maxRoom, height - 4));
    const rect: Rect = {
      x: entero(2, width - w - 2),
      y: entero(2, height - h - 2),
      width: w,
      height: h,
    };
    // Una celda de separación: dos salas pegadas serían una sola sala rara.
    if (placed.some((otra) => overlaps(rect, otra, 1))) continue;
    placed.push(rect);
  }
  if (placed.length === 0) throw new Error(`No entró ninguna sala en ${width}x${height}`);

  for (const rect of placed) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) cells[at(x, y)] = FLOOR;
    }
  }

  const excavarFila = (y: number, desde: number, hasta: number) => {
    for (let x = Math.min(desde, hasta); x <= Math.max(desde, hasta); x++) cells[at(x, y)] = FLOOR;
  };
  const excavarColumna = (x: number, desde: number, hasta: number) => {
    for (let y = Math.min(desde, hasta); y <= Math.max(desde, hasta); y++) cells[at(x, y)] = FLOOR;
  };

  // Cada sala se conecta con la anterior: así todas quedan alcanzables.
  for (let i = 1; i < placed.length; i++) {
    const a = center(placed[i - 1]);
    const b = center(placed[i]);
    if (random() < 0.5) {
      excavarFila(a.y, a.x, b.x);
      excavarColumna(b.x, a.y, b.y);
    } else {
      excavarColumna(a.x, a.y, b.y);
      excavarFila(b.y, a.x, b.x);
    }
  }

  return { width, height, cells: cells.join(''), rooms: placed };
}

export interface Cell {
  x: number;
  y: number;
}

export interface DungeonFloor extends GeneratedMap {
  /** Dónde se baja al piso siguiente. `null` en el último. */
  down: Cell | null;
  /** Dónde se sube al anterior. `null` en el primero. */
  up: Cell | null;
}

/**
 * Semilla de cada piso, derivada de la de la instancia.
 *
 * Con la misma semilla en todos, los pisos saldrían idénticos y bajar no
 * cambiaría nada. Se mezcla con una constante impar para que pisos vecinos
 * no den semillas vecinas.
 */
function seedOfFloor(seed: number, floor: number): number {
  return ((seed ^ Math.imul(floor + 1, 0x9e37_79b9)) >>> 0) || 1;
}

/** Cambia una celda de una cadena de mapa. */
function marcar(map: GameMap, { x, y }: Cell, c: string): string {
  const i = y * map.width + x;
  return map.cells.slice(0, i) + c + map.cells.slice(i + 1);
}

/**
 * Una mazmorra de varios pisos, como pide el punto 3 del GDD.
 *
 * Cada piso es un mapa de `generateMap` con su propia semilla. Se llega de
 * uno al otro por escaleras: la de subida va en la primera sala y la de
 * bajada en la última. Como cada sala se conecta con la anterior, las dos
 * quedan en la misma red de pasillos, y suelen quedar lejos, porque la
 * cadena de salas recorre el mapa. Con una sola sala se ponen en esquinas
 * opuestas, para que nunca caigan en la misma celda.
 */
export function generateDungeon(
  width: number,
  height: number,
  seed: number,
  floors: number,
  options: GenerateOptions = {},
): DungeonFloor[] {
  if (!Number.isInteger(floors) || floors < 1) throw new Error(`Cantidad de pisos inválida: ${floors}`);

  const out: DungeonFloor[] = [];
  for (let n = 0; n < floors; n++) {
    const map = generateMap(width, height, seedOfFloor(seed, n), options);
    const primera = map.rooms[0];
    const ultima = map.rooms[map.rooms.length - 1];
    const up = n > 0 ? center(primera) : null;
    let down = n < floors - 1 ? center(ultima) : null;
    if (up && down && up.x === down.x && up.y === down.y) {
      down = { x: ultima.x + ultima.width - 1, y: ultima.y + ultima.height - 1 };
    }

    let cells: GameMap = map;
    if (up) cells = { ...cells, cells: marcar(cells, up, STAIRS_UP) };
    if (down) cells = { ...cells, cells: marcar(cells, down, STAIRS_DOWN) };
    out.push({ ...map, cells: cells.cells, up, down });
  }
  return out;
}
