/**
 * Vault: el combate por turnos del punto 5 del GDD.
 *
 * Junta las dos piezas que estaban sueltas. `turns.ts` pone la barrera de
 * ronda —nadie pasa a la N+1 hasta que todos cerraron la N— y `contact.ts`
 * resuelve el 5.1: fuera de contacto cada party juega cuando quiere, y las
 * que se detectan por línea de visión comparten un orden de Iniciativa.
 *
 * Como en el lobby, el cliente no mueve a nadie: pide un paso y el servidor
 * decide. Acá además decide si siquiera le toca.
 */
import { Client, Room } from '@colyseus/core';
import { currentStash, playerFor, playerIdFromToken } from '../stash';
import { ALERTA_RADIO, ENEMY_PARTY, coverStep, esEnemigo, nextStep, placeEnemies } from './ai';
import { HP_MAX, canShoot, hitChance, resolveShot } from './combat';
import {
  CARGA_MAXIMA,
  ITEMS_PAYLOAD,
  STARTING_WEAPON,
  armorReduction,
  fits,
  isStashable,
  itemById,
  valueOf,
  weightOf,
  type WeaponStats,
} from './items';
import { whoCanAct, type Combatant as Luchador } from './contact';
import { DEFAULT_FACING, facingFromStep } from './direction';
import {
  STAIRS_DOWN,
  STAIRS_UP,
  WALL,
  floorCells,
  generateDungeon,
  isBlocked,
  randomSeed,
  type Cell,
  type DungeonFloor,
} from './map';
import { exitAt, placeCaches, type Cache } from './loot';
import { endTurn, join, leave, remainingMs, startInstance, tick, type TurnState } from './turns';
import {
  ArraySchema,
  Combatant,
  ExitPoint,
  LootCache,
  MapSchema,
  PRIVADO,
  StateView,
  VaultState,
  type CombatantType,
  type VaultStateType,
} from './vaultState';
import { SIGHT_RADIUS, canSee, isVisible, visibleMask } from './vision';

type VaultRoomOptions = { state: VaultStateType };

export const VAULT_WIDTH = 40;
export const VAULT_HEIGHT = 30;
export const MAX_CLIENTS = 16;

/** Mazmorra con más salas que el lobby: hace falta sitio para perderse. */
const MAP_OPTIONS = { rooms: 7, minRoom: 4, maxRoom: 8 };

/**
 * Pisos de la mazmorra. Con tres ya hay un piso del medio, que es el único
 * que tiene las dos escaleras y donde se cruza gente que sube con gente que
 * baja.
 */
export const VAULT_FLOORS = 3;

/**
 * Pasos por turno. Con menos, cruzar una sala lleva rondas enteras; con más,
 * el que tiene la Iniciativa se va de rango antes de que el otro reaccione.
 */
export const AP_POR_TURNO = 6;

/** Cuánto dura un turno antes de cerrarse solo, como pide el punto 5.2. */
export const TURNO_MS = 30_000;

/** Cada cuánto se revisan los relojes y se republica lo que queda. */
const TICK_MS = 500;

/** Las parties que reparte la sala de prueba. */
export const PARTIES = ['Acero', 'Yermo'];

const MAX_NAME_LENGTH = 16;

/**
 * Lo que cuesta abrir un contenedor. Más que un paso: saquear en medio de un
 * pasillo a la vista tiene que ser una decisión, no algo que sale gratis.
 */
export const AP_SAQUEO = 2;

/** Mensaje con el que se avisa a alguien que salió de la instancia. */
export const EXTRACTED_MESSAGE = 'extracted';

/**
 * Mensaje con el catálogo de objetos, que se manda al entrar. El cliente no
 * tiene uno propio: lo que existe lo decide el servidor.
 */
export const ITEMS_MESSAGE = 'items';

/**
 * Mensaje con el motivo de algo que no se hizo, cuando no se ve a simple
 * vista: sin munición o sin lugar, el jugador apretaría y no pasaría nada.
 */
export const NOTICE_MESSAGE = 'notice';

export interface NoticeMessage {
  text: string;
}

/** Cuesta cambiar de arma o de armadura. Poco, pero no es gratis en combate. */
export const AP_EQUIPAR = 1;
/** Cuesta usar un consumible. */
export const AP_USAR = 2;
/** Cuesta soltar algo. Lo mismo que equipar: es sacarse algo de encima. */
export const AP_SOLTAR = 1;

export interface ItemMessage {
  /** Id del catálogo de un objeto que se lleva encima. */
  item: string;
}

export interface ExtractedMessage {
  /** El valor de lo que se llevó. */
  loot: number;
  /** Lo que se llevó, como ids del catálogo. */
  items: string[];
  /** Si quedó guardado en el alijo. Sin token o sin alijo en el servidor, no. */
  saved: boolean;
}

/** Mensaje con el resultado de un disparo, para el que tira y el que recibe. */
export const SHOT_MESSAGE = 'shot';

export interface ShotMessage {
  /** Sesión de quien disparó. */
  from: string;
  /** Sesión del blanco. */
  to: string;
  /** Nombres, porque el que muere ya no está en el estado para buscarlo. */
  fromName: string;
  toName: string;
  hit: boolean;
  damage: number;
  /** Con qué probabilidad se tiró, en por ciento. */
  chance: number;
  killed: boolean;
}

/** Mensaje para el que muere, antes de sacarlo de la sala. */
export const DIED_MESSAGE = 'died';

export interface DiedMessage {
  /** El botín que perdió. Quedó en el piso, donde cayó. */
  loot: number;
  /** Quién lo mató. */
  by: string;
}

export interface AttackMessage {
  /** Sesión del blanco. */
  target: string;
}

/** Quién salió y con cuánto. Lo va a leer el alijo, cuando exista. */
export interface Extraction {
  name: string;
  party: string;
  loot: number;
  /** Lo que llevaba, como ids del catálogo. */
  items: string[];
}

/** Mismo mensaje y mismo formato que el lobby; ver `LobbyRoom`. */
export const VISION_MESSAGE = 'vision';

export interface VisionMessage {
  width: number;
  cells: string;
  /**
   * De qué piso es la máscara. Sin esto el cliente no podría separar lo
   * explorado de cada piso: todos tienen el mismo ancho.
   */
  floor: number;
  /**
   * Lo que se sabe del mapa de ese piso: lo explorado, tal cual, y todo lo
   * demás como roca. Es lo único del mapa que llega al cliente.
   */
  map: string;
}

/** Cómo llega lo que todavía no se exploró: roca, que no se dibuja. */
const DESCONOCIDO = WALL;

export interface MoveMessage {
  dx: number;
  dy: number;
}

export interface JoinOptions {
  name?: unknown;
  party?: unknown;
  /** Token del jugador, que lo identifica para su alijo. */
  token?: unknown;
  /** Qué sacar del alijo para llevar, como ids del catálogo. */
  loadout?: unknown;
}

/**
 * Cuántos objetos se pueden pedir para entrar, como mucho. Es alto porque
 * cada bala cuenta como uno; el límite que importa es el peso.
 */
const EQUIPO_MAXIMO = 600;

/**
 * La lista de equipo que pide el cliente, saneada: solo ids del catálogo que
 * se pueden guardar, y no más de `EQUIPO_MAXIMO`. Lo que no se entienda se
 * descarta.
 */
export function sanitizeLoadout(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && isStashable(id)).slice(0, EQUIPO_MAXIMO);
}

function isSingleStep(dx: number, dy: number): boolean {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  if (dx === 0 && dy === 0) return false;
  return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const clean = Array.from(raw)
    .filter((c) => c.codePointAt(0)! >= 0x20)
    .join('')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return clean.length > 0 ? clean : fallback;
}

/** La party la propone el cliente, así que solo se aceptan las que existen. */
export function sanitizeParty(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && PARTIES.includes(raw) ? raw : fallback;
}

export class VaultRoom extends Room<VaultRoomOptions> {
  maxClients = MAX_CLIENTS;

  floors: DungeonFloor[] = generateDungeon(VAULT_WIDTH, VAULT_HEIGHT, 1, VAULT_FLOORS, MAP_OPTIONS);

  /**
   * El reloj de rondas. Es `null` hasta que entra el primero: una instancia
   * sin nadie no tiene ronda en curso y `startInstance` lo rechaza.
   */
  turns: TurnState | null = null;

  /** Semilla de las tiradas, para que una sala con semilla fija sea repetible. */
  private siguienteTirada = 0;

  /** Semilla de la instancia: de ella salen el mapa, el botín y las salidas. */
  private seed = 1;

  /**
   * Los contenedores con su valor, en el mismo orden que `state.caches`. El
   * valor vive solo acá; ver `LootCache`.
   */
  caches: Cache[] = [];

  /**
   * Quiénes salieron con vida y con cuánto. Todavía no va a ningún lado: el
   * alijo del lobby no existe. Queda acá para que exista algo que leer.
   */
  extracted: Extraction[] = [];

  /**
   * Jugadores que murieron y cuánto dejaron. Lo mismo: para cuando exista el
   * alijo. Los enemigos no van acá, no tienen alijo.
   */
  fallen: Extraction[] = [];

  /** Cuánto botín perdió cada muerto, para avisarle antes de sacarlo. */
  private botinPerdido = new Map<string, number>();

  /**
   * Dónde vio cada enemigo a alguien por última vez. Es adonde va cuando lo
   * pierde de vista; al llegar sin encontrar a nadie, se olvida.
   */
  private rastro = new Map<string, Cell>();

  /**
   * El hash del token de cada sesión, para devolverle lo que extraiga. Se
   * guarda el token y no el jugador: si mientras tanto entró a su cuenta
   * desde el lobby, lo extraído tiene que ir a la cuenta.
   */
  private duenos = new Map<string, string>();

  /**
   * Lo último que vio cada jugador: de qué piso y qué celdas. Se calcula al
   * moverse, que es lo único que lo cambia, y con eso se decide a quién le
   * llega cada combatiente, contenedor y salida.
   */
  private mascaras = new Map<string, { floor: number; mask: string }>();

  /** Qué celdas exploró cada jugador, un arreglo por piso. */
  private explorado = new Map<string, Uint8Array[]>();

  /** Para no volver a entrar a los turnos de la IA desde adentro de ellos. */
  private jugandoIA = false;

  /**
   * `enemies: false` deja la mazmorra vacía. Es para los tests de reglas que
   * no son de la IA: con enemigos, cualquier prueba de turnos depende de
   * quién vea a quién desde la otra punta del mapa.
   */
  override onCreate(options: { seed?: number; enemies?: boolean } = {}): void {
    const seed = options.seed ?? randomSeed();
    this.floors = generateDungeon(VAULT_WIDTH, VAULT_HEIGHT, seed, VAULT_FLOORS, MAP_OPTIONS);
    this.siguienteTirada = seed;
    this.seed = seed;
    this.caches = placeCaches(this.floors, seed);

    this.state = new VaultState({
      width: VAULT_WIDTH,
      height: VAULT_HEIGHT,
      floorCount: this.floors.length,
      tileSeed: seed,
      round: 0,
      remainingMs: 0,
      players: new MapSchema(),
      caches: new ArraySchema(
        ...this.caches.map(({ floor, x, y }) => new LootCache({ floor, x, y, looted: false })),
      ),
      exits: [],
    });

    if (options.enemies !== false) {
      for (const e of placeEnemies(this.floors, seed)) {
        this.state.players.set(
          e.id,
          new Combatant({
            x: e.x,
            y: e.y,
            floor: e.floor,
            name: 'Saqueador',
            hue: 0,
            facing: DEFAULT_FACING,
            party: ENEMY_PARTY,
            initiative: this.tirar(20),
            ap: AP_POR_TURNO,
            done: false,
            active: false,
            loot: valueOf(e.items),
            items: e.items,
            weapon: e.weapon,
            armor: e.armor,
            hp: e.hp,
            maxHp: e.hp,
          }),
        );
      }
    }

    this.onMessage('move', (client, message: MoveMessage) => {
      if (this.tryMove(client.sessionId, message)) {
        const salida = this.extractIfOnExit(client.sessionId);
        if (salida !== null) {
          client.send(EXTRACTED_MESSAGE, salida satisfies ExtractedMessage);
          client.leave();
        } else {
          this.sendVision(client);
        }
      }
      this.publish();
    });

    this.onMessage('attack', (client, message: AttackMessage) => {
      const target = typeof message?.target === 'string' ? message.target : '';
      const resultado = this.tryAttack(client.sessionId, target);
      if (resultado) this.announceShot(resultado);
      this.publish();
    });

    this.onMessage('equip', (client, message: ItemMessage) => {
      this.tryEquip(client.sessionId, typeof message?.item === 'string' ? message.item : '');
      this.publish();
    });

    this.onMessage('use', (client, message: ItemMessage) => {
      this.tryUse(client.sessionId, typeof message?.item === 'string' ? message.item : '');
      this.publish();
    });

    this.onMessage('loot', (client) => {
      this.tryLoot(client.sessionId);
      this.publish();
    });

    this.onMessage('drop', (client, message: ItemMessage) => {
      this.tryDrop(client.sessionId, typeof message?.item === 'string' ? message.item : '');
      this.publish();
    });

    this.onMessage('endTurn', (client) => {
      this.endTurn(client.sessionId);
      this.publish();
    });

    this.onMessage(VISION_MESSAGE, (client) => this.sendVision(client));
    // Se manda al entrar, pero como con la visión, el cliente puede no estar
    // escuchando todavía; puede pedirlo.
    this.onMessage(ITEMS_MESSAGE, (client) => client.send(ITEMS_MESSAGE, ITEMS_PAYLOAD));

    this.setSimulationInterval(() => {
      if (!this.turns) return;
      this.turns = tick(this.turns, Date.now());
      this.publish();
    }, TICK_MS);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    // Todos entran por arriba: bajar es lo que se juega.
    const spawn = this.findFreeCell(0);
    if (!spawn) throw new Error('No hay celdas libres en la Vault');

    // El equipo sale del alijo al entrar, y desde ese momento está en juego:
    // si muere o se va, no vuelve. Se saca después de tener lugar, para no
    // quitarle nada a quien después no puede entrar.
    const player = playerFor(options.token);
    const loadout = sanitizeLoadout(options.loadout);
    // Se mide antes de tocar el alijo, con la pistola prestada incluida, que
    // también pesa: entrar con más de lo que se puede cargar no tiene arreglo.
    const conArma = loadout.some((id) => itemById(id)?.kind === 'weapon') ? loadout : [...loadout, STARTING_WEAPON];
    const peso = weightOf(conArma);
    if (peso > CARGA_MAXIMA) throw new Error(`Eso pesa ${peso} kg y se puede cargar hasta ${CARGA_MAXIMA}`);
    if (loadout.length > 0) {
      const stash = currentStash();
      if (!player || !stash) throw new Error('Para entrar con equipo hace falta un alijo');
      if (!stash.take(player, loadout)) throw new Error('No tenés todo eso en el alijo');
    }
    const token = playerIdFromToken(options.token);
    if (token) this.duenos.set(client.sessionId, token);
    // Sin un arma propia se entra con la pistola de emergencia: sin arma no
    // hay forma de jugar.
    const arma = loadout.find((id) => itemById(id)?.kind === 'weapon');
    const items = arma ? loadout : [...loadout, STARTING_WEAPON];
    const armadura = loadout.find((id) => itemById(id)?.kind === 'armor') ?? '';

    const n = this.humanos().length;
    this.state.players.set(
      client.sessionId,
      new Combatant({
        x: spawn.x,
        y: spawn.y,
        floor: 0,
        name: sanitizeName(options.name, `Jugador ${n + 1}`),
        hue: (n * 67) % 360,
        facing: DEFAULT_FACING,
        // Sin party pedida se reparten alternadas: una sala de prueba con
        // todos en el mismo bando nunca llegaría a mostrar la Iniciativa.
        party: sanitizeParty(options.party, PARTIES[n % PARTIES.length]),
        initiative: this.tirar(20),
        ap: AP_POR_TURNO,
        done: false,
        active: false,
        loot: valueOf(items),
        items,
        weapon: arma ?? STARTING_WEAPON,
        armor: armadura,
        hp: HP_MAX,
        maxHp: HP_MAX,
      }),
    );

    // Cada uno se ve a sí mismo, con mochila; a los demás, solo mientras los
    // tenga a la vista y sin mochila. Ver `actualizarVistas`.
    client.view = new StateView();
    const propio = this.state.players.get(client.sessionId)!;
    client.view.add(propio);
    client.view.add(propio, PRIVADO);

    const now = Date.now();
    this.turns = this.turns
      ? join(this.turns, client.sessionId, now)
      : // Los enemigos entran al reloj con el primero: sin jugadores no
        // hay ronda, y sin ronda la IA no tiene cuándo jugar.
        startInstance([...this.enemigos(), client.sessionId], TURNO_MS, now);

    client.send(ITEMS_MESSAGE, ITEMS_PAYLOAD);
    this.publish();
    this.sendVision(client);
  }

  override onLeave(client: Client): void {
    // Irse sin extraer pierde todo, como pide el punto 4: lo que llevaba ya
    // había salido del alijo.
    this.duenos.delete(client.sessionId);
    this.mascaras.delete(client.sessionId);
    this.explorado.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    if (this.turns) this.turns = leave(this.turns, client.sessionId, Date.now());
    // Si no se suelta, el id de la vista puede reusarse con lo que veía.
    client.view?.dispose();
    this.publish();
  }

  /**
   * Una tirada de 1 a `caras`: la Iniciativa, el impacto, el daño.
   *
   * Sale de la semilla de la sala y no de `Math.random` para que una sala
   * creada con semilla fija se comporte igual dos veces, que es lo que
   * permite testear el orden de turnos y los disparos.
   */
  private tirar(caras: number): number {
    // xorshift32, el mismo que usa la generación del mapa.
    let x = this.siguienteTirada >>> 0 || 1;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    this.siguienteTirada = x;
    return (x % caras) + 1;
  }

  /**
   * Dispara a otro, si le toca, le alcanza la acción y lo tiene a tiro.
   *
   * El fuego amigo vale, como pide el punto 3: el blanco puede ser de la
   * misma party. Devuelve el resultado, o `null` si el disparo no se hizo.
   */
  tryAttack(sessionId: string, targetId: string): ShotMessage | null {
    const tirador = this.state.players.get(sessionId);
    const blanco = this.state.players.get(targetId);
    if (!tirador || !blanco || sessionId === targetId) return null;
    if (!this.activos().has(sessionId)) return null;
    const arma = this.armaDe(tirador);
    if (!arma) {
      this.avisar(sessionId, 'No tenés un arma en la mano.');
      return null;
    }
    if (tirador.ap < arma.ap) return null;
    if (arma.ammo && !tirador.items.includes(arma.ammo)) {
      this.avisar(sessionId, `Sin munición: hace falta ${itemById(arma.ammo)?.name ?? arma.ammo}.`);
      return null;
    }
    if (!canShoot(this.mapOf(tirador.floor), tirador, blanco, arma.range)) return null;

    const facing = facingFromStep(Math.sign(blanco.x - tirador.x), Math.sign(blanco.y - tirador.y));
    if (facing !== null) tirador.facing = facing;

    const chance = hitChance(tirador, blanco, arma.accuracy);
    const dano = arma.damageMin + this.tirar(arma.damageMax - arma.damageMin + 1) - 1;
    const { hit, damage } = resolveShot(chance, this.tirar(100), dano, armorReduction(blanco.armor));
    tirador.ap -= arma.ap;
    // Cada disparo gasta una, pegue o no.
    if (arma.ammo) this.quitar(tirador, arma.ammo);

    const resultado: ShotMessage = {
      from: sessionId,
      to: targetId,
      fromName: tirador.name,
      toName: blanco.name,
      hit,
      damage,
      chance,
      killed: false,
    };
    blanco.hp = Math.max(0, blanco.hp - damage);
    if (blanco.hp === 0) {
      this.kill(targetId);
      resultado.killed = true;
    }
    if (this.state.players.has(sessionId) && tirador.ap === 0) this.endTurn(sessionId);
    return resultado;
  }

  /**
   * Saca a alguien de la instancia sin su botín, como pide el punto 4.
   *
   * Lo que llevaba no desaparece: queda en el piso como un contenedor más, y
   * quien lo mató, o cualquiera que pase, se lo puede llevar. Es lo que hace
   * que matar a alguien cargado valga la pena.
   */
  private kill(sessionId: string): void {
    const muerto = this.state.players.get(sessionId);
    if (!muerto) return;
    const { name, party, loot, floor, x, y } = muerto;
    // Lo prestado no queda en el piso: no es de nadie, y si se pudiera
    // juntar, matar a quien entra sin nada daría armas gratis.
    const items = [...muerto.items].filter(isStashable);
    if (!esEnemigo(sessionId)) this.fallen.push({ name, party, loot, items });
    this.botinPerdido.set(sessionId, loot);
    this.rastro.delete(sessionId);
    this.dejarEnElPiso(floor, x, y, items);
    this.state.players.delete(sessionId);
    if (this.turns) this.turns = leave(this.turns, sessionId, Date.now());
  }

  /**
   * El arma con la que alguien puede disparar: la equipada, si la sigue
   * llevando. `null` si no tiene ninguna, por ejemplo porque la soltó.
   */
  armaDe(combatant: CombatantType): WeaponStats | null {
    const item = itemById(combatant.weapon);
    if (item?.kind !== 'weapon' || !combatant.items.includes(item.id)) return null;
    return item.weapon;
  }

  /** Le cuenta a alguien por qué no pasó lo que pidió. A la IA, a nadie. */
  private avisar(sessionId: string, text: string): void {
    this.clients.getById(sessionId)?.send(NOTICE_MESSAGE, { text } satisfies NoticeMessage);
  }

  /** Le saca a alguien una unidad de un objeto, la última que juntó. */
  private quitar(combatant: CombatantType, id: string): void {
    const i = combatant.items.lastIndexOf(id);
    if (i < 0) return;
    combatant.items.splice(i, 1);
    combatant.loot = valueOf(combatant.items);
  }

  /** El mapa de un piso. */
  mapOf(floor: number): DungeonFloor {
    return this.floors[floor];
  }

  /** Los combatientes de un piso, en la forma que entiende `contact.ts`. */
  private luchadores(floor: number): Luchador[] {
    const out: Luchador[] = [];
    for (const [id, c] of this.state.players) {
      if (c.floor !== floor) continue;
      out.push({ id, party: c.party, x: c.x, y: c.y, initiative: c.initiative });
    }
    return out;
  }

  /**
   * Quiénes pueden actuar en este instante.
   *
   * El contacto se resuelve piso por piso: la línea de visión no atraviesa
   * el techo, así que dos parties en pisos distintos nunca se detectan y
   * cada una sigue jugando en paralelo aunque estén una encima de la otra.
   */
  activos(): Set<string> {
    if (!this.turns) return new Set();
    const pendientes = new Set(this.turns.pending);
    const puede = new Set<string>();
    for (let floor = 0; floor < this.floors.length; floor++) {
      for (const id of whoCanAct(this.mapOf(floor), this.luchadores(floor), pendientes)) puede.add(id);
    }
    return puede;
  }

  /**
   * Vuelca el reloj y la Iniciativa al estado.
   *
   * Se llama después de cada cambio en vez de que cada rama lo haga por su
   * cuenta: un turno que pasa cambia quién puede actuar, y olvidarse en una
   * sola rama dejaría a alguien sin poder jugar y sin ninguna señal de por qué.
   */
  publish(): void {
    if (!this.turns) {
      this.state.round = 0;
      this.state.remainingMs = 0;
      return;
    }

    // La IA juega después de reponer la acción de la ronda, no antes: si no,
    // arrancaría cada ronda con lo que le sobró de la anterior. Y si al
    // cerrar ella se abre otra ronda, se repone y vuelve a jugar.
    this.syncRound();
    for (let vuelta = 0; vuelta < 10 && this.runAI(); vuelta++) this.syncRound();

    const pendientes = new Set(this.turns.pending);
    const activos = this.activos();
    for (const [id, c] of this.state.players) {
      c.done = !pendientes.has(id);
      c.active = activos.has(id);
    }

    // Todos los relojes de una ronda arrancan juntos, así que el mayor es el
    // de la ronda. Se publica uno solo: uno por jugador sería el mismo número
    // repetido y multiplicaría los parches.
    const now = Date.now();
    const quedan = [...this.state.players.keys()].map((id) => remainingMs(this.turns!, id, now));
    this.state.remainingMs = quedan.length > 0 ? Math.max(...quedan) : 0;
    this.actualizarVistas();
  }

  /**
   * Decide qué le llega a cada cliente: los combatientes que está viendo, los
   * contenedores que vio alguna vez y dónde está la salida si la vio.
   *
   * Corre en cada publicación porque lo que cambia no es solo lo propio: si
   * otro camina hasta quedar a la vista, el que mira no se movió.
   */
  private actualizarVistas(): void {
    for (const client of this.clients) {
      const view = client.view;
      const mirada = this.mascaras.get(client.sessionId);
      if (!view || !mirada) continue;
      const seVe = (floor: number, x: number, y: number) =>
        floor === mirada.floor && isVisible(mirada.mask, VAULT_WIDTH, x, y);

      for (const [id, c] of this.state.players) {
        if (id === client.sessionId) continue;
        const debe = seVe(c.floor, c.x, c.y);
        if (debe && !view.has(c)) view.add(c);
        else if (!debe && view.has(c)) view.remove(c);
      }
      for (const cache of this.state.caches) {
        if (!view.has(cache) && seVe(cache.floor, cache.x, cache.y)) view.add(cache);
      }
      for (const exit of this.state.exits) {
        if (!view.has(exit) && seVe(exit.floor, exit.x, exit.y)) view.add(exit);
      }
    }
  }

  /** Si empezó una ronda: se la publica y a todos se les repone la acción. */
  private syncRound(): void {
    if (!this.turns || this.state.round === this.turns.round) return;
    this.state.round = this.turns.round;
    for (const [, c] of this.state.players) c.ap = AP_POR_TURNO;
    this.publishExits();
  }

  /** Las sesiones de los jugadores, sin los enemigos. */
  humanos(): string[] {
    return [...this.state.players.keys()].filter((id) => !esEnemigo(id));
  }

  /** Los enemigos que siguen vivos. */
  enemigos(): string[] {
    return [...this.state.players.keys()].filter(esEnemigo);
  }

  /**
   * Avisa un disparo a los que estuvieron en él y, si alguien murió, se lo
   * dice y lo saca. Los enemigos no tienen conexión: con ellos no hay a
   * quién avisar.
   */
  private announceShot(resultado: ShotMessage): void {
    for (const id of new Set([resultado.from, resultado.to])) {
      this.clients.getById(id)?.send(SHOT_MESSAGE, resultado);
    }
    if (!resultado.killed) return;
    const muerto = this.clients.getById(resultado.to);
    const loot = this.botinPerdido.get(resultado.to) ?? 0;
    muerto?.send(DIED_MESSAGE, { loot, by: resultado.fromName } satisfies DiedMessage);
    muerto?.leave();
  }

  /**
   * Juega los turnos de los enemigos a los que les toca.
   *
   * Se llama al publicar, que es por donde pasa todo cambio: una ronda nueva,
   * un turno que se cierra, alguien que entra o se va. Cada enemigo juega y
   * cierra; si al cerrar le toca a otro enemigo, se sigue. Termina porque
   * cerrar saca de los pendientes, y cada uno juega una vez por ronda.
   * Devuelve si alguno jugó.
   */
  runAI(): boolean {
    // Sin jugadores no se juega: la IA sola cerraría ronda tras ronda.
    if (this.jugandoIA || !this.turns || this.humanos().length === 0) return false;
    this.jugandoIA = true;
    let jugo = false;
    try {
      const ronda = this.turns.round;
      for (let vuelta = 0; vuelta < 1000; vuelta++) {
        // Si se abrió otra ronda, se corta: hay que reponer la acción antes
        // de seguir, y eso lo hace quien llamó.
        if (this.turns.round !== ronda) break;
        const activos = this.activos();
        const id = this.enemigos().find((e) => activos.has(e));
        if (!id) break;
        this.playEnemy(id);
        jugo = true;
        // Su último disparo o paso pudo haber cerrado el turno, y con él la
        // ronda. Cerrarlo de nuevo acá cerraría el de la ronda nueva, sin
        // haberlo jugado.
        if (this.turns.round === ronda && this.turns.pending.includes(id)) this.endTurn(id);
      }
    } finally {
      this.jugandoIA = false;
    }
    return jugo;
  }

  /**
   * El turno de un enemigo, acción por acción:
   *
   * 1. Si está herido y lleva con qué, se cura.
   * 2. Si ve a alguien, avisa a los que tiene cerca y anota dónde lo vio.
   * 3. Si lo tiene a tiro y le alcanza la acción, dispara.
   * 4. Si lo ve pero no le llega el arma, se acerca.
   * 5. Si lo ve y ya no puede disparar —sin acción para otro tiro o sin
   *    balas—, se cubre donde no lo vean con lo que le queda.
   * 6. Si no ve a nadie, va a donde lo vio por última vez, aunque sea una
   *    escalera: así se persigue a alguien entre pisos.
   */
  private playEnemy(id: string): void {
    for (let accion = 0; accion < AP_POR_TURNO * 2; accion++) {
      const yo = this.state.players.get(id);
      if (!yo || yo.ap <= 0) return;
      const map = this.mapOf(yo.floor);
      const ocupada = (x: number, y: number) => this.isOccupied(yo.floor, x, y);

      if (this.curarse(id, yo)) continue;

      const vistos = this.humanos()
        .map((h) => ({ h, c: this.state.players.get(h)! }))
        .filter(({ c }) => canShoot(map, yo, c, SIGHT_RADIUS))
        .sort((a, b) => Math.hypot(a.c.x - yo.x, a.c.y - yo.y) - Math.hypot(b.c.x - yo.x, b.c.y - yo.y));

      if (vistos.length > 0) {
        const cerca = vistos[0];
        this.rastro.set(id, { x: cerca.c.x, y: cerca.c.y });
        this.alertar(id, yo, cerca.c);

        const arma = this.armaDe(yo);
        const conBalas = arma !== null && (!arma.ammo || yo.items.includes(arma.ammo));
        if (arma && conBalas) {
          const aTiro = vistos.find(({ c }) => canShoot(map, yo, c, arma.range));
          if (aTiro && yo.ap >= arma.ap) {
            const resultado = this.tryAttack(id, aTiro.h);
            if (!resultado) return;
            this.announceShot(resultado);
            continue;
          }
          if (!aTiro) {
            // Lo ve pero no le llega: se acerca, que es la única forma de
            // que el turno que viene pueda disparar.
            const paso = nextStep(map, yo, cerca.c, ocupada);
            if (!paso || !this.tryMove(id, paso)) return;
            continue;
          }
        }

        // Ya no puede disparar este turno: lo que le queda va a cubrirse.
        const amenazas = vistos.map(({ c }) => ({ x: c.x, y: c.y }));
        const paso = coverStep(map, yo, amenazas, yo.ap, ocupada);
        if (!paso || !this.tryMove(id, paso)) return;
        continue;
      }

      const destino = this.rastro.get(id);
      if (!destino) return;
      const piso = yo.floor;
      const paso = nextStep(map, yo, destino, ocupada);
      if (!paso || !this.tryMove(id, paso)) {
        this.rastro.delete(id);
        return;
      }
      // Si la escalera lo llevó a otro piso, lo que anotó era del de antes.
      if (yo.floor !== piso || (yo.x === destino.x && yo.y === destino.y)) this.rastro.delete(id);
    }
  }

  /**
   * Si un enemigo herido lleva con qué curarse, lo usa. Se cura recién por
   * debajo de la mitad: antes, gastar un turno en eso es peor que disparar.
   */
  private curarse(id: string, yo: CombatantType): boolean {
    if (yo.hp > yo.maxHp / 2 || yo.ap < AP_USAR) return false;
    const cura = yo.items.find((item) => itemById(item)?.kind === 'consumable');
    return cura !== undefined && this.tryUse(id, cura);
  }

  /**
   * Un enemigo que ve a alguien les avisa a los de su piso que tiene cerca.
   * Los que no tenían a quién buscar van a donde está; los que ya seguían a
   * alguien siguen con lo suyo.
   */
  private alertar(id: string, yo: CombatantType, visto: Cell): void {
    for (const otro of this.enemigos()) {
      if (otro === id || this.rastro.has(otro)) continue;
      const c = this.state.players.get(otro)!;
      if (c.floor !== yo.floor || Math.hypot(c.x - yo.x, c.y - yo.y) > ALERTA_RADIO) continue;
      this.rastro.set(otro, { x: visto.x, y: visto.y });
    }
  }

  /**
   * Alguien se fue por una escalera: los enemigos de ese piso que la tenían a
   * la vista lo vieron irse, y van a buscarlo por ahí.
   */
  private verIrsePorLaEscalera(floor: number, escalera: Cell): void {
    const map = this.mapOf(floor);
    for (const id of this.enemigos()) {
      const e = this.state.players.get(id)!;
      if (e.floor !== floor) continue;
      if (Math.hypot(e.x - escalera.x, e.y - escalera.y) > SIGHT_RADIUS) continue;
      if (canSee(map, e.x, e.y, escalera.x, escalera.y)) this.rastro.set(id, { ...escalera });
    }
  }

  /** Vuelca al estado la salida de la ronda en curso, si hay una. */
  private publishExits(): void {
    const salida = exitAt(this.floors, this.seed, this.state.round);
    this.state.exits.clear();
    if (salida) {
      const { floor, x, y, closes } = salida;
      this.state.exits.push(new ExitPoint({ floor, x, y, closes }));
    }
  }

  /**
   * Abre el contenedor que tenga al alcance, si le toca y le alcanza la
   * acción. Al alcance es la celda propia o una vecina, como un paso.
   */
  tryLoot(sessionId: string): boolean {
    const combatant = this.state.players.get(sessionId);
    if (!combatant) return false;
    if (!this.activos().has(sessionId)) return false;
    if (combatant.ap < AP_SAQUEO) return false;

    const i = this.caches.findIndex(
      (c, n) =>
        !this.state.caches[n].looted &&
        c.floor === combatant.floor &&
        Math.max(Math.abs(c.x - combatant.x), Math.abs(c.y - combatant.y)) <= 1,
    );
    if (i < 0) return false;

    // Se lleva lo que le entra, en el orden en que está, y lo demás queda.
    // Partir un montón de balas está bien: cada una es un objeto.
    const cache = this.caches[i];
    const lleva: string[] = [];
    const queda: string[] = [];
    for (const id of cache.items) {
      if (fits([...combatant.items, ...lleva], [id])) lleva.push(id);
      else queda.push(id);
    }
    if (lleva.length === 0) {
      this.avisar(sessionId, `No te entra nada más: llevás ${weightOf(combatant.items)} de ${CARGA_MAXIMA} kg.`);
      return false;
    }
    cache.items = queda;
    this.state.caches[i].looted = queda.length === 0;
    if (queda.length > 0) this.avisar(sessionId, 'No te entró todo: el resto quedó en el contenedor.');
    this.give(combatant, lleva);
    combatant.ap -= AP_SAQUEO;
    if (combatant.ap === 0) this.endTurn(sessionId);
    return true;
  }

  /**
   * Si está parado sobre una salida abierta, lo saca de la instancia.
   *
   * Devuelve con cuánto salió, o `null` si no estaba en una salida. Se lo
   * borra del estado y del reloj en el acto y no al cortarse la conexión:
   * mientras tanto podría seguir moviendo, y el que salió ya no está.
   */
  extractIfOnExit(sessionId: string): ExtractedMessage | null {
    const combatant = this.state.players.get(sessionId);
    if (!combatant) return null;
    const enSalida = this.state.exits.some(
      (e) => e.floor === combatant.floor && e.x === combatant.x && e.y === combatant.y,
    );
    if (!enSalida) return null;

    const { name, party, loot } = combatant;
    // Lo prestado se devuelve al salir: guardarlo sería una canilla abierta.
    const items = [...combatant.items].filter(isStashable);
    this.extracted.push({ name, party, loot, items });
    this.state.players.delete(sessionId);
    if (this.turns) this.turns = leave(this.turns, sessionId, Date.now());
    // Lo que se llevó vuelve al alijo: es lo que hace que extraer valga.
    const token = this.duenos.get(sessionId);
    const stash = currentStash();
    const player = token && stash ? stash.resolve(token) : null;
    if (player && stash) stash.add(player, items);
    this.duenos.delete(sessionId);
    return { loot, items, saved: Boolean(player && stash) };
  }

  /** Le suma objetos a alguien y recalcula lo que vale lo que lleva. */
  private give(combatant: CombatantType, items: readonly string[]): void {
    for (const id of items) combatant.items.push(id);
    combatant.loot = valueOf(combatant.items);
  }

  /** Si alguien puede gastar acción ahora, y le alcanza. */
  private puedeGastar(sessionId: string, ap: number): CombatantType | null {
    const combatant = this.state.players.get(sessionId);
    if (!combatant || !this.activos().has(sessionId) || combatant.ap < ap) return null;
    return combatant;
  }

  /**
   * Equipa un arma o una armadura que lleva encima. Equipar la armadura que
   * ya tiene puesta se la saca, para poder volver a ir sin ella.
   */
  tryEquip(sessionId: string, itemId: string): boolean {
    const item = itemById(itemId);
    if (!item || (item.kind !== 'weapon' && item.kind !== 'armor')) return false;
    const combatant = this.puedeGastar(sessionId, AP_EQUIPAR);
    if (!combatant || !combatant.items.includes(itemId)) return false;

    if (item.kind === 'weapon') {
      if (combatant.weapon === itemId) return false;
      combatant.weapon = itemId;
    } else {
      combatant.armor = combatant.armor === itemId ? '' : itemId;
    }
    combatant.ap -= AP_EQUIPAR;
    if (combatant.ap === 0) this.endTurn(sessionId);
    return true;
  }

  /** Usa un consumible: lo gasta y aplica su efecto. */
  tryUse(sessionId: string, itemId: string): boolean {
    const item = itemById(itemId);
    if (!item || item.kind !== 'consumable') return false;
    const combatant = this.puedeGastar(sessionId, AP_USAR);
    if (!combatant) return false;
    const i = combatant.items.indexOf(itemId);
    if (i < 0) return false;
    // Curarse con la vida entera no sirve de nada, y gastaría el objeto.
    if (combatant.hp >= combatant.maxHp) return false;

    combatant.items.splice(i, 1);
    combatant.loot = valueOf(combatant.items);
    combatant.hp = Math.min(combatant.maxHp, combatant.hp + item.heal);
    combatant.ap -= AP_USAR;
    if (combatant.ap === 0) this.endTurn(sessionId);
    return true;
  }

  /**
   * Suelta algo en la celda propia, para hacer lugar. Un objeto suelto, o
   * toda la munición de ese tipo de una vez: soltar balas de a una sería
   * apretar cuarenta veces. Queda en un contenedor que cualquiera puede
   * saquear, también quien lo soltó.
   *
   * Lo prestado no se suelta: no es de quien lo lleva.
   */
  tryDrop(sessionId: string, itemId: string): boolean {
    const item = itemById(itemId);
    if (!item || item.noStash) return false;
    const combatant = this.puedeGastar(sessionId, AP_SOLTAR);
    if (!combatant || !combatant.items.includes(itemId)) return false;

    const cuantos = item.kind === 'ammo' ? combatant.items.filter((id) => id === itemId).length : 1;
    for (let n = 0; n < cuantos; n++) this.quitar(combatant, itemId);
    if (combatant.weapon === itemId && !combatant.items.includes(itemId)) combatant.weapon = '';
    if (combatant.armor === itemId && !combatant.items.includes(itemId)) combatant.armor = '';
    this.dejarEnElPiso(combatant.floor, combatant.x, combatant.y, Array<string>(cuantos).fill(itemId));

    combatant.ap -= AP_SOLTAR;
    if (combatant.ap === 0) this.endTurn(sessionId);
    return true;
  }

  /**
   * Deja objetos en una celda: en el contenedor que ya haya ahí, o en uno
   * nuevo. Dos contenedores en la misma celda no se podrían distinguir.
   */
  private dejarEnElPiso(floor: number, x: number, y: number, items: readonly string[]): void {
    if (items.length === 0) return;
    const i = this.caches.findIndex((c) => c.floor === floor && c.x === x && c.y === y);
    if (i >= 0) {
      this.caches[i].items.push(...items);
      this.state.caches[i].looted = false;
      return;
    }
    this.caches.push({ floor, x, y, items: [...items] });
    this.state.caches.push(new LootCache({ floor, x, y, looted: false }));
  }

  /** Cierra el turno de alguien, si es suyo para cerrar. */
  endTurn(sessionId: string): boolean {
    if (!this.turns) return false;
    if (!this.state.players.has(sessionId)) return false;
    const antes = this.turns;
    this.turns = endTurn(this.turns, sessionId, Date.now());
    return this.turns !== antes;
  }

  /** Aplica un paso si le toca, le queda acción y la celda está libre. */
  tryMove(sessionId: string, message: MoveMessage | undefined): boolean {
    const combatant = this.state.players.get(sessionId);
    if (!combatant || !message) return false;
    if (!this.activos().has(sessionId)) return false;
    if (combatant.ap <= 0) return false;

    const { dx, dy } = message;
    if (!isSingleStep(dx, dy)) return false;

    const facing = facingFromStep(dx, dy);
    if (facing !== null) combatant.facing = facing;

    const x = combatant.x + dx;
    const y = combatant.y + dy;
    if (isBlocked(this.mapOf(combatant.floor), x, y)) return false;
    if (this.isOccupied(combatant.floor, x, y)) return false;

    combatant.x = x;
    combatant.y = y;
    combatant.ap -= 1;
    this.takeStairs(combatant);
    // Sin acción no queda nada que hacer: el turno se cierra solo, para no
    // obligar a apretar un botón que no tiene alternativa.
    if (combatant.ap === 0) this.endTurn(sessionId);
    return true;
  }

  isOccupied(floor: number, x: number, y: number): boolean {
    for (const [, c] of this.state.players) {
      if (c.floor === floor && c.x === x && c.y === y) return true;
    }
    return false;
  }

  /**
   * Si quedó parado en una escalera, lo pasa al otro piso.
   *
   * El paso que lo llevó hasta la escalera ya costó su punto; cambiar de piso
   * no cuesta otro, para que bajar no sea más caro que caminar. Aparece sobre
   * la escalera de vuelta, y si alguien la está ocupando, en la celda libre
   * más cercana: dejarlo arriba sin avisar parecería que la escalera no anda.
   */
  private takeStairs(combatant: CombatantType): void {
    const map = this.mapOf(combatant.floor);
    const celda = map.cells[combatant.y * map.width + combatant.x];
    const destino =
      celda === STAIRS_DOWN ? combatant.floor + 1 : celda === STAIRS_UP ? combatant.floor - 1 : null;
    if (destino === null || destino < 0 || destino >= this.floors.length) return;

    const piso = this.mapOf(destino);
    const llegada = celda === STAIRS_DOWN ? piso.up : piso.down;
    if (!llegada) return;
    const libre = this.nearestFreeCell(destino, llegada);
    if (!libre) return;

    if (combatant.party !== ENEMY_PARTY) this.verIrsePorLaEscalera(combatant.floor, { x: combatant.x, y: combatant.y });
    combatant.floor = destino;
    combatant.x = libre.x;
    combatant.y = libre.y;
  }

  /**
   * La celda libre más cercana a otra, contando en pasos de ocho
   * direcciones, que es como se camina. Recorre anillos alrededor del punto,
   * así que la primera que encuentra es de las más cercanas.
   */
  nearestFreeCell(floor: number, desde: Cell): Cell | null {
    const map = this.mapOf(floor);
    const libre = (x: number, y: number) => !isBlocked(map, x, y) && !this.isOccupied(floor, x, y);
    const radioMax = Math.max(map.width, map.height);
    for (let r = 0; r <= radioMax; r++) {
      for (let y = desde.y - r; y <= desde.y + r; y++) {
        for (let x = desde.x - r; x <= desde.x + r; x++) {
          // Solo el borde del anillo: lo de adentro ya se miró.
          if (Math.max(Math.abs(x - desde.x), Math.abs(y - desde.y)) !== r) continue;
          if (libre(x, y)) return { x, y };
        }
      }
    }
    return null;
  }

  /** Qué ve un combatiente, o `null` si no está en la sala. */
  visionFor(sessionId: string): string | null {
    const c = this.state.players.get(sessionId);
    if (!c) return null;
    return visibleMask(this.mapOf(c.floor), c.x, c.y, SIGHT_RADIUS);
  }

  /**
   * Le manda a un cliente lo que ve y lo que sabe de su piso, y lo anota
   * para decidir qué más le llega del estado.
   */
  private sendVision(client: Client): void {
    const c = this.state.players.get(client.sessionId);
    const cells = this.visionFor(client.sessionId);
    if (!c || !cells) return;
    this.mascaras.set(client.sessionId, { floor: c.floor, mask: cells });
    const map = this.explorar(client.sessionId, c.floor, cells);
    client.send(VISION_MESSAGE, { width: VAULT_WIDTH, cells, floor: c.floor, map } satisfies VisionMessage);
  }

  /**
   * Suma a lo explorado lo que se ve ahora y devuelve el mapa del piso como
   * lo conoce ese jugador: lo explorado tal cual y el resto como roca.
   */
  knownMap(sessionId: string, floor: number): string {
    const visto = this.explorado.get(sessionId)?.[floor];
    const real = this.mapOf(floor).cells;
    if (!visto) return DESCONOCIDO.repeat(real.length);
    let out = '';
    for (let i = 0; i < real.length; i++) out += visto[i] ? real[i] : DESCONOCIDO;
    return out;
  }

  private explorar(sessionId: string, floor: number, mask: string): string {
    let pisos = this.explorado.get(sessionId);
    if (!pisos) {
      pisos = this.floors.map((f) => new Uint8Array(f.cells.length));
      this.explorado.set(sessionId, pisos);
    }
    const visto = pisos[floor];
    for (let i = 0; i < mask.length; i++) if (mask[i] === '1') visto[i] = 1;
    return this.knownMap(sessionId, floor);
  }

  /**
   * Primera celda libre, repartiendo a cada uno por una sala distinta: que dos
   * bandos aparezcan uno al lado del otro haría que el contacto fuera
   * inmediato y no se vería nunca el juego en paralelo.
   */
  private findFreeCell(floor: number): Cell | null {
    const map = this.mapOf(floor);
    const salas = map.rooms;
    const desde = this.humanos().length % Math.max(1, salas.length);
    for (let i = 0; i < salas.length; i++) {
      const room = salas[(desde + i) % salas.length];
      for (let y = room.y; y < room.y + room.height; y++) {
        for (let x = room.x; x < room.x + room.width; x++) {
          if (!isBlocked(map, x, y) && !this.isOccupied(floor, x, y)) return { x, y };
        }
      }
    }
    for (const { x, y } of floorCells(map)) {
      if (!this.isOccupied(floor, x, y)) return { x, y };
    }
    return null;
  }
}
