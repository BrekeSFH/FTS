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
import type { LobbyPlayer, LobbyState } from './connection';

/** Un tile listo para dibujar, con el punto que se apoya en la celda. */
export interface PlacedTile {
  bitmap: ImageBitmap;
  anchorX: number;
  anchorY: number;
}

export interface RenderOptions {
  /** Sesión propia, para destacarla entre las demás. */
  ownSessionId: string | null;
  /** Tile de piso. Sin esto se dibujan rombos de alambre. */
  floor?: PlacedTile | null;
  /** Tile que se repite donde `wallAt` diga. */
  wall?: PlacedTile | null;
  /**
   * Qué celdas llevan pared. Por defecto los dos bordes del fondo, que es
   * donde van las paredes de una sala vista en isométrica.
   */
  wallAt?: (gx: number, gy: number) => boolean;
  /**
   * Con qué sprite dibujar a cada jugador. Devolver `null` deja el punto.
   *
   * Es una función y no una lista porque el frame de la animación depende del
   * reloj, y el reloj vive en quien llama, no acá.
   */
  character?: ((player: LobbyPlayer, sessionId: string) => PlacedTile | null) | null;
}

const BACK_EDGES = (gx: number, gy: number): boolean => gx === 0 || gy === 0;

/** Radio del punto que representa a un jugador. */
const DOT_RADIUS = 7;
/** Sitio que se deja arriba para que no se corte un personaje de la fila del fondo. */
const CHARACTER_HEADROOM = 80;

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
  { ownSessionId, floor = null, wall = null, wallAt = BACK_EDGES, character = null }: RenderOptions,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  // Las paredes sobresalen bastante por arriba de su celda.
  const salientes = [floor, wall].map(overhang);
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
  const porCelda = new Map<string, Array<{ player: LobbyPlayer; sessionId: string }>>();
  state.players.forEach((player, sessionId) => {
    const clave = `${player.x},${player.y}`;
    const lista = porCelda.get(clave);
    if (lista) lista.push({ player, sessionId });
    else porCelda.set(clave, [{ player, sessionId }]);
  });

  for (const cell of drawOrder(state.width, state.height) ) {
    if (floor) {
      const pos = placeTile(cell.x, cell.y, floor.anchorX, floor.anchorY);
      context.drawImage(floor.bitmap, pos.x, pos.y);
    } else {
      const { x, y } = gridToScreen(cell.x, cell.y);
      strokeDiamond(context, x, y);
    }

    if (wall && wallAt(cell.x, cell.y)) {
      const pos = placeTile(cell.x, cell.y, wall.anchorX, wall.anchorY);
      context.drawImage(wall.bitmap, pos.x, pos.y);
    }

    for (const { player, sessionId } of porCelda.get(`${cell.x},${cell.y}`) ?? []) {
      drawPlayer(context, player, sessionId === ownSessionId, character ? character(player, sessionId) : null);
    }
  }
}
