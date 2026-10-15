/**
 * Lobby del Hito 3: puntos moviéndose en una grilla vacía, sincronizados
 * entre varios navegadores.
 *
 * El GDD exige autoridad del servidor en todos los modos, así que el cliente
 * no mueve a nadie: pide un paso y el servidor decide. Todo lo que llega por
 * mensaje se valida antes de tocar el estado.
 *
 * Es además donde se maneja el alijo fuera de las Vaults, como pide el punto
 * 3: venderle al mercader, comprarle, intercambiar con otros jugadores y
 * atar el alijo a una cuenta.
 */
import { Client, Room } from '@colyseus/core';
import { currentStash, playerIdFromToken, type AccountError, type StashContents } from '../stash';
import { DEFAULT_FACING, facingFromStep } from './direction';
import { ITEMS_PAYLOAD, itemById } from './items';
import { STOCK, countsOf, sanitizeCounts, sanitizeCredits, sellPrice, stockEntry, type ShopMessage } from './market';
import { floorCells, generateMap, isBlocked, randomSeed, type Cell, type GeneratedMap } from './map';
import { PASO_RUTA_MS, findPath } from './path';
import { LobbyState, MapSchema, Player, type LobbyStateType } from './state';
import { SIGHT_RADIUS, visibleMask } from './vision';

/** En Colyseus 0.18 el genérico de `Room` describe la sala, no solo el estado. */
type LobbyRoomOptions = { state: LobbyStateType };

/** Tamaño de la grilla en celdas. */
export const GRID_WIDTH = 32;
export const GRID_HEIGHT = 24;
/** Tope de jugadores en el lobby. */
export const MAX_CLIENTS = 32;

/** Salas chicas y varias: en 32x24 entra una mazmorra modesta. */
const MAP_OPTIONS = { rooms: 5, minRoom: 4, maxRoom: 7 };

const MAX_NAME_LENGTH = 16;

/**
 * Nombre del mensaje con el que cada cliente recibe lo que ve.
 *
 * Va por mensaje privado y no como campo del estado a propósito: la máscara
 * de uno no es asunto de los demás. Que el cliente igual reciba el mapa
 * entero es una deuda aparte —habría que mandarle solo lo explorado—, pero no
 * hay razón para agregarle encima la vista de los rivales.
 */
export const VISION_MESSAGE = 'vision';

/**
 * Lo que viaja en ese mensaje. Lleva el ancho porque sin él la máscara no se
 * puede indexar, y el mensaje puede llegarle al cliente antes que el estado.
 */
export interface VisionMessage {
  width: number;
  /** Una celda por carácter, fila por fila. `1` es visible. */
  cells: string;
}

export interface MoveMessage {
  dx: number;
  dy: number;
}

export interface JoinOptions {
  name?: unknown;
  /** Token del jugador, que lo identifica para su alijo. */
  token?: unknown;
}

/**
 * Mensaje con el alijo de quien lo pide. Es por jugador, así que no va en el
 * estado, como la visión.
 */
export const STASH_MESSAGE = 'stash';

export interface StashMessage {
  /** Cuántos de cada objeto. Vacío también si el servidor no tiene alijo. */
  contents: StashContents;
  /** Cuántos créditos tiene. */
  credits: number;
  /** El nombre de su cuenta, o `null` si el alijo vive solo en el navegador. */
  account: string | null;
}

/** Mensaje con lo que vende el mercader. Se manda al entrar y a pedido. */
export const SHOP_MESSAGE = 'shop';

/**
 * Mensaje con el motivo de algo que no se hizo, o el resultado de algo que
 * no cambia nada a la vista: una venta, una oferta mandada.
 */
export const NOTICE_MESSAGE = 'notice';

export interface NoticeMessage {
  text: string;
}

/** Mensaje con una oferta de intercambio, para quien la recibe. */
export const TRADE_MESSAGE = 'trade';

/**
 * Una oferta de intercambio. Va con un id para que aceptar una oferta vieja,
 * ya reemplazada por otra, no acepte la nueva sin haberla leído.
 */
export interface TradeOffer {
  id: number;
  /** Sesión de quien la hace. */
  from: string;
  fromName: string;
  /** Sesión de quien la recibe. */
  to: string;
  /** Lo que entrega quien la hace. */
  give: Record<string, number>;
  giveCredits: number;
  /** Lo que pide a cambio. */
  want: Record<string, number>;
  wantCredits: number;
}

/** Mensaje que avisa que una oferta ya no está: se aceptó, se rechazó o se retiró. */
export const TRADE_CLOSED_MESSAGE = 'tradeClosed';

export interface TradeClosed {
  id: number;
  /** Qué pasó con ella, para mostrarlo. */
  text: string;
}

/** Lo que manda el cliente para ofrecer un intercambio. */
export interface TradeOfferRequest {
  to?: unknown;
  give?: unknown;
  giveCredits?: unknown;
  want?: unknown;
  wantCredits?: unknown;
}

/** Cómo se cuenta cada motivo de error de cuentas. */
export const ACCOUNT_ERRORS: Record<AccountError, string> = {
  'nombre-invalido': 'El nombre va de 3 a 20 letras sin acentos, números, guiones o guiones bajos.',
  'clave-invalida': 'La clave tiene que tener por lo menos 8 caracteres.',
  'nombre-ocupado': 'Ya hay una cuenta con ese nombre.',
  'ya-tiene-cuenta': 'Este alijo ya tiene cuenta.',
  'datos-incorrectos': 'Nombre o clave incorrectos.',
};

/** Intentos de entrar a una cuenta que se aceptan por conexión y por minuto. */
const INTENTOS_POR_MINUTO = 5;

/** Mismo mensaje que en la Vault: el catálogo hace falta para leer el alijo. */
export const ITEMS_MESSAGE = 'items';

/** Un paso válido mueve una celda en alguna de las ocho direcciones. */
function isSingleStep(dx: number, dy: number): boolean {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  if (dx === 0 && dy === 0) return false;
  return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

/** El nombre lo propone el cliente, así que se recorta y se limpia. */
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // Fuera los caracteres de control, que romperían el render del cliente.
  const clean = Array.from(raw)
    .filter((c) => c.codePointAt(0)! >= 0x20)
    .join('')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return clean.length > 0 ? clean : fallback;
}

export class LobbyRoom extends Room<LobbyRoomOptions> {
  maxClients = MAX_CLIENTS;

  /** El mapa generado, para consultarlo sin releer la cadena del estado. */
  map: GeneratedMap = generateMap(GRID_WIDTH, GRID_HEIGHT, 1, MAP_OPTIONS);

  override onCreate(options: { seed?: number } = {}): void {
    // Semilla al azar salvo que se pida una, que es lo que usan los tests.
    const seed = options.seed ?? randomSeed();
    this.map = generateMap(GRID_WIDTH, GRID_HEIGHT, seed, MAP_OPTIONS);
    this.state = new LobbyState({
      width: this.map.width,
      height: this.map.height,
      cells: this.map.cells,
      tileSeed: seed,
      players: new MapSchema(),
    });

    this.onMessage('move', (client, message: MoveMessage) => {
      this.rutas.delete(client.sessionId);
      // Solo si se movió: girar en el lugar no cambia lo que se ve, porque la
      // vista es circular y no un cono. El día que sea un cono, esto cambia.
      if (this.tryMove(client.sessionId, message)) this.sendVision(client);
    });

    // Con un click se camina hasta la celda, de a un paso, a la misma cadencia
    // que en la Vault. Acá no hay turnos ni acción que gastar.
    this.onMessage('moveTo', (client, message: { x?: unknown; y?: unknown }) => this.planRoute(client, message));
    this.clock.setInterval(() => {
      for (const id of [...this.rutas.keys()]) this.avanzarRuta(id);
    }, PASO_RUTA_MS);

    // El cliente también puede pedirla. El empujón de `onJoin` sale mientras
    // el cliente todavía está terminando de engancharse, así que quien no lo
    // haya visto llegar tiene cómo reclamarlo en vez de quedarse a ciegas.
    this.onMessage(VISION_MESSAGE, (client) => this.sendVision(client));

    // El alijo y el catálogo, a pedido: se mandan al entrar, pero pueden
    // llegar antes de que el cliente escuche, igual que la visión.
    this.onMessage(STASH_MESSAGE, (client) => this.sendStash(client));
    this.onMessage(ITEMS_MESSAGE, (client) => client.send(ITEMS_MESSAGE, ITEMS_PAYLOAD));
    this.onMessage(SHOP_MESSAGE, (client) => client.send(SHOP_MESSAGE, { stock: STOCK } satisfies ShopMessage));

    this.onMessage('sell', (client, message: { items?: unknown }) => this.sell(client, message?.items));
    this.onMessage('buy', (client, message: { item?: unknown }) => this.buy(client, message?.item));
    this.onMessage('tradeOffer', (client, message: TradeOfferRequest) => this.offer(client, message ?? {}));
    this.onMessage('tradeAnswer', (client, message: { id?: unknown; accept?: unknown }) =>
      this.answer(client, message?.id, message?.accept === true),
    );
    this.onMessage('tradeCancel', (client) => this.cancelOffer(client.sessionId, 'La retiró quien la hizo.'));

    this.onMessage('register', (client, message: { name?: unknown; password?: unknown }) =>
      this.account(client, 'register', message?.name, message?.password),
    );
    this.onMessage('login', (client, message: { name?: unknown; password?: unknown }) =>
      this.account(client, 'login', message?.name, message?.password),
    );
    this.onMessage('logout', (client) => this.logout(client));
  }

  /** Lo que le falta caminar a cada uno de la ruta que pidió con un click. */
  private rutas = new Map<string, Cell[]>();

  planRoute(client: Client, message: { x?: unknown; y?: unknown } | undefined): boolean {
    this.rutas.delete(client.sessionId);
    const yo = this.state.players.get(client.sessionId);
    const { x, y } = message ?? {};
    if (!yo || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    const destino = { x: x as number, y: y as number };
    const camino = findPath(this.map, yo, destino, {
      ocupada: (cx, cy) => this.isOccupied(cx, cy),
      alLado: this.isOccupied(destino.x, destino.y),
    });
    if (!camino || camino.length === 0) return false;
    this.rutas.set(client.sessionId, camino);
    this.avanzarRuta(client.sessionId);
    return true;
  }

  private avanzarRuta(sessionId: string): void {
    const yo = this.state.players.get(sessionId);
    const siguiente = this.rutas.get(sessionId)?.shift();
    if (!yo || !siguiente || !this.tryMove(sessionId, { dx: siguiente.x - yo.x, dy: siguiente.y - yo.y })) {
      this.rutas.delete(sessionId);
      return;
    }
    const client = this.clients.getById(sessionId);
    if (client) this.sendVision(client);
    if (this.rutas.get(sessionId)?.length === 0) this.rutas.delete(sessionId);
  }

  /** De qué jugador es cada sesión, para leerle el alijo. */
  private duenos = new Map<string, string>();

  /** El hash del token de cada sesión, para atarlo o desatarlo de una cuenta. */
  private tokens = new Map<string, string>();

  /** La oferta abierta de cada sesión: una por vez, la nueva reemplaza a la vieja. */
  private ofertas = new Map<string, TradeOffer>();
  private siguienteOferta = 1;

  /** Cuándo intentó entrar a una cuenta cada sesión, para frenar a quien prueba claves. */
  private intentos = new Map<string, number[]>();

  private sendStash(client: Client): void {
    const player = this.duenos.get(client.sessionId);
    const stash = currentStash();
    const contents = player ? (stash?.contents(player) ?? {}) : {};
    const credits = player ? (stash?.credits(player) ?? 0) : 0;
    const account = player ? (stash?.accountName(player) ?? null) : null;
    client.send(STASH_MESSAGE, { contents, credits, account } satisfies StashMessage);
  }

  private notice(client: Client | undefined, text: string): void {
    client?.send(NOTICE_MESSAGE, { text } satisfies NoticeMessage);
  }

  /** El jugador y el alijo de una sesión, o `null` avisándole por qué no. */
  private alijoDe(client: Client): { player: string; stash: NonNullable<ReturnType<typeof currentStash>> } | null {
    const player = this.duenos.get(client.sessionId);
    const stash = currentStash();
    if (!player || !stash) {
      this.notice(client, 'Este servidor no guarda alijos, o tu navegador no mandó con qué reconocerte.');
      return null;
    }
    return { player, stash };
  }

  /** Le vende al mercader. Todo o nada, a lo que vale cada cosa. */
  sell(client: Client, raw: unknown): boolean {
    const yo = this.alijoDe(client);
    const items = sanitizeCounts(raw);
    if (!yo || items.length === 0) return false;
    const credits = items.reduce((total, id) => total + sellPrice(id), 0);
    if (!yo.stash.exchange(yo.player, { items, credits: 0 }, { items: [], credits })) {
      this.notice(client, 'No tenés todo eso en el alijo.');
      return false;
    }
    this.notice(client, `Vendiste ${items.length} ${items.length === 1 ? 'objeto' : 'objetos'} por ${credits} créditos.`);
    this.sendStash(client);
    return true;
  }

  /** Le compra al mercader una unidad de lo que vende. */
  buy(client: Client, raw: unknown): boolean {
    const yo = this.alijoDe(client);
    const entrada = typeof raw === 'string' ? stockEntry(raw) : undefined;
    if (!yo || !entrada) return false;
    const items = Array<string>(entrada.quantity).fill(entrada.id);
    if (!yo.stash.exchange(yo.player, { items: [], credits: entrada.price }, { items, credits: 0 })) {
      this.notice(client, `No te alcanza: cuesta ${entrada.price} créditos.`);
      return false;
    }
    const nombre = itemById(entrada.id)?.name ?? entrada.id;
    this.notice(client, `Compraste ${entrada.quantity > 1 ? `${entrada.quantity} ` : ''}${nombre} por ${entrada.price} créditos.`);
    this.sendStash(client);
    return true;
  }

  /**
   * Ofrece un intercambio a otro jugador del lobby. Se revisa ya que quien
   * ofrece tenga lo que da, para no molestar al otro con algo imposible; lo
   * del otro se revisa al aceptar, y todo se vuelve a revisar ahí.
   */
  offer(client: Client, pedido: TradeOfferRequest): TradeOffer | null {
    const yo = this.alijoDe(client);
    if (!yo) return null;
    const to = typeof pedido.to === 'string' ? pedido.to : '';
    const otro = this.clients.getById(to);
    if (!otro || to === client.sessionId || !this.duenos.has(to)) {
      this.notice(client, 'Esa persona ya no está en el lobby.');
      return null;
    }
    const give = sanitizeCounts(pedido.give);
    const want = sanitizeCounts(pedido.want);
    const giveCredits = sanitizeCredits(pedido.giveCredits);
    const wantCredits = sanitizeCredits(pedido.wantCredits);
    if (give.length + want.length === 0 && giveCredits + wantCredits === 0) return null;
    if (this.duenos.get(to) === yo.player) {
      this.notice(client, 'No podés intercambiar con vos mismo.');
      return null;
    }

    const tengo = yo.stash.contents(yo.player);
    const falta = Object.entries(countsOf(give)).some(([id, n]) => (tengo[id] ?? 0) < n);
    if (falta || yo.stash.credits(yo.player) < giveCredits) {
      this.notice(client, 'No tenés todo lo que ofrecés.');
      return null;
    }

    this.cancelOffer(client.sessionId, 'La reemplazó otra.');
    const oferta: TradeOffer = {
      id: this.siguienteOferta++,
      from: client.sessionId,
      fromName: this.state.players.get(client.sessionId)?.name ?? '',
      to,
      give: countsOf(give),
      giveCredits,
      want: countsOf(want),
      wantCredits,
    };
    this.ofertas.set(client.sessionId, oferta);
    otro.send(TRADE_MESSAGE, oferta);
    this.notice(client, `Le mandaste la oferta a ${this.state.players.get(to)?.name ?? 'otro jugador'}.`);
    return oferta;
  }

  /** Acepta o rechaza una oferta recibida. Aceptar hace el intercambio entero o nada. */
  answer(client: Client, rawId: unknown, accept: boolean): boolean {
    const oferta = [...this.ofertas.values()].find((o) => o.id === rawId && o.to === client.sessionId);
    if (!oferta) {
      this.notice(client, 'Esa oferta ya no está.');
      return false;
    }
    this.ofertas.delete(oferta.from);
    const de = this.clients.getById(oferta.from);
    const cerrar = (text: string) => {
      for (const c of [client, de]) c?.send(TRADE_CLOSED_MESSAGE, { id: oferta.id, text } satisfies TradeClosed);
    };
    if (!accept) {
      cerrar('Oferta rechazada.');
      return false;
    }

    const stash = currentStash();
    const a = this.duenos.get(oferta.from);
    const b = this.duenos.get(client.sessionId);
    const lista = (counts: Record<string, number>) => sanitizeCounts(counts);
    const hecho =
      stash !== null &&
      a !== undefined &&
      b !== undefined &&
      stash.trade(
        a,
        { items: lista(oferta.give), credits: oferta.giveCredits },
        b,
        { items: lista(oferta.want), credits: oferta.wantCredits },
      );
    if (!hecho) {
      cerrar('No se pudo: a alguno de los dos ya le falta algo de lo acordado.');
      return false;
    }
    cerrar('Intercambio hecho.');
    if (de) this.sendStash(de);
    this.sendStash(client);
    return true;
  }

  /** Retira la oferta abierta de una sesión, si tiene una. */
  private cancelOffer(sessionId: string, text: string): void {
    const oferta = this.ofertas.get(sessionId);
    if (!oferta) return;
    this.ofertas.delete(sessionId);
    for (const id of [oferta.from, oferta.to]) {
      this.clients.getById(id)?.send(TRADE_CLOSED_MESSAGE, { id: oferta.id, text } satisfies TradeClosed);
    }
  }

  /**
   * Crea una cuenta o entra a una, desde la sesión. Después de cualquiera de
   * las dos, la sesión ya es del jugador de la cuenta y se le manda su alijo.
   */
  account(client: Client, accion: 'register' | 'login', rawName: unknown, rawPassword: unknown): boolean {
    const stash = currentStash();
    const token = this.tokens.get(client.sessionId);
    if (!stash || !token) {
      this.notice(client, 'Este servidor no guarda alijos, o tu navegador no mandó con qué reconocerte.');
      return false;
    }
    const ahora = Date.now();
    const recientes = (this.intentos.get(client.sessionId) ?? []).filter((t) => ahora - t < 60_000);
    if (recientes.length >= INTENTOS_POR_MINUTO) {
      this.notice(client, 'Demasiados intentos. Esperá un minuto.');
      return false;
    }
    this.intentos.set(client.sessionId, [...recientes, ahora]);

    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    const resultado = accion === 'register' ? stash.register(token, name, password) : stash.login(token, name, password);
    if ('error' in resultado) {
      this.notice(client, ACCOUNT_ERRORS[resultado.error]);
      return false;
    }
    this.duenos.set(client.sessionId, resultado.player);
    // Una oferta hecha con el alijo de antes ya no corresponde.
    this.cancelOffer(client.sessionId, 'Quien la hizo cambió de cuenta.');
    this.notice(client, accion === 'register' ? 'Cuenta creada.' : 'Entraste a tu cuenta.');
    this.sendStash(client);
    return true;
  }

  /** Desata este navegador de su cuenta. Lo guardado queda en la cuenta. */
  logout(client: Client): void {
    const stash = currentStash();
    const token = this.tokens.get(client.sessionId);
    if (!stash || !token) return;
    stash.logout(token);
    this.duenos.set(client.sessionId, stash.resolve(token));
    this.cancelOffer(client.sessionId, 'Quien la hizo cambió de cuenta.');
    this.notice(client, 'Saliste de la cuenta. Lo guardado sigue en ella.');
    this.sendStash(client);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const spawn = this.findFreeCell();
    if (!spawn) {
      // La grilla llena antes que maxClients sería un error de configuración.
      throw new Error('No hay celdas libres en el lobby');
    }

    this.state.players.set(
      client.sessionId,
      new Player({
        x: spawn.x,
        y: spawn.y,
        name: sanitizeName(options.name, `Jugador ${this.state.players.size + 1}`),
        // Separa los tonos para que dos jugadores seguidos no se confundan.
        hue: (this.state.players.size * 67) % 360,
        facing: DEFAULT_FACING,
      }),
    );

    const token = playerIdFromToken(options.token);
    if (token) {
      this.tokens.set(client.sessionId, token);
      this.duenos.set(client.sessionId, currentStash()?.resolve(token) ?? token);
    }
    client.send(ITEMS_MESSAGE, ITEMS_PAYLOAD);
    client.send(SHOP_MESSAGE, { stock: STOCK } satisfies ShopMessage);
    this.sendStash(client);
    this.sendVision(client);
  }

  override onLeave(client: Client): void {
    this.cancelOffer(client.sessionId, 'Quien la hizo se fue del lobby.');
    // Las ofertas que le hicieron a quien se va tampoco tienen a quién llegar.
    for (const oferta of [...this.ofertas.values()]) {
      if (oferta.to === client.sessionId) this.cancelOffer(oferta.from, 'Se fue a quien se la hiciste.');
    }
    this.state.players.delete(client.sessionId);
    this.rutas.delete(client.sessionId);
    this.duenos.delete(client.sessionId);
    this.tokens.delete(client.sessionId);
    this.intentos.delete(client.sessionId);
  }

  /** Aplica un paso si es válido. Devuelve si se movió, para los tests. */
  tryMove(sessionId: string, message: MoveMessage | undefined): boolean {
    const player = this.state.players.get(sessionId);
    if (!player || !message) return false;

    const { dx, dy } = message;
    if (!isSingleStep(dx, dy)) return false;

    // Girar es gratis aunque el paso no se pueda dar: alguien que empuja
    // contra una pared igual queda mirando para ese lado.
    const facing = facingFromStep(dx, dy);
    if (facing !== null) player.facing = facing;

    const x = player.x + dx;
    const y = player.y + dy;
    // Fuera del mapa y pared son lo mismo: `isBlocked` cubre los dos.
    if (isBlocked(this.map, x, y)) return false;
    if (this.isOccupied(x, y)) return false;

    player.x = x;
    player.y = y;
    return true;
  }

  /** Qué ve un jugador, o `null` si no está en la sala. */
  visionFor(sessionId: string): string | null {
    const player = this.state.players.get(sessionId);
    if (!player) return null;
    return visibleMask(this.map, player.x, player.y, SIGHT_RADIUS);
  }

  /** Le manda a un cliente su propia máscara de visión. */
  private sendVision(client: Client): void {
    const cells = this.visionFor(client.sessionId);
    if (cells) client.send(VISION_MESSAGE, { width: this.map.width, cells } satisfies VisionMessage);
  }

  isOccupied(x: number, y: number): boolean {
    for (const [, player] of this.state.players) {
      if (player.x === x && player.y === y) return true;
    }
    return false;
  }

  /**
   * Primera celda libre de alguna sala. Se recorren las salas en orden en vez
   * de buscar desde el centro del mapa: con pasillos, el centro suele ser roca.
   */
  private findFreeCell(): { x: number; y: number } | null {
    for (const room of this.map.rooms) {
      for (let y = room.y; y < room.y + room.height; y++) {
        for (let x = room.x; x < room.x + room.width; x++) {
          if (!isBlocked(this.map, x, y) && !this.isOccupied(x, y)) return { x, y };
        }
      }
    }
    // Las salas llenas no deberían pasar con el tope de jugadores, pero un
    // pasillo siempre es mejor que no dejar entrar a nadie.
    for (const { x, y } of floorCells(this.map)) {
      if (!this.isOccupied(x, y)) return { x, y };
    }
    return null;
  }
}
