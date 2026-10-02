/**
 * Cableado de la sección del lobby: conectar, dibujar y mandar los pasos.
 *
 * Vive aparte del explorador BOS porque son dos cosas independientes; que el
 * servidor esté caído no debe afectar al explorador, y viceversa.
 */
import type { LoadedAnimation } from '../iso/spriteset';
import {
  LOBBY_ROOM,
  connectToLobby,
  onVision,
  requestVision,
  sendEndTurn,
  sendStep,
  stepForKey,
  type LobbyPlayer,
  type LobbyRoom,
} from './connection';
import { createFog } from './fog';
import { turnHud } from './hud';
import { renderLobby, type PlacedTile } from './render';

export interface LobbyElements {
  connect: HTMLButtonElement;
  name: HTMLInputElement;
  status: HTMLElement;
  board: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Botón para ver el tablero a pantalla completa. Opcional. */
  fullscreen?: HTMLButtonElement | null;
  /** A qué sala entrar. Sin esto siempre se entra al lobby. */
  room?: HTMLSelectElement | null;
  /** Línea con la ronda y el turno. Solo se llena en la Vault. */
  turn?: HTMLElement | null;
  /** Botón para cerrar el turno propio. Solo sirve en la Vault. */
  endTurn?: HTMLButtonElement | null;
}

export interface LobbyHandle {
  /** Cambia el tile de piso. `null` vuelve a los rombos de alambre. */
  setFloor(floor: PlacedTile | null): void;
  /** Cambia el tile de pared del fondo. `null` lo saca. */
  setWall(wall: PlacedTile | null): void;
  /** Cambia la animación de los jugadores. `null` vuelve a los puntos. */
  setCharacter(character: LoadedAnimation | null): void;
}

export function setupLobby(ui: LobbyElements): LobbyHandle {
  let room: LobbyRoom | null = null;
  let floor: PlacedTile | null = null;
  let wall: PlacedTile | null = null;
  let character: LoadedAnimation | null = null;
  /**
   * Lo que el jugador ve y lo que ya vio. Se rehace en cada conexión: el
   * servidor genera una mazmorra nueva por sala, así que lo explorado de la
   * anterior no significa nada.
   */
  let fog = createFog();

  /**
   * Cuándo arrancó el movimiento de cada jugador y dónde estaba.
   *
   * El estado sincronizado solo dice la celda; que alguien esté caminando se
   * deduce de que esa celda haya cambiado hace poco. Alcanza para animar y no
   * obliga al servidor a mandar nada más.
   */
  const movimiento = new Map<string, { x: number; y: number; desde: number }>();

  const setStatus = (message: string, isError = false): void => {
    ui.status.textContent = message;
    ui.status.classList.toggle('error', isError);
  };

  const draw = (): void => {
    // `joinOrCreate` resuelve antes de que llegue el primer estado, así que
    // puede no haber nada que dibujar todavía. El primer `onStateChange` lo
    // resuelve enseguida.
    if (!room?.state?.players) return;
    renderLobby(ui.canvas, room.state, {
      ownSessionId: room.sessionId,
      floor,
      wall,
      character: character ? spriteFor : null,
      // Sin máscara todavía se dibuja todo, para no arrancar en negro.
      vision: fog.empty ? null : fog,
    });
    actualizarTurno();
  };

  /**
   * El turno actual, en la barra y en el botón.
   *
   * Lo que se puede hacer sale de `turnHud`, no de leer el estado acá: el
   * servidor ya rechaza lo que no corresponde, y esto es solo para que el
   * jugador sepa por qué sus teclas no hacen nada.
   */
  const actualizarTurno = (): void => {
    const hud = turnHud(room?.state ?? null, room?.state?.players?.get(room.sessionId));
    if (ui.turn) {
      ui.turn.textContent = hud.text;
      ui.turn.hidden = hud.text.length === 0;
    }
    if (ui.endTurn) {
      ui.endTurn.hidden = !salaPorTurnos();
      ui.endTurn.disabled = !hud.canEndTurn;
    }
  };

  /** Si la sala elegida juega por turnos. */
  const salaPorTurnos = (): boolean => (ui.room?.value ?? LOBBY_ROOM) !== LOBBY_ROOM;

  /** Cuánto se sigue animando después del último paso, en milisegundos. */
  const VENTANA_MOVIMIENTO = 260;
  /** Duración de cada frame de la animación. */
  const MS_POR_FRAME = 90;

  /** Elige el sprite de un jugador según hacia dónde mira y si viene caminando. */
  const spriteFor = (player: LobbyPlayer, sessionId: string): PlacedTile | null => {
    if (!character) return null;
    const ahora = performance.now();
    const previo = movimiento.get(sessionId);
    if (!previo || previo.x !== player.x || previo.y !== player.y) {
      // Si ya venía caminando se conserva el arranque, para que el ciclo no
      // se reinicie en cada paso y la caminata se vea continua.
      const seguia = previo !== undefined && ahora - previo.desde < VENTANA_MOVIMIENTO;
      movimiento.set(sessionId, {
        x: player.x,
        y: player.y,
        desde: seguia ? previo.desde : ahora,
      });
    }

    const estado = movimiento.get(sessionId)!;
    const caminando = ahora - estado.desde < VENTANA_MOVIMIENTO;
    // Si la animación no cubre los ocho rumbos se cae al primero, que es
    // preferible a mostrar una dirección equivocada.
    const frames = character.images[player.facing] ?? character.images[0];
    const frame = caminando ? Math.floor((ahora - estado.desde) / MS_POR_FRAME) % frames.length : 0;
    const sprite = frames[frame] ?? frames[0];
    return { bitmap: sprite.bitmap, anchorX: sprite.anchorX, anchorY: sprite.anchorY };
  };

  const disconnect = (reason: string, isError = false): void => {
    room = null;
    ui.board.hidden = true;
    ui.connect.disabled = false;
    ui.connect.textContent = 'Conectar';
    if (ui.room) ui.room.disabled = false;
    setStatus(reason, isError);
    actualizarTurno();
  };

  /**
   * Pantalla completa sobre el tablero, no sobre la página entera: así el
   * canvas queda solo y centrado, sin el explorador alrededor. Se escala por
   * CSS, de modo que no hay que volver a dibujar nada.
   */
  ui.fullscreen?.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void ui.board.requestFullscreen().catch((err: unknown) => {
      // Algunos navegadores lo niegan sin gesto del usuario o en un iframe.
      setStatus(`No se pudo ir a pantalla completa: ${(err as Error).message}`, true);
    });
  });

  document.addEventListener('fullscreenchange', () => {
    if (!ui.fullscreen) return;
    ui.fullscreen.textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
  });

  ui.connect.addEventListener('click', () => {
    if (room) {
      void room.leave();
      disconnect('Desconectado.');
      return;
    }

    ui.connect.disabled = true;
    setStatus('Conectando…');
    if (ui.room) ui.room.disabled = true;
    void connectToLobby(ui.name.value, ui.room?.value ?? LOBBY_ROOM)
      .then((joined) => {
        room = joined;
        ui.connect.disabled = false;
        ui.connect.textContent = 'Desconectar';
        ui.board.hidden = false;
        setStatus(`Conectado como ${joined.sessionId}.`);

        fog = createFog();
        onVision(joined, ({ width, cells }) => {
          fog.update(cells, width);
          draw();
        });
        // El servidor ya la empujó al entrar, pero ese empujón pudo salir
        // antes de que este handler existiera.
        requestVision(joined);

        joined.onStateChange(draw);
        // Mientras alguien camina hay que redibujar aunque no llegue estado
        // nuevo: el frame depende del reloj.
        const animar = (): void => {
          if (room !== joined) return;
          if (character) draw();
          requestAnimationFrame(animar);
        };
        requestAnimationFrame(animar);
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
    // El servidor rechaza igual el paso de quien no tiene el turno; esto
    // evita el viaje de ida y vuelta y el parpadeo que deja.
    if (!turnHud(room.state ?? null, room.state?.players?.get(room.sessionId)).canMove) return;
    sendStep(room, step);
  });

  ui.endTurn?.addEventListener('click', () => {
    if (room) sendEndTurn(room);
  });

  return {
    setFloor(next) {
      floor = next;
      draw();
    },
    setWall(next) {
      wall = next;
      draw();
    },
    setCharacter(next) {
      character = next;
      movimiento.clear();
      draw();
    },
  };
}
