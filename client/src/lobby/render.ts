/**
 * Dibujo de la grilla del lobby.
 *
 * Es deliberadamente una grilla cuadrada y no isométrica: el Hito 3 pide
 * "puntos moviéndose en una grilla vacía" y mezclarlo con la proyección
 * isométrica solo agregaría una fuente de error a lo que se está probando,
 * que es la sincronización.
 */
import type { LobbyPlayer, LobbyState } from './connection';

export const CELL = 18;

export interface RenderOptions {
  /** Sesión propia, para destacarla entre las demás. */
  ownSessionId: string | null;
}

/** Ajusta el canvas al tamaño de la grilla que declara el servidor. */
export function resizeToState(canvas: HTMLCanvasElement, state: LobbyState): void {
  const width = state.width * CELL;
  const height = state.height * CELL;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

export function renderLobby(
  canvas: HTMLCanvasElement,
  state: LobbyState,
  { ownSessionId }: RenderOptions,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  resizeToState(canvas, state);

  context.fillStyle = '#11151a';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = '#1e262e';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= state.width; x++) {
    context.moveTo(x * CELL + 0.5, 0);
    context.lineTo(x * CELL + 0.5, state.height * CELL);
  }
  for (let y = 0; y <= state.height; y++) {
    context.moveTo(0, y * CELL + 0.5);
    context.lineTo(state.width * CELL, y * CELL + 0.5);
  }
  context.stroke();

  state.players.forEach((player: LobbyPlayer, sessionId: string) => {
    const cx = player.x * CELL + CELL / 2;
    const cy = player.y * CELL + CELL / 2;
    const own = sessionId === ownSessionId;

    context.beginPath();
    context.arc(cx, cy, CELL * 0.35, 0, Math.PI * 2);
    context.fillStyle = `hsl(${player.hue} 70% ${own ? 65 : 45}%)`;
    context.fill();
    if (own) {
      // Anillo para encontrarse rápido entre varios puntos.
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.stroke();
    }

    context.fillStyle = own ? '#ffffff' : '#8aa0b4';
    context.font = '10px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(player.name, cx, cy - CELL * 0.5);
  });
}
