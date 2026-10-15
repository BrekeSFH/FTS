/**
 * Dibujo isométrico del lobby.
 *
 * Sin tiles cargados dibuja los rombos de alambre, que ya muestran la
 * proyección real; con tiles del `.BOS` del usuario, los usa de piso y de
 * pared. Así el lobby se ve igual con o sin assets, que es lo que pide el
 * modelo BYOG: el cliente tiene que funcionar antes de que el jugador aporte
 * sus archivos.
 *
 * Todo se dibuja en un solo recorrido de atrás hacia adelante. Los jugadores
 * no van en una pasada aparte: uno parado detrás de una pared tiene que
 * quedar tapado por ella, y eso solo sale si se intercalan por celda.
 *
 * La niebla se aplica en ese mismo recorrido, porque decide celda por celda
 * si se dibuja entera, apagada o nada.
 */
import {
  CELL_ANCHOR_Y,
  HALF_HEIGHT,
  HALF_WIDTH,
  cellCenter,
  drawOrder,
  gridBounds,
  gridToScreen,
  placeTile,
} from '../iso/projection';
import { hidesCell } from '../iso/occlusion';
import { wallPlan, type WallSuffix } from '../iso/walls';
import type { VisionView } from './fog';
import type { Origin } from './pointer';
import type { Point } from '../iso/projection';
import type { ExitPoint, LobbyPlayer, LobbyState, LootCache } from './connection';

/** Un tile listo para dibujar, con el punto que se apoya en la celda. */
export interface PlacedTile {
  bitmap: ImageBitmap;
  anchorX: number;
  anchorY: number;
}

/**
 * Las caras de una pared.
 *
 * Los tiles del juego vienen por orientación; ver `iso/walls.ts`. Si el
 * jugador eligió uno que no declara orientación, o si no están sus hermanos
 * en los archivos abiertos, se usa `fallback` para todas: queda como antes,
 * con todas las paredes para el mismo lado, pero se dibuja algo.
 */
export interface WallSet {
  faces: Partial<Record<WallSuffix, PlacedTile>>;
  fallback: PlacedTile;
}

/**
 * Cara de la pieza de esquina.
 *
 * Las cuatro caras de una esquina miran a los cuatro cuadrantes; la sala
 * siempre queda hacia `+x +y`, que en pantalla es abajo, así que siempre va
 * la misma. Cuál es se decidió mirando las cuatro dibujadas.
 */
const CORNER_FACE: WallSuffix = 'SE';

/** Un juego de paredes con una sola cara, para cuando no hay hermanos. */
export function singleWall(tile: PlacedTile): WallSet {
  return { faces: {}, fallback: tile };
}

const faceOf = (wall: WallSet, suffix: WallSuffix): PlacedTile => wall.faces[suffix] ?? wall.fallback;

export interface RenderOptions {
  /** Sesión propia, para destacarla entre las demás. */
  ownSessionId: string | null;
  /**
   * Pisos. Se reparten por celda para que el suelo no se vea estampado; con
   * uno solo se usa ese, y sin ninguno se dibujan rombos de alambre.
   */
  floors?: readonly PlacedTile[] | null;
  /** Con qué dibujar las paredes que declara el mapa. */
  wall?: WallSet | null;
  /**
   * Pieza de esquina para el vértice donde se juntan dos tramos. Sin ella se
   * dibujan las dos caras rectas, que cierran el hueco pero se cruzan.
   */
  corner?: WallSet | null;
  /**
   * Con qué sprite dibujar a cada jugador. Devolver `null` deja el punto.
   *
   * Es una función y no una lista porque el frame de la animación depende del
   * reloj, y el reloj vive en quien llama, no acá.
   */
  character?: ((player: LobbyPlayer, sessionId: string) => PlacedTile | null) | null;
  /**
   * Qué ve el jugador. Sin esto se dibuja todo: es lo que corresponde mientras
   * el servidor no haya mandado la primera máscara, para no arrancar a oscuras.
   */
  vision?: VisionView | null;
  /**
   * Dónde dibujar a cada uno, con decimales si está a mitad de un paso, y en
   * qué celda ordenarlo. Sin esto se lo dibuja quieto en su celda.
   */
  position?: ((player: LobbyPlayer, sessionId: string) => PlayerPosition | null) | null;
  /** Lo que marca el puntero: el camino hasta donde apunta y qué cuesta. */
  hover?: Hover | null;
  /**
   * Una cámara de tamaño fijo, como la pantalla del juego. Sin esto el canvas
   * toma el tamaño del mapa entero y se ve todo de una vez.
   */
  viewport?: Viewport | null;
}

/** El camino que marca el puntero antes de hacer click. */
export interface Hover {
  /** Las celdas del camino, sin la de partida. */
  path: readonly Point[];
  /** La celda bajo el puntero. */
  target: Point;
  /** Qué cuesta, para escribirlo sobre la celda. Vacío en el lobby. */
  label: string;
  /** `false` si no alcanza la acción: se marca en rojo. */
  reachable: boolean;
}

/** Dónde va un jugador: posición en la grilla y celda en la que se lo ordena. */
export interface PlayerPosition {
  x: number;
  y: number;
  cellX: number;
  cellY: number;
}

/** Lo que encuadra la cámara: un rectángulo de tantos píxeles centrado en un punto. */
export interface Viewport {
  width: number;
  height: number;
  /**
   * El punto del mundo que queda en el centro. Sin él se centra el mapa:
   * pasa un instante, antes de que llegue el jugador propio.
   */
  focus: Point | null;
}

/** Carácter con el que el servidor marca una pared. */
const WALL = '#';
/** Escaleras de la Vault: `>` baja al piso siguiente, `<` sube al anterior. */
const STAIRS_DOWN = '>';
const STAIRS_UP = '<';

/** Puertas de la Vault: cerrada y abierta. Van en la pared entre dos salas. */
const DOOR_CLOSED = 'D';
const DOOR_OPEN = 'd';

/**
 * Si en esa celda hay algo que se dibuja como pared: roca o una puerta
 * cerrada. Fuera del mapa cuenta como roca.
 */
function esPared(state: LobbyState, gx: number, gy: number): boolean {
  if (gx < 0 || gy < 0 || gx >= state.width || gy >= state.height) return true;
  const c = state.cells?.[gy * state.width + gx];
  return c === WALL || c === DOOR_CLOSED;
}

/**
 * Si una celda es parte de la pared para las de al lado. Una puerta, abierta
 * o cerrada, es el marco de la pared: la pared vecina no le da la cara.
 */
function esMuro(state: LobbyState, gx: number, gy: number): boolean {
  return esPared(state, gx, gy) || state.cells?.[gy * state.width + gx] === DOOR_OPEN;
}

/** Qué escalera hay en una celda, si hay alguna. */
function escaleraEn(state: LobbyState, gx: number, gy: number): 'down' | 'up' | null {
  const c = state.cells?.[gy * state.width + gx];
  return c === STAIRS_DOWN ? 'down' : c === STAIRS_UP ? 'up' : null;
}

/** Radio del punto que representa a un jugador. */
const DOT_RADIUS = 7;
/** Sitio que se deja arriba para que no se corte un personaje de la fila del fondo. */
const CHARACTER_HEADROOM = 80;
/** Opacidad de una pared que está tapando a alguien. */
const WALL_FADE = 0.28;
/** Opacidad de lo que se recuerda pero no se está viendo. */
const FOG_DIM = 0.4;

/**
 * Qué piso le toca a una celda.
 *
 * Siempre el mismo para la misma celda: si cambiara entre cuadros, el suelo
 * titilaría. Se mezclan las dos coordenadas con números primos para que no
 * salga un damero.
 */
function pisoDe(floors: readonly PlacedTile[] | null, x: number, y: number): PlacedTile | null {
  if (!floors || floors.length === 0) return null;
  if (floors.length === 1) return floors[0];
  const mezcla = Math.abs(x * 73_856_093 + y * 19_349_663) % floors.length;
  return floors[mezcla];
}

/** Cuánto sobresale un tile de su celda, para agrandar el canvas. */
function overhang(tile: PlacedTile | null | undefined): { top: number; left: number } {
  if (!tile) return { top: 0, left: 0 };
  return {
    top: Math.max(0, tile.anchorY - CELL_ANCHOR_Y),
    left: Math.max(0, tile.anchorX - HALF_WIDTH),
  };
}

function strokeDiamond(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.strokeStyle = '#1e262e';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + HALF_WIDTH, y);
  context.lineTo(x + HALF_WIDTH * 2, y + HALF_HEIGHT);
  context.lineTo(x + HALF_WIDTH, y + HALF_HEIGHT * 2);
  context.lineTo(x, y + HALF_HEIGHT);
  context.closePath();
  context.stroke();
}

/**
 * Marca de una escalera: el rombo relleno y una flecha hacia donde lleva.
 *
 * Es un marcador y no un tile del juego. Las escaleras del catálogo ocupan
 * más de una celda, y ordenar objetos así es justo lo que el render todavía
 * no resuelve; ver el GDD.
 */
function drawStairs(context: CanvasRenderingContext2D, gx: number, gy: number, hacia: 'down' | 'up'): void {
  const { x, y } = gridToScreen(gx, gy);
  context.beginPath();
  context.moveTo(x + HALF_WIDTH, y);
  context.lineTo(x + HALF_WIDTH * 2, y + HALF_HEIGHT);
  context.lineTo(x + HALF_WIDTH, y + HALF_HEIGHT * 2);
  context.lineTo(x, y + HALF_HEIGHT);
  context.closePath();
  context.fillStyle = hacia === 'down' ? 'rgba(20, 120, 160, 0.55)' : 'rgba(170, 130, 30, 0.55)';
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = 'bold 14px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(hacia === 'down' ? '▼' : '▲', x + HALF_WIDTH, y + HALF_HEIGHT);
  context.textBaseline = 'alphabetic';
}

/** Rombo relleno sobre una celda, la base de todos los marcadores. */
function fillDiamond(context: CanvasRenderingContext2D, gx: number, gy: number, color: string): void {
  const { x, y } = gridToScreen(gx, gy);
  context.beginPath();
  context.moveTo(x + HALF_WIDTH, y);
  context.lineTo(x + HALF_WIDTH * 2, y + HALF_HEIGHT);
  context.lineTo(x + HALF_WIDTH, y + HALF_HEIGHT * 2);
  context.lineTo(x, y + HALF_HEIGHT);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

/** Un texto centrado en la celda. */
function labelCell(context: CanvasRenderingContext2D, gx: number, gy: number, texto: string, font: string): void {
  const { x, y } = gridToScreen(gx, gy);
  context.fillStyle = '#ffffff';
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(texto, x + HALF_WIDTH, y + HALF_HEIGHT);
  context.textBaseline = 'alphabetic';
}

/**
 * Un contenedor: lleno o ya vaciado. Marcador y no tile, por lo mismo que
 * las escaleras: los contenedores del juego son objetos de varias celdas.
 */
function drawCache(context: CanvasRenderingContext2D, cache: LootCache): void {
  fillDiamond(context, cache.x, cache.y, cache.looted ? 'rgba(90, 90, 90, 0.5)' : 'rgba(150, 95, 30, 0.75)');
  labelCell(context, cache.x, cache.y, cache.looted ? '□' : '■', 'bold 13px system-ui, sans-serif');
}

/** Una salida abierta. Sin celda conocida no hay dónde dibujarla. */
function drawExit(context: CanvasRenderingContext2D, exit: ExitPoint): void {
  if (exit.x === undefined || exit.y === undefined) return;
  fillDiamond(context, exit.x, exit.y, 'rgba(40, 170, 80, 0.7)');
  labelCell(context, exit.x, exit.y, 'SALIDA', 'bold 9px system-ui, sans-serif');
}

/**
 * Barra de vida sobre el nombre. Solo en la Vault: en el lobby nadie tiene
 * vida, y una barra siempre llena sería ruido.
 */
function drawHealth(context: CanvasRenderingContext2D, player: LobbyPlayer, x: number, nombreY: number): void {
  if (player.hp === undefined || !player.maxHp) return;
  const ANCHO = 32;
  const ALTO = 4;
  const y = nombreY - 16;
  const parte = Math.max(0, Math.min(1, player.hp / player.maxHp));
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  context.fillRect(x - ANCHO / 2 - 1, y - 1, ANCHO + 2, ALTO + 2);
  context.fillStyle = parte > 0.5 ? '#4caf50' : parte > 0.25 ? '#e0a020' : '#d03030';
  context.fillRect(x - ANCHO / 2, y, ANCHO * parte, ALTO);
}

function drawPlayer(
  context: CanvasRenderingContext2D,
  player: LobbyPlayer,
  donde: { x: number; y: number },
  own: boolean,
  sprite: PlacedTile | null,
): void {
  const { x, y } = cellCenter(donde.x, donde.y);

  if (sprite) {
    const pos = placeTile(donde.x, donde.y, sprite.anchorX, sprite.anchorY);
    // El propio se marca con un anillo en el piso, porque todos los sprites
    // son iguales mientras no haya uno por jugador.
    if (own) {
      context.beginPath();
      context.ellipse(x, y, 14, 7, 0, 0, Math.PI * 2);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.stroke();
    }
    context.drawImage(sprite.bitmap, pos.x, pos.y);
    context.fillStyle = own ? '#ffffff' : '#9fb4c7';
    context.font = '11px system-ui, sans-serif';
    context.textAlign = 'center';
    context.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    context.lineWidth = 3;
    context.strokeText(player.name, x, pos.y - 4);
    context.fillText(player.name, x, pos.y - 4);
    drawHealth(context, player, x, pos.y - 4);
    return;
  }

  // Sombra elíptica para que el punto se apoye en el rombo y no flote.
  context.beginPath();
  context.ellipse(x, y, DOT_RADIUS, DOT_RADIUS / 2, 0, 0, Math.PI * 2);
  context.fillStyle = 'rgba(0, 0, 0, 0.45)';
  context.fill();

  context.beginPath();
  context.arc(x, y - DOT_RADIUS, DOT_RADIUS, 0, Math.PI * 2);
  context.fillStyle = `hsl(${player.hue} 70% ${own ? 65 : 45}%)`;
  context.fill();
  if (own) {
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.stroke();
  }

  context.fillStyle = own ? '#ffffff' : '#9fb4c7';
  context.font = '11px system-ui, sans-serif';
  context.textAlign = 'center';
  context.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  context.lineWidth = 3;
  context.strokeText(player.name, x, y - DOT_RADIUS * 2 - 4);
  context.fillText(player.name, x, y - DOT_RADIUS * 2 - 4);
  drawHealth(context, player, x, y - DOT_RADIUS * 2 - 4);
}

/**
 * Dibuja el tablero. Devuelve dónde quedó el origen de la grilla, que hace
 * falta para saber sobre qué se hizo click; `null` si no hubo dónde dibujar.
 */
export function renderLobby(
  canvas: HTMLCanvasElement,
  state: LobbyState,
  {
    ownSessionId,
    floors = null,
    wall = null,
    corner = null,
    character = null,
    vision = null,
    viewport = null,
    position = null,
    hover = null,
  }: RenderOptions,
): Origin | null {
  const context = canvas.getContext('2d');
  if (!context) return null;

  // Las paredes sobresalen bastante por arriba de su celda.
  // De la pared se mide la cara más alta: con juegos mezclados, una podría
  // sobresalir más que otra y quedar cortada arriba.
  const salientes = [
    ...(floors ?? []),
    ...(wall ? [wall.fallback, ...Object.values(wall.faces)] : []),
    ...(corner ? [corner.fallback, ...Object.values(corner.faces)] : []),
  ].map(overhang);
  // Un personaje sobresale mucho menos que una pared, pero igual se le deja
  // sitio: sin esto una cabeza queda cortada contra el borde de arriba.
  const bounds = gridBounds(state.width, state.height, {
    top: Math.max(...salientes.map((s) => s.top), CHARACTER_HEADROOM),
    left: Math.max(...salientes.map((s) => s.left)),
  });

  const origen = viewport ? encuadre(viewport, bounds) : { minX: bounds.minX, minY: bounds.minY };
  const ancho = viewport?.width ?? bounds.width;
  const alto = viewport?.height ?? bounds.height;
  if (canvas.width !== ancho) canvas.width = ancho;
  if (canvas.height !== alto) canvas.height = alto;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#0c1014';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // La columna 0 queda a la derecha del todo y las paredes suben por encima
  // de la fila 0, así que la grilla arranca en coordenadas negativas.
  context.translate(-origen.minX, -origen.minY);

  // Un jugador puede estar en cualquier celda; se indexan para intercalarlos.
  type Ubicado = { player: LobbyPlayer; sessionId: string; pos: PlayerPosition };
  const jugadores: Ubicado[] = [];
  const porCelda = new Map<string, Ubicado[]>();
  state.players.forEach((player, sessionId) => {
    const pos = position?.(player, sessionId) ?? { x: player.x, y: player.y, cellX: player.x, cellY: player.y };
    const ubicado = { player, sessionId, pos };
    jugadores.push(ubicado);
    const clave = `${pos.cellX},${pos.cellY}`;
    const lista = porCelda.get(clave);
    if (lista) lista.push(ubicado);
    else porCelda.set(clave, [ubicado]);
  });

  // Contenedores y salidas también van intercalados por celda: un personaje
  // parado delante de un cofre tiene que taparlo, no al revés.
  const cofres = new Map<string, LootCache>();
  for (const cache of Array.from(state.caches ?? [])) cofres.set(`${cache.x},${cache.y}`, cache);
  const salidas = new Map<string, ExitPoint>();
  for (const exit of Array.from(state.exits ?? [])) salidas.set(`${exit.x},${exit.y}`, exit);

  const marcadas = new Set((hover?.path ?? []).map((p) => `${p.x},${p.y}`));
  const colorCamino = hover?.reachable === false ? 'rgba(220, 70, 60, 0.35)' : 'rgba(110, 200, 255, 0.28)';

  for (const cell of drawOrder(state.width, state.height) ) {
    const visible = !vision || vision.visible(cell.x, cell.y);
    // De lo que nunca se vio no se dibuja nada, ni el rombo de alambre: el
    // contorno de una sala ya diría dónde está.
    if (!visible && vision && !vision.explored(cell.x, cell.y)) continue;
    const niebla = visible ? 1 : FOG_DIM;

    // La roca maciza no se dibuja: en una mazmorra es casi todo el mapa.
    const pared = esPared(state, cell.x, cell.y);
    if (!pared) {
      context.globalAlpha = niebla;
      const piso = pisoDe(floors, cell.x, cell.y);
      if (piso) {
        const pos = placeTile(cell.x, cell.y, piso.anchorX, piso.anchorY);
        context.drawImage(piso.bitmap, pos.x, pos.y);
      } else {
        const { x, y } = gridToScreen(cell.x, cell.y);
        strokeDiamond(context, x, y);
      }
      // El camino va sobre el piso y debajo de todo lo demás.
      if (marcadas.has(`${cell.x},${cell.y}`)) fillDiamond(context, cell.x, cell.y, colorCamino);
      if (hover && hover.target.x === cell.x && hover.target.y === cell.y) {
        outlineDiamond(context, cell.x, cell.y, hover.reachable ? '#9fdcff' : '#ff7a6b');
      }
      const escalera = escaleraEn(state, cell.x, cell.y);
      if (escalera) drawStairs(context, cell.x, cell.y, escalera);
      const cofre = cofres.get(`${cell.x},${cell.y}`);
      if (cofre) drawCache(context, cofre);
      // Una salida se muestra solo mientras se ve: aparecen y se cierran, y
      // recordarla apagada haría creer que sigue ahí.
      const salida = salidas.get(`${cell.x},${cell.y}`);
      if (salida && visible) drawExit(context, salida);
      context.globalAlpha = 1;
    }

    // Solo las caras del fondo que dan a una sala; las cercanas taparían el
    // interior. Las que quedan se desvanecen mientras escondan a alguien.
    if (wall && pared) {
      const plan = wallPlan((x, y) => !esMuro(state, x, y), cell.x, cell.y);
      const tapando = jugadores.some(({ player }) => hidesCell(cell.x, cell.y, player.x, player.y));
      // En el vértice va una sola pieza de esquina; sin ella, las dos caras.
      const piezas =
        plan.corner && corner
          ? [faceOf(corner, CORNER_FACE)]
          : plan.faces.map((cara) => faceOf(wall, cara));
      for (const tile of piezas) {
        const pos = placeTile(cell.x, cell.y, tile.anchorX, tile.anchorY);
        context.globalAlpha = Math.min(niebla, tapando ? WALL_FADE : 1);
        context.drawImage(tile.bitmap, pos.x, pos.y);
        context.globalAlpha = 1;
      }
    }

    // La puerta va arriba de la pared: marcador y no sprite, porque las
    // puertas del juego son objetos con su propia animación, no tiles.
    const c = state.cells?.[cell.y * state.width + cell.x];
    if (c === DOOR_CLOSED || c === DOOR_OPEN) {
      context.globalAlpha = niebla;
      drawDoor(context, cell.x, cell.y, c === DOOR_CLOSED);
      context.globalAlpha = 1;
    }

    // A nadie se lo dibuja en una celda que no se esté viendo: lo explorado es
    // el mapa que uno recuerda, no un rastreador de rivales.
    if (!visible) continue;
    for (const { player, sessionId, pos } of porCelda.get(`${cell.x},${cell.y}`) ?? []) {
      drawPlayer(context, player, pos, sessionId === ownSessionId, character ? character(player, sessionId) : null);
    }
  }

  // El costo va arriba de todo, para que ningún personaje o pared lo tape.
  if (hover?.label) drawHoverLabel(context, hover);
  return origen;
}

/**
 * Una puerta. Cerrada, una hoja de pie en el medio de la celda; abierta, el
 * marco en el piso, para que se note por dónde se pasa.
 */
function drawDoor(context: CanvasRenderingContext2D, gx: number, gy: number, cerrada: boolean): void {
  if (!cerrada) {
    outlineDiamond(context, gx, gy, 'rgba(214, 150, 70, 0.85)');
    return;
  }
  const { x, y } = cellCenter(gx, gy);
  const ancho = 18;
  const alto = 40;
  context.fillStyle = '#7a4f24';
  context.strokeStyle = '#24160a';
  context.lineWidth = 2;
  context.fillRect(x - ancho / 2, y - alto + 6, ancho, alto);
  context.strokeRect(x - ancho / 2, y - alto + 6, ancho, alto);
  // El picaporte, para que se lea como puerta y no como un cajón.
  context.fillStyle = '#e0c070';
  context.beginPath();
  context.arc(x + ancho / 2 - 5, y - alto / 2 + 6, 2, 0, Math.PI * 2);
  context.fill();
}

/** El borde de una celda, para marcar adónde apunta el mouse. */
function outlineDiamond(context: CanvasRenderingContext2D, gx: number, gy: number, color: string): void {
  const { x, y } = gridToScreen(gx, gy);
  context.beginPath();
  context.moveTo(x + HALF_WIDTH, y);
  context.lineTo(x + HALF_WIDTH * 2, y + HALF_HEIGHT);
  context.lineTo(x + HALF_WIDTH, y + HALF_HEIGHT * 2);
  context.lineTo(x, y + HALF_HEIGHT);
  context.closePath();
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
}

/** Lo que cuesta ir adonde apunta el mouse, sobre la celda. */
function drawHoverLabel(context: CanvasRenderingContext2D, hover: Hover): void {
  const { x, y } = cellCenter(hover.target.x, hover.target.y);
  context.font = 'bold 12px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const ancho = context.measureText(hover.label).width + 10;
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  context.fillRect(x - ancho / 2, y - 26, ancho, 16);
  context.fillStyle = hover.reachable ? '#ffffff' : '#ff9a8a';
  context.fillText(hover.label, x, y - 18);
  context.textBaseline = 'alphabetic';
}

/**
 * Dónde queda la esquina de arriba a la izquierda de la cámara, en
 * coordenadas del mundo. Se redondea: con medio píxel de corrimiento, todo el
 * pixel art se vería borroso.
 */
export function encuadre(viewport: Viewport, mapa: { minX: number; minY: number; width: number; height: number }): Origin {
  const centro = viewport.focus ?? { x: mapa.minX + mapa.width / 2, y: mapa.minY + mapa.height / 2 };
  return { minX: Math.round(centro.x - viewport.width / 2), minY: Math.round(centro.y - viewport.height / 2) };
}
