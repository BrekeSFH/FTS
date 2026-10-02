/**
 * Quién puede actuar en una ronda, según el punto 5.1 del GDD.
 *
 * La decisión fue la Opción B: mientras dos parties no se ven, juegan sus
 * turnos en paralelo; cuando se detectan, pasan a compartir un orden de
 * Iniciativa. Esto resuelve las dos mitades.
 *
 * El contacto es transitivo a propósito: si A ve a B y B ve a C, las tres
 * comparten orden aunque A y C no se vean. La alternativa —A y B por un lado,
 * B y C por otro— pondría a B en dos órdenes a la vez, que no tiene sentido.
 *
 * El módulo es puro: recibe el mapa y dónde está cada uno, y responde. Quien
 * lo use decide cuándo preguntar.
 */
import type { GameMap } from './map';
import { canSee } from './vision';

export interface Combatant {
  id: string;
  /** A qué party pertenece. Dos de la misma nunca están "en contacto". */
  party: string;
  x: number;
  y: number;
  /** Tirada al empezar la instancia. Más alta actúa antes. */
  initiative: number;
}

export interface ContactGroup {
  /** Las parties que se detectaron, en orden alfabético. */
  parties: string[];
  /** Quiénes la componen, en orden de Iniciativa. */
  order: string[];
}

/** Conjuntos disjuntos sobre los nombres de las parties. */
function createUnionFind() {
  const padre = new Map<string, string>();
  const find = (a: string): string => {
    if (!padre.has(a)) padre.set(a, a);
    let raiz = padre.get(a)!;
    while (raiz !== padre.get(raiz)!) raiz = padre.get(raiz)!;
    padre.set(a, raiz);
    return raiz;
  };
  return {
    find,
    union(a: string, b: string): void {
      const [ra, rb] = [find(a), find(b)];
      if (ra !== rb) padre.set(ra, rb);
    },
  };
}

/**
 * Orden de actuación: Iniciativa más alta primero. El desempate es por id
 * para que el orden sea estable: dos tiradas iguales no pueden dejar el turno
 * dependiendo de en qué orden entraron al mapa.
 */
function porIniciativa(a: Combatant, b: Combatant): number {
  return b.initiative - a.initiative || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Los grupos de parties que se detectaron entre sí.
 *
 * Una party que no ve a ninguna otra no forma grupo: no necesita compartir
 * orden con nadie, y por eso solo se devuelven los grupos de dos o más.
 */
export function contactGroups(map: GameMap, combatants: readonly Combatant[]): ContactGroup[] {
  const uf = createUnionFind();
  for (const c of combatants) uf.find(c.party);

  for (let i = 0; i < combatants.length; i++) {
    for (let j = i + 1; j < combatants.length; j++) {
      const a = combatants[i];
      const b = combatants[j];
      if (a.party === b.party) continue;
      if (canSee(map, a.x, a.y, b.x, b.y)) uf.union(a.party, b.party);
    }
  }

  const porRaiz = new Map<string, Combatant[]>();
  for (const c of combatants) {
    const raiz = uf.find(c.party);
    const lista = porRaiz.get(raiz);
    if (lista) lista.push(c);
    else porRaiz.set(raiz, [c]);
  }

  const grupos: ContactGroup[] = [];
  for (const miembros of porRaiz.values()) {
    const parties = [...new Set(miembros.map((c) => c.party))].sort();
    if (parties.length < 2) continue;
    grupos.push({ parties, order: [...miembros].sort(porIniciativa).map((c) => c.id) });
  }
  // Orden estable entre grupos, para que la salida no dependa del recorrido.
  return grupos.sort((a, b) => (a.parties[0] < b.parties[0] ? -1 : 1));
}

/**
 * Quiénes pueden actuar en este momento.
 *
 * Fuera de contacto se actúa libremente: la party juega su turno cuando
 * quiere, que es lo que hace que varias avancen en paralelo. Dentro de un
 * grupo en contacto solo actúa el primero de la Iniciativa que todavía no
 * haya cerrado su turno, y recién cuando ese cierra pasa el siguiente.
 */
export function whoCanAct(
  map: GameMap,
  combatants: readonly Combatant[],
  pending: ReadonlySet<string>,
): Set<string> {
  const enContacto = new Set<string>();
  const turno = new Set<string>();

  for (const grupo of contactGroups(map, combatants)) {
    for (const id of grupo.order) enContacto.add(id);
    const siguiente = grupo.order.find((id) => pending.has(id));
    if (siguiente) turno.add(siguiente);
  }

  const puede = new Set<string>();
  for (const c of combatants) {
    if (!pending.has(c.id)) continue;
    if (enContacto.has(c.id) ? turno.has(c.id) : true) puede.add(c.id);
  }
  return puede;
}
