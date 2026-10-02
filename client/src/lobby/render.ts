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
import type { LobbyPlayer, LobbyState } from './connection';

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
}

/** Carácter con el que el servidor marca una pared. */
const WALL = '#';

/** Si el mapa declara pared en esa celda. Fuera del mapa cuenta como roca. */
function esPared(state: LobbyState, gx: number, gy: number): boolean {
  if (gx < 0 || gy < 0 || gx >= state.width || gy >= state.height) return true;
  return state.cells?.[gy * state.width + gx] === WALL;
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

function drawPlayer(
  context: CanvasRenderingContext2D,
  player: LobbyPlayer,
  own: boolean,
  sprite: PlacedTile | null,
): void {
  const { x, y } = cellCenter(player.x, player.y);

  if (sprite) {
    const pos = placeTile(player.x, player.y, sprite.anchorX, sprite.anchorY);
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
}

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
  }: RenderOptions,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;

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

  if (canvas.width !== bounds.width) canvas.width = bounds.width;
  if (canvas.height !== bounds.height) canvas.height = bounds.height;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#0c1014';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // La columna 0 queda a la derecha del todo y las paredes suben por encima
  // de la fila 0, así que la grilla arranca en coordenadas negativas.
  context.translate(-bounds.minX, -bounds.minY);

  // Un jugador puede estar en cualquier celda; se indexan para intercalarlos.
  const jugadores: Array<{ player: LobbyPlayer; sessionId: string }> = [];
  const porCelda = new Map<string, Array<{ player: LobbyPlayer; sessionId: string }>>();
  state.players.forEach((player, sessionId) => {
    jugadores.push({ player, sessionId });
    const clave = `${player.x},${player.y}`;
    const lista = porCelda.get(clave);
    if (lista) lista.push({ player, sessionId });
    else porCelda.set(clave, [{ player, sessionId }]);
  });

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
      context.globalAlpha = 1;
    }

    // Solo las caras del fondo que dan a una sala; las cercanas taparían el
    // interior. Las que quedan se desvanecen mientras escondan a alguien.
    if (wall && pared) {
      const plan = wallPlan((x, y) => !esPared(state, x, y), cell.x, cell.y);
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

    // A nadie se lo dibuja en una celda que no se esté viendo: lo explorado es
    // el mapa que uno recuerda, no un rastreador de rivales.
    if (!visible) continue;
    for (const { player, sessionId } of porCelda.get(`${cell.x},${cell.y}`) ?? []) {
      drawPlayer(context, player, sessionId === ownSessionId, character ? character(player, sessionId) : null);
    }
  }
}
