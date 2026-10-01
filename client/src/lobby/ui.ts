/**
 * Cableado de la sección del lobby: conectar, dibujar y mandar los pasos.
 *
 * Vive aparte del explorador BOS porque son dos cosas independientes; que el
 * servidor esté caído no debe afectar al explorador, y viceversa.
 */
import { connectToLobby, sendStep, stepForKey, type LobbyRoom } from './connection';
import { renderLobby } from './render';

export interface LobbyElements {
  connect: HTMLButtonElement;
  name: HTMLInputElement;
  status: HTMLElement;
  board: HTMLElement;
  canvas: HTMLCanvasElement;
}

export function setupLobby(ui: LobbyElements): void {
  let room: LobbyRoom | null = null;

  const setStatus = (message: string, isError = false): void => {
    ui.status.textContent = message;
    ui.status.classList.toggle('error', isError);
  };

  const draw = (): void => {
    // `joinOrCreate` resuelve antes de que llegue el primer estado, así que
    // puede no haber nada que dibujar todavía. El primer `onStateChange` lo
    // resuelve enseguida.
    if (!room?.state?.players) return;
    renderLobby(ui.canvas, room.state, { ownSessionId: room.sessionId });
  };

  const disconnect = (reason: string, isError = false): void => {
    room = null;
    ui.board.hidden = true;
    ui.connect.disabled = false;
    ui.connect.textContent = 'Conectar';
    setStatus(reason, isError);
  };

  ui.connect.addEventListener('click', () => {
    if (room) {
      void room.leave();
      disconnect('Desconectado.');
      return;
    }

    ui.connect.disabled = true;
    setStatus('Conectando…');
    void connectToLobby(ui.name.value)
      .then((joined) => {
        room = joined;
        ui.connect.disabled = false;
        ui.connect.textContent = 'Desconectar';
        ui.board.hidden = false;
        setStatus(`Conectado como ${joined.sessionId}.`);

        joined.onStateChange(draw);
        joined.onLeave((code) => {
          // El servidor cerró la sala o se cayó la conexión.
          if (room === joined) disconnect(`Conexión cerrada (código ${code}).`, code !== 1000);
        });
        draw();
      })
      .catch((err: unknown) => {
        disconnect(`No se pudo conectar: ${(err as Error).message}`, true);
      });
  });

  // El teclado solo actúa con el lobby conectado y fuera de un campo de texto.
  window.addEventListener('keydown', (event) => {
    if (!room) return;
    if (event.target instanceof HTMLInputElement) return;
    const step = stepForKey(event.key);
    if (!step) return;
    event.preventDefault();
    sendStep(room, step);
  });
}
