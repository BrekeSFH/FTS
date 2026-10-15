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
  onNotice,
  onShop,
  onShot,
  onStash,
  onTrade,
  onTradeClosed,
  onVision,
  requestItems,
  requestShop,
  requestStash,
  requestVision,
  sendAccount,
  sendAttack,
  sendBuy,
  sendDrop,
  sendEndTurn,
  sendEquip,
  sendUse,
  sendLoot,
  sendLogout,
  sendMoveTo,
  sendSell,
  sendStep,
  sendTradeAnswer,
  sendTradeOffer,
  stepForKey,
  type CatalogItem,
  type LobbyPlayer,
  type LobbyRoom,
} from './connection';
import { floorView, ownFloor } from './floors';
import type { StockEntry, TradeOffer } from './market';
import { setupMarket, type MarketView } from './marketUi';
import { createFog, type Fog } from './fog';
import { playerToken } from './identity';
import { loadoutFrom, stashRows, valueOfItems, type StashContents } from './stash';
import { ACTION_LABEL, formatKg, inventoryRows, loadSummary, weightOfItems, type InventoryAction } from './inventory';
import { playerAt, toWorld, type Origin } from './pointer';
import { cellCenter, screenToGrid, type Point } from '../iso/projection';
import { previewPath } from './path';
import type { Hover } from './render';
import { PASO_MS, createMotion } from './motion';
import { turnHud } from './hud';
import { renderLobby, type PlacedTile, type WallSet } from './render';

/**
 * La resolución de la pantalla completa: la del juego en un monitor Full HD.
 * En otro monitor se escala sin deformarse.
 */
export const PANTALLA = { width: 1920, height: 1080 } as const;

/** Lo que cuesta abrir un contenedor, para sumarlo al camino. Lo cobra el servidor. */
const AP_SAQUEO = 2;

/** Los escalones de zoom de la rueda, y con cuál se arranca. */
export const ZOOMS: readonly number[] = [1, 1.5, 2, 2.5, 3];
const ZOOM_INICIAL = 2;

/**
 * Cuánto dura cada frame de la caminata. Un ciclo de 12 frames recorre dos
 * celdas, así que va atado a `PASO_MS`: si no, los pies patinan.
 */
const MS_POR_FRAME_CAMINANDO = (2 * PASO_MS) / 12;
/** Cuánto dura cada frame de quieto. Despacio: es respirar, no moverse. */
const MS_POR_FRAME_QUIETO = 160;

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
  /** Línea con lo que pesa la mochila y la munición del arma. Solo en la Vault. */
  load?: HTMLElement | null;
  /**
   * Aviso dentro del tablero: repite el último mensaje de estado, que en
   * pantalla completa no se vería porque la línea de estado queda afuera.
   */
  toast?: HTMLElement | null;
  /**
   * Panel del alijo: lo que hay guardado y qué llevar. Se llena al entrar al
   * lobby y queda a la vista al desconectarse, para elegir antes de bajar.
   */
  stash?: HTMLElement | null;
  /**
   * Panel de comercio: cuenta, créditos, mercader e intercambios. Solo se ve
   * con el lobby conectado, porque todo lo que ofrece pasa por el servidor.
   */
  market?: HTMLElement | null;
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
  setCharacter(walk: LoadedAnimation | null, stand?: LoadedAnimation | null): void;
}

export function setupLobby(ui: LobbyElements): LobbyHandle {
  let room: LobbyRoom | null = null;
  let floors: PlacedTile[] = [];
  let wall: WallSet | null = null;
  let corner: WallSet | null = null;
  let character: LoadedAnimation | null = null;
  /** La animación de quieto. Sin ella, quieto es el primer frame de la caminata. */
  let quieto: LoadedAnimation | null = null;
  /**
   * Lo que el jugador ve y lo que ya vio, una niebla por piso: todos tienen
   * el mismo ancho, y con una sola lo explorado arriba aparecería abajo. Se
   * rehace en cada conexión: el servidor genera una mazmorra nueva por sala,
   * así que lo explorado de la anterior no significa nada.
   */
  let fogs = new Map<number, Fog>();
  /**
   * Lo que se sabe del mapa de cada piso, como lo mandó el servidor la última
   * vez. Es lo único del mapa que llega en la Vault.
   */
  let mapas = new Map<number, string>();
  const fogOf = (floor: number): Fog => {
    let fog = fogs.get(floor);
    if (!fog) fogs.set(floor, (fog = createFog()));
    return fog;
  };
  /** El catálogo de objetos de la sala, por id. Lo manda el servidor. */
  let catalogo = new Map<string, CatalogItem>();
  /** Cuántos kilos se pueden llevar. Lo manda el servidor con el catálogo. */
  let cargaMaxima = 0;
  /** Lo último que se dibujó en la mochila, para no rehacerla en cada cuadro. */
  let mochilaDibujada = '';
  /** El alijo, tal como lo mandó el lobby la última vez. `null` si nunca llegó. */
  let alijo: StashContents | null = null;
  /** Cuántos de cada objeto se eligió llevar a la Vault. */
  const seleccion = new Map<string, number>();
  /** Créditos y cuenta, como los mandó el lobby con el alijo. */
  let creditos = 0;
  let cuenta: string | null = null;
  /** Lo que vende el mercader. */
  let stock: StockEntry[] = [];
  /** La oferta de intercambio que le hicieron, si hay una abierta. */
  let ofertaRecibida: TradeOffer | null = null;

  const market: MarketView | null = ui.market
    ? setupMarket(ui.market, {
        buy: (item) => room && sendBuy(room, item),
        sell: (items) => room && sendSell(room, items),
        offer: (request) => room && sendTradeOffer(room, request),
        answer: (id, accept) => room && sendTradeAnswer(room, id, accept),
        register: (name, password) => room && sendAccount(room, 'register', name, password),
        login: (name, password) => room && sendAccount(room, 'login', name, password),
        logout: () => room && sendLogout(room),
      })
    : null;

  /**
   * El panel de comercio, con lo último que se sabe. Las secciones que no
   * cambiaron no se tocan, así que se puede llamar en cada cuadro.
   */
  const actualizarComercio = (): void => {
    if (!ui.market || !market) return;
    const enLobby = room !== null && !salaPorTurnos() && alijo !== null;
    ui.market.hidden = !enLobby;
    if (!enLobby || !room?.state?.players) return;
    const others: Array<{ sessionId: string; name: string }> = [];
    room.state.players.forEach((p, sessionId) => {
      if (sessionId !== room!.sessionId) others.push({ sessionId, name: p.name });
    });
    others.sort((a, b) => a.name.localeCompare(b.name) || a.sessionId.localeCompare(b.sessionId));
    market.update({ catalogo, stock, contents: alijo ?? {}, credits: creditos, account: cuenta, others, incoming: ofertaRecibida });
  };

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
      const peso = weightOfItems(llevar, catalogo);
      // El servidor rechaza igual al que se pasa; esto es para que se sepa
      // antes de intentar.
      const pasado = cargaMaxima > 0 && peso > cargaMaxima;
      resumen.classList.toggle('error', pasado);
      resumen.textContent =
        llevar.length === 0
          ? 'No elegiste nada para llevar: entrás a la Vault con una pistola de emergencia prestada, que no vuelve con vos.'
          : pasado
            ? `Eso pesa ${formatKg(peso)} kg y se pueden cargar ${formatKg(cargaMaxima)}: sacá algo para poder entrar.`
            : `Llevás ${llevar.length} ${llevar.length === 1 ? 'objeto' : 'objetos'} (valor ${valueOfItems(llevar, catalogo)}, ${formatKg(peso)} de ${formatKg(cargaMaxima)} kg). Al entrar salen del alijo; si no volvés, se pierden.`;
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
   * El trayecto de cada uno entre la celda de antes y la de ahora. El estado
   * solo dice la celda; el paso se dibuja acá, a lo largo de `PASO_MS`.
   */
  const movimiento = createMotion();

  /**
   * Cuánto se agranda el mundo. A tamaño original, en una pantalla de 1920
   * los personajes quedan diminutos; el juego se jugaba en 640×480 u
   * 800×600. Se cambia con la rueda del mouse.
   */
  let zoom = ZOOM_INICIAL;

  /** Para que un aviso nuevo no se borre con el plazo del anterior. */
  let plazoAviso: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (message: string, isError = false): void => {
    ui.status.textContent = message;
    ui.status.classList.toggle('error', isError);
    if (!ui.toast) return;
    ui.toast.textContent = message;
    ui.toast.classList.toggle('error', isError);
    ui.toast.hidden = message.length === 0;
    if (plazoAviso) clearTimeout(plazoAviso);
    plazoAviso = setTimeout(() => {
      if (ui.toast) ui.toast.hidden = true;
    }, 5000);
  };

  /** Dónde está el mouse sobre el canvas, en píxeles de la pantalla. */
  let mouse: { x: number; y: number } | null = null;

  /**
   * Qué haría un click donde está el mouse: disparar a alguien, abrir un
   * contenedor o caminar hasta una celda. Es lo mismo para marcar el camino
   * que para hacer el click, así lo que se ve es lo que pasa.
   */
  type Intencion =
    | { tipo: 'disparar'; blanco: string }
    | { tipo: 'saquear'; celda: Point; camino: Point[] | null }
    | { tipo: 'caminar'; celda: Point; camino: Point[] | null };

  const intencion = (): Intencion | null => {
    if (!room?.state?.players || !origen || !mouse) return null;
    const vista = floorView(room.state, room.sessionId, mapas);
    const punto = toWorld(mouse.x, mouse.y, ui.canvas, origen);
    const blanco = playerAt(vista, punto, room.sessionId);
    // En el lobby no se dispara: hacer click en alguien es ir hasta él.
    if (blanco && salaPorTurnos()) return { tipo: 'disparar', blanco: blanco.sessionId };
    const celda = screenToGrid(punto.x, punto.y);
    const yo = room.state.players.get(room.sessionId);
    if (!yo || !vista.cells) return null;
    const ocupada = (x: number, y: number) => {
      let hay = false;
      vista.players.forEach((p) => (hay ||= p.x === x && p.y === y));
      return hay;
    };
    const cofre = Array.from(vista.caches ?? []).some((c) => !c.looted && c.x === celda.x && c.y === celda.y);
    const alLado = cofre || ocupada(celda.x, celda.y);
    const camino = previewPath(
      { width: vista.width, height: vista.height, cells: vista.cells },
      yo,
      celda,
      ocupada,
      alLado,
    );
    return { tipo: cofre ? 'saquear' : 'caminar', celda, camino };
  };

  /** Lo que se marca bajo el mouse, con lo que costaría en la Vault. */
  const marcaDelMouse = (): Hover | null => {
    const i = intencion();
    if (!i || i.tipo === 'disparar' || !i.camino) return null;
    const yo = room?.state?.players?.get(room.sessionId);
    if (!salaPorTurnos() || !yo) return { path: i.camino, target: i.celda, label: '', reachable: true };
    const costo = i.camino.length + (i.tipo === 'saquear' ? AP_SAQUEO : 0);
    const ap = yo.active ? (yo.ap ?? 0) : 0;
    const label = i.tipo === 'saquear' ? `Abrir · ${costo} PA` : `${costo} PA`;
    return { path: i.camino, target: i.celda, label, reachable: costo <= ap };
  };

  /** A quiénes se está animando, para olvidar a los que se van. */
  let idsAnimados = new Set<string>();

  const draw = (): void => {
    // `joinOrCreate` resuelve antes de que llegue el primer estado, así que
    // puede no haber nada que dibujar todavía. El primer `onStateChange` lo
    // resuelve enseguida.
    if (!room?.state?.players) return;
    const fog = fogOf(ownFloor(room.state, room.sessionId));
    const ahora = performance.now();
    const presentes = new Set<string>();
    room.state.players.forEach((p, id) => {
      presentes.add(id);
      movimiento.update(id, p.x, p.y, ahora);
    });
    const yo = movimiento.position(room.sessionId, ahora);
    origen = renderLobby(ui.canvas, floorView(room.state, room.sessionId, mapas), {
      ownSessionId: room.sessionId,
      floors,
      wall,
      corner,
      character: character ? spriteFor : null,
      // Sin máscara todavía se dibuja todo, para no arrancar en negro.
      vision: fog.empty ? null : fog,
      // En pantalla completa, la pantalla del juego: 1920×1080 a tamaño
      // original, siguiendo al personaje propio.
      position: (_, id) => movimiento.position(id, ahora),
      hover: marcaDelMouse(),
      // Una cámara como la del juego, siguiendo al personaje propio a mitad
      // de cada paso. En pantalla completa ocupa 1920×1080; el canvas dibuja
      // menos píxeles según el zoom, y se agranda sin suavizar.
      viewport: {
        width: Math.round(PANTALLA.width / zoom),
        height: Math.round(PANTALLA.height / zoom),
        focus: yo ? cellCenter(yo.x, yo.y) : null,
      },
    });
    // Los que se fueron no tienen por qué seguir ocupando memoria.
    for (const id of idsAnimados) if (!presentes.has(id)) movimiento.forget(id);
    idsAnimados = presentes;
    actualizarTurno();
    actualizarMochila();
    actualizarComercio();
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
    const carga = me?.items && cargaMaxima > 0 ? loadSummary(me, catalogo, cargaMaxima) : '';
    const clave = JSON.stringify([filas, puede, carga]);
    if (clave === mochilaDibujada) return;
    mochilaDibujada = clave;

    if (ui.load) {
      ui.load.textContent = carga;
      ui.load.hidden = carga.length === 0;
    }
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
        const acciones: InventoryAction[] = [...(fila.action ? [fila.action] : []), ...(fila.canDrop ? ['drop' as const] : [])];
        for (const [n, accion] of acciones.entries()) {
          const boton = document.createElement('button');
          boton.type = 'button';
          boton.textContent = ACTION_LABEL[accion];
          boton.dataset.item = fila.id;
          boton.dataset.action = accion;
          // Solo el primero se va a la derecha; el resto queda pegado.
          if (n > 0) boton.classList.add('next');
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

  /**
   * Elige el sprite de un jugador: la caminata mientras va de una celda a la
   * otra, con el ciclo corriendo de corrido, y la animación de quieto cuando
   * se para. Siempre en el rumbo al que mira.
   */
  const spriteFor = (player: LobbyPlayer, sessionId: string): PlacedTile | null => {
    if (!character) return null;
    const ahora = performance.now();
    const pos = movimiento.position(sessionId, ahora);
    const caminando = pos?.walking ?? false;
    const animacion = caminando || !quieto ? character : quieto;
    // Si la animación no cubre los ocho rumbos se cae al primero, que es
    // preferible a mostrar una dirección equivocada.
    const frames = animacion.images[player.facing] ?? animacion.images[0];
    let frame = 0;
    if (caminando && pos) frame = Math.floor((ahora - pos.walkStart) / MS_POR_FRAME_CAMINANDO) % frames.length;
    else if (quieto) frame = Math.floor(ahora / MS_POR_FRAME_QUIETO) % frames.length;
    const sprite = frames[frame] ?? frames[0];
    return { bitmap: sprite.bitmap, anchorX: sprite.anchorX, anchorY: sprite.anchorY };
  };

  // La rueda acerca y aleja, de a un escalón, sobre el tablero.
  ui.canvas.addEventListener(
    'wheel',
    (event) => {
      if (!room) return;
      event.preventDefault();
      const i = ZOOMS.indexOf(zoom);
      const siguiente = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (event.deltaY < 0 ? 1 : -1)))];
      if (siguiente === zoom) return;
      zoom = siguiente;
      draw();
    },
    { passive: false },
  );

  const disconnect = (reason: string, isError = false): void => {
    room = null;
    ui.board.hidden = true;
    ui.connect.disabled = false;
    ui.connect.textContent = 'Conectar';
    if (ui.room) ui.room.disabled = false;
    tileSeed = null;
    mochilaDibujada = '';
    if (ui.load) ui.load.hidden = true;
    ofertaRecibida = null;
    if (ui.market) ui.market.hidden = true;
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
    // El tamaño del canvas cambia con el modo: hay que volver a dibujar.
    draw();
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
        mapas = new Map();
        // Otra sala, otra gente: lo que se venía animando no sigue.
        movimiento.clear();
        onVision(joined, ({ width, cells, floor, map }) => {
          fogOf(floor ?? 0).update(cells, width);
          if (map !== undefined) mapas.set(floor ?? 0, map);
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
          if (character || movimiento.moving(performance.now())) draw();
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
        onItems(joined, ({ items, maxCarry }) => {
          catalogo = new Map(items.map((item) => [item.id, item]));
          cargaMaxima = maxCarry;
          mochilaDibujada = '';
          dibujarAlijo();
          draw();
        });
        onStash(joined, ({ contents, credits, account }) => {
          alijo = contents;
          creditos = credits ?? 0;
          cuenta = account ?? null;
          dibujarAlijo();
          actualizarComercio();
        });
        onShop(joined, (m) => {
          stock = m.stock;
          actualizarComercio();
        });
        onTrade(joined, (oferta) => {
          ofertaRecibida = oferta;
          setStatus(`${oferta.fromName || 'Alguien'} te hizo una oferta: mirala en Comercio.`);
          actualizarComercio();
        });
        onTradeClosed(joined, ({ id, text }) => {
          if (ofertaRecibida?.id === id) ofertaRecibida = null;
          setStatus(text);
          actualizarComercio();
        });
        // Los dos se mandan al entrar, pero pudieron salir antes del handler.
        requestItems(joined);
        if (!salaPorTurnos()) {
          requestStash(joined);
          requestShop(joined);
        }
        onDied(joined, ({ loot, by }) => {
          despedida = `Te mató ${by}.${loot > 0 ? ` Tu botín (${loot}) quedó donde caíste.` : ''}`;
        });
        onShot(joined, (shot) => setStatus(describeShot(shot, joined.sessionId)));
        onNotice(joined, ({ text }) => setStatus(text));
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

  // Se juega con el mouse, como en el juego: click en una celda para ir,
  // en un contenedor para abrirlo y en alguien para dispararle. El servidor
  // decide si se puede; acá solo se evita mandar lo que seguro no corresponde.
  ui.canvas.addEventListener('click', (event) => {
    mouse = { x: event.offsetX, y: event.offsetY };
    if (!room?.state?.players) return;
    if (!turnHud(room.state, room.state.players.get(room.sessionId)).canMove) return;
    const i = intencion();
    if (!i) return;
    if (i.tipo === 'disparar') sendAttack(room, i.blanco);
    else sendMoveTo(room, i.celda.x, i.celda.y, i.tipo === 'saquear' ? 'loot' : undefined);
  });

  // El cursor dice qué haría el click: mira para disparar, mano para abrir.
  ui.canvas.addEventListener('mousemove', (event) => {
    mouse = { x: event.offsetX, y: event.offsetY };
    const i = intencion();
    ui.canvas.style.cursor = i?.tipo === 'disparar' ? 'crosshair' : i?.tipo === 'saquear' ? 'pointer' : 'default';
    draw();
  });
  ui.canvas.addEventListener('mouseleave', () => {
    mouse = null;
    draw();
  });

  // Un solo handler para toda la lista: los botones se rehacen seguido.
  ui.inventory?.addEventListener('click', (event) => {
    const boton = (event.target as HTMLElement).closest('button');
    if (!room || !boton?.dataset.item) return;
    const accion = boton.dataset.action as InventoryAction;
    if (accion === 'use') sendUse(room, boton.dataset.item);
    else if (accion === 'drop') sendDrop(room, boton.dataset.item);
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
    setCharacter(next, stand = null) {
      character = next;
      quieto = next ? stand : null;
      draw();
    },
  };
}
