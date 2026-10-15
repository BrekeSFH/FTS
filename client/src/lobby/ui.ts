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
  describeShot,
  isLootKey,
  onDied,
  onExtracted,
  onItems,
  onShot,
  onStash,
  onVision,
  requestItems,
  requestStash,
  requestVision,
  sendAttack,
  sendEndTurn,
  sendEquip,
  sendUse,
  sendLoot,
  sendStep,
  stepForKey,
  type CatalogItem,
  type LobbyPlayer,
  type LobbyRoom,
} from './connection';
import { floorView, ownFloor } from './floors';
import { createFog, type Fog } from './fog';
import { playerToken } from './identity';
import { loadoutFrom, stashRows, valueOfItems, type StashContents } from './stash';
import { ACTION_LABEL, inventoryRows, type InventoryAction } from './inventory';
import { playerAt, toWorld, type Origin } from './pointer';
import { turnHud } from './hud';
import { renderLobby, type PlacedTile, type WallSet } from './render';

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
  /** Lista de lo que lleva encima, con sus botones. Solo se llena en la Vault. */
  inventory?: HTMLElement | null;
  /**
   * Panel del alijo: lo que hay guardado y qué llevar. Se llena al entrar al
   * lobby y queda a la vista al desconectarse, para elegir antes de bajar.
   */
  stash?: HTMLElement | null;
  /**
   * Aviso de qué semilla de tiles usa la sala, al conectarse y si cambia.
   *
   * Quien conecta no sabe nada de archivos `.BOS`; de armar el juego de
   * tiles con esa semilla se encarga el explorador, que sí.
   */
  onTileSeed?: (seed: number) => void;
}

export interface LobbyHandle {
  /**
   * Cambia los pisos. Con varios se reparten por celda, así el suelo no se
   * ve estampado. `null` vuelve a los rombos de alambre.
   */
  setFloor(floor: PlacedTile | readonly PlacedTile[] | null): void;
  /** Cambia las paredes del fondo. `null` las saca. */
  setWall(wall: WallSet | null): void;
  /** Cambia la pieza de esquina. `null` cae a dibujar las dos caras. */
  setCorner(corner: WallSet | null): void;
  /** Cambia la animación de los jugadores. `null` vuelve a los puntos. */
  setCharacter(character: LoadedAnimation | null): void;
}

export function setupLobby(ui: LobbyElements): LobbyHandle {
  let room: LobbyRoom | null = null;
  let floors: PlacedTile[] = [];
  let wall: WallSet | null = null;
  let corner: WallSet | null = null;
  let character: LoadedAnimation | null = null;
  /**
   * Lo que el jugador ve y lo que ya vio, una niebla por piso: todos tienen
   * el mismo ancho, y con una sola lo explorado arriba aparecería abajo. Se
   * rehace en cada conexión: el servidor genera una mazmorra nueva por sala,
   * así que lo explorado de la anterior no significa nada.
   */
  let fogs = new Map<number, Fog>();
  const fogOf = (floor: number): Fog => {
    let fog = fogs.get(floor);
    if (!fog) fogs.set(floor, (fog = createFog()));
    return fog;
  };
  /** El catálogo de objetos de la sala, por id. Lo manda el servidor. */
  let catalogo = new Map<string, CatalogItem>();
  /** Lo último que se dibujó en la mochila, para no rehacerla en cada cuadro. */
  let mochilaDibujada = '';
  /** El alijo, tal como lo mandó el lobby la última vez. `null` si nunca llegó. */
  let alijo: StashContents | null = null;
  /** Cuántos de cada objeto se eligió llevar a la Vault. */
  const seleccion = new Map<string, number>();

  /**
   * El panel del alijo. Se rehace solo cuando llega el alijo o el catálogo, no
   * en cada cuadro: tiene campos de texto, y rehacerlos les sacaría el foco.
   */
  const dibujarAlijo = (): void => {
    if (!ui.stash) return;
    ui.stash.hidden = alijo === null;
    if (alijo === null) return;

    const filas = stashRows(alijo, catalogo, seleccion);
    const titulo = document.createElement('h3');
    titulo.textContent = 'Alijo';
    const resumen = document.createElement('p');
    resumen.className = 'muted';
    const resumir = (): void => {
      const llevar = loadoutFrom(alijo ?? {}, seleccion);
      resumen.textContent =
        llevar.length === 0
          ? 'No elegiste nada para llevar: entrás a la Vault con una pistola de emergencia prestada, que no vuelve con vos.'
          : `Llevás ${llevar.length} ${llevar.length === 1 ? 'objeto' : 'objetos'} (valor ${valueOfItems(llevar, catalogo)}). Al entrar salen del alijo; si no volvés, se pierden.`;
    };

    if (filas.length === 0) {
      const vacio = document.createElement('p');
      vacio.className = 'muted';
      vacio.textContent = 'Vacío. Lo que saques de una Vault con vida queda acá.';
      ui.stash.replaceChildren(titulo, vacio);
      return;
    }

    const lista = document.createElement('ul');
    lista.className = 'inventory';
    for (const fila of filas) {
      const li = document.createElement('li');
      const nombre = document.createElement('span');
      nombre.className = 'item-name';
      nombre.textContent = `${fila.name} ×${fila.count}`;
      const tipo = document.createElement('span');
      tipo.className = 'muted';
      tipo.textContent = fila.kind;
      const etiqueta = document.createElement('label');
      etiqueta.textContent = 'Llevar ';
      const campo = document.createElement('input');
      campo.type = 'number';
      campo.min = '0';
      campo.max = String(fila.count);
      campo.value = String(fila.chosen);
      campo.addEventListener('input', () => {
        const n = Math.max(0, Math.min(fila.count, Math.floor(Number(campo.value)) || 0));
        if (n === 0) seleccion.delete(fila.id);
        else seleccion.set(fila.id, n);
        resumir();
      });
      etiqueta.append(campo);
      li.append(nombre, tipo, etiqueta);
      lista.append(li);
    }
    resumir();
    ui.stash.replaceChildren(titulo, lista, resumen);
  };

  /** Dónde quedó la grilla en el último dibujo, para ubicar los clicks. */
  let origen: Origin | null = null;
  /** Última semilla avisada, para no rearmar el tablero en cada parche. */
  let tileSeed: number | null = null;

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
    const fog = fogOf(ownFloor(room.state, room.sessionId));
    origen = renderLobby(ui.canvas, floorView(room.state, room.sessionId), {
      ownSessionId: room.sessionId,
      floors,
      wall,
      corner,
      character: character ? spriteFor : null,
      // Sin máscara todavía se dibuja todo, para no arrancar en negro.
      vision: fog.empty ? null : fog,
    });
    actualizarTurno();
    actualizarMochila();
    avisarSemilla();
  };

  /**
   * La lista de la mochila. Se rehace solo si cambió algo: `draw` corre en
   * cada cuadro mientras alguien camina, y rehacer botones bajo el puntero
   * se comería los clicks.
   */
  const actualizarMochila = (): void => {
    if (!ui.inventory) return;
    const me = room?.state?.players?.get(room.sessionId);
    const filas = me?.items ? inventoryRows(me, catalogo) : [];
    const puede = turnHud(room?.state ?? null, me).canMove;
    const clave = JSON.stringify([filas, puede]);
    if (clave === mochilaDibujada) return;
    mochilaDibujada = clave;

    ui.inventory.hidden = filas.length === 0;
    ui.inventory.replaceChildren(
      ...filas.map((fila) => {
        const li = document.createElement('li');
        li.classList.toggle('equipped', fila.equipped);
        const nombre = document.createElement('span');
        nombre.className = 'item-name';
        nombre.textContent = `${fila.name}${fila.count > 1 ? ` ×${fila.count}` : ''}${fila.equipped ? ' (puesto)' : ''}`;
        const detalle = document.createElement('span');
        detalle.className = 'muted';
        detalle.textContent = fila.detail;
        li.append(nombre, detalle);
        if (fila.action) {
          const boton = document.createElement('button');
          boton.type = 'button';
          boton.textContent = ACTION_LABEL[fila.action];
          boton.dataset.item = fila.id;
          boton.dataset.action = fila.action;
          // Como las teclas: el servidor rechaza igual, esto es para que se
          // note por qué no pasa nada.
          boton.disabled = !puede;
          li.append(boton);
        }
        return li;
      }),
    );
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

  /** Avisa la semilla de tiles la primera vez que llega, y si cambia. */
  const avisarSemilla = (): void => {
    const semilla = room?.state?.tileSeed;
    if (semilla === undefined || semilla === tileSeed) return;
    tileSeed = semilla;
    ui.onTileSeed?.(semilla);
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
    tileSeed = null;
    mochilaDibujada = '';
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
    // A la Vault se baja con lo elegido del alijo; al lobby, con nada.
    const loadout = salaPorTurnos() && alijo ? loadoutFrom(alijo, seleccion) : [];
    void connectToLobby(ui.name.value, ui.room?.value ?? LOBBY_ROOM, { token: playerToken(), loadout })
      .then((joined) => {
        if (loadout.length > 0 && alijo) {
          // El servidor ya lo sacó del alijo: se refleja sin esperar a volver
          // al lobby, para no ofrecer de nuevo lo que ya está en juego.
          for (const id of loadout) alijo[id] = (alijo[id] ?? 0) - 1;
          seleccion.clear();
          dibujarAlijo();
        }
        room = joined;
        ui.connect.disabled = false;
        ui.connect.textContent = 'Desconectar';
        ui.board.hidden = false;
        setStatus(`Conectado como ${joined.sessionId}.`);

        fogs = new Map();
        onVision(joined, ({ width, cells, floor }) => {
          fogOf(floor ?? 0).update(cells, width);
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
        // Salir por una salida también corta la conexión; el aviso llega
        // antes, y es lo que tiene que quedar a la vista.
        let despedida: string | null = null;
        onExtracted(joined, ({ loot, items, saved }) => {
          const cuantos = items?.length ?? 0;
          const guardado = saved ? ' Quedó en tu alijo: entrá al lobby para verlo.' : '';
          despedida = `Saliste con vida: ${cuantos} ${cuantos === 1 ? 'objeto' : 'objetos'}, botín ${loot}.${guardado}`;
        });
        onItems(joined, (items) => {
          catalogo = new Map(items.map((item) => [item.id, item]));
          mochilaDibujada = '';
          dibujarAlijo();
          draw();
        });
        onStash(joined, ({ contents }) => {
          alijo = contents;
          dibujarAlijo();
        });
        // Los dos se mandan al entrar, pero pudieron salir antes del handler.
        requestItems(joined);
        if (!salaPorTurnos()) requestStash(joined);
        onDied(joined, ({ loot, by }) => {
          despedida = `Te mató ${by}.${loot > 0 ? ` Tu botín (${loot}) quedó donde caíste.` : ''}`;
        });
        onShot(joined, (shot) => setStatus(describeShot(shot, joined.sessionId)));
        joined.onLeave((code) => {
          if (room !== joined) return;
          if (despedida !== null) {
            disconnect(despedida);
            return;
          }
          // El servidor cerró la sala o se cayó la conexión.
          disconnect(`Conexión cerrada (código ${code}).`, code !== 1000);
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
    if (isLootKey(event.key)) {
      event.preventDefault();
      if (turnHud(room.state ?? null, room.state?.players?.get(room.sessionId)).canMove) sendLoot(room);
      return;
    }
    const step = stepForKey(event.key);
    if (!step) return;
    event.preventDefault();
    // El servidor rechaza igual el paso de quien no tiene el turno; esto
    // evita el viaje de ida y vuelta y el parpadeo que deja.
    if (!turnHud(room.state ?? null, room.state?.players?.get(room.sessionId)).canMove) return;
    sendStep(room, step);
  });

  // Click sobre otro jugador: dispararle. El servidor decide si se puede;
  // acá solo se evita mandar lo que seguro no corresponde.
  ui.canvas.addEventListener('click', (event) => {
    if (!room?.state?.players || !origen) return;
    if (!turnHud(room.state, room.state.players.get(room.sessionId)).canMove) return;
    const punto = toWorld(event.offsetX, event.offsetY, ui.canvas, origen);
    const blanco = playerAt(floorView(room.state, room.sessionId), punto, room.sessionId);
    if (blanco) sendAttack(room, blanco.sessionId);
  });

  // Un solo handler para toda la lista: los botones se rehacen seguido.
  ui.inventory?.addEventListener('click', (event) => {
    const boton = (event.target as HTMLElement).closest('button');
    if (!room || !boton?.dataset.item) return;
    const accion = boton.dataset.action as InventoryAction;
    if (accion === 'use') sendUse(room, boton.dataset.item);
    else sendEquip(room, boton.dataset.item);
  });

  ui.endTurn?.addEventListener('click', () => {
    if (room) sendEndTurn(room);
  });

  return {
    setFloor(next) {
      floors = next === null ? [] : Array.isArray(next) ? [...next] : [next as PlacedTile];
      draw();
    },
    setWall(next) {
      wall = next;
      draw();
    },
    setCorner(next) {
      corner = next;
      draw();
    },
    setCharacter(next) {
      character = next;
      movimiento.clear();
      draw();
    },
  };
}
