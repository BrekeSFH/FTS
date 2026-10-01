/**
 * Dibujo isométrico del lobby.
 *
 * Sin tiles cargados dibuja los rombos de alambre, que ya muestran la
 * proyección real; con un tile del `.BOS` del usuario, lo usa de piso. Así el
 * lobby se ve igual con o sin assets, que es lo que pide el modelo BYOG: el
 * cliente tiene que funcionar antes de que el jugador aporte sus archivos.
 */
import {
  HALF_HEIGHT,
  HALF_WIDTH,
  cellCenter,
  drawOrder,
  gridBounds,
  gridToScreen,
} from '../iso/projection';
import type { LobbyPlayer, LobbyState } from './connection';

export interface RenderOptions {
  /** Sesión propia, para destacarla entre las demás. */
  ownSessionId: string | null;
  /** Tile de piso ya decodificado. Sin esto se dibujan rombos de alambre. */
  floor?: ImageBitmap | null;
}

/** Radio del punto que representa a un jugador. */
const DOT_RADIUS = 7;

export function renderLobby(
  canvas: HTMLCanvasElement,
  state: LobbyState,
  { ownSessionId, floor = null }: RenderOptions,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  const bounds = gridBounds(state.width, state.height);
  if (canvas.width !== bounds.width) canvas.width = bounds.width;
  if (canvas.height !== bounds.height) canvas.height = bounds.height;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#0c1014';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // La columna 0 queda a la derecha del todo, así que la grilla empieza en un
  // X negativo y hay que correrla para que entre en el canvas.
  context.translate(-bounds.minX, -bounds.minY);

  for (const cell of drawOrder(state.width, state.height)) {
    const { x, y } = gridToScreen(cell.x, cell.y);
    if (floor) {
      context.drawImage(floor, x, y);
    } else {
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
  }

  // Los jugadores también van de atrás hacia adelante: el de más abajo tapa.
  const players: Array<{ player: LobbyPlayer; sessionId: string }> = [];
  state.players.forEach((player, sessionId) => players.push({ player, sessionId }));
  players.sort((a, b) => a.player.x + a.player.y - (b.player.x + b.player.y));

  for (const { player, sessionId } of players) {
    const { x, y } = cellCenter(player.x, player.y);
    const own = sessionId === ownSessionId;

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
}
