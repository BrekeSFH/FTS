/**
 * El panel de comercio del lobby: cuenta, créditos, mercader e intercambios.
 *
 * Está partido en secciones que se rehacen por separado y solo cuando cambia
 * lo que muestran: hay campos de texto, y rehacerlos en cada parche del
 * estado les sacaría el foco a mitad de escribir.
 */
import type { CatalogItem } from './connection';
import {
  buildOffer,
  describeOffer,
  sellRows,
  shopRows,
  type StockEntry,
  type TradeOffer,
  type TradeRequest,
} from './market';
import type { StashContents } from './stash';

/** Lo que el panel puede pedirle al servidor. */
export interface MarketActions {
  buy(item: string): void;
  sell(items: Record<string, number>): void;
  offer(request: TradeRequest): void;
  answer(id: number, accept: boolean): void;
  register(name: string, password: string): void;
  login(name: string, password: string): void;
  logout(): void;
}

/** Lo que el panel necesita saber para dibujarse. */
export interface MarketData {
  catalogo: ReadonlyMap<string, CatalogItem>;
  stock: readonly StockEntry[];
  contents: StashContents;
  credits: number;
  account: string | null;
  /** Los demás que están en el lobby, para elegir con quién intercambiar. */
  others: ReadonlyArray<{ sessionId: string; name: string }>;
  /** La oferta que le hicieron, si hay una abierta. */
  incoming: TradeOffer | null;
}

export interface MarketView {
  update(data: MarketData): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const boton = (text: string, onClick: () => void, disabled = false): HTMLButtonElement => {
  const b = el('button', text);
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
};

const numero = (min: number, value: number, max?: number): HTMLInputElement => {
  const input = el('input');
  input.type = 'number';
  input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.value = String(value);
  return input;
};

/** Una sección que se rehace solo si cambió su clave. */
function seccion(padre: HTMLElement): (clave: string, dibujar: () => Node[]) => void {
  const nodo = el('div', '', 'market-section');
  padre.append(nodo);
  let anterior: string | null = null;
  return (clave, dibujar) => {
    if (clave === anterior) return;
    anterior = clave;
    nodo.replaceChildren(...dibujar());
  };
}

export function setupMarket(contenedor: HTMLElement, actions: MarketActions): MarketView {
  contenedor.replaceChildren(el('h3', 'Comercio'));
  const cuenta = seccion(contenedor);
  const mercader = seccion(contenedor);
  const venta = seccion(contenedor);
  const recibida = seccion(contenedor);
  const intercambio = seccion(contenedor);

  return {
    update(d) {
      cuenta(JSON.stringify([d.account, d.credits]), () => {
        const saldo = el('p', `Créditos: ${d.credits}`, 'credits');
        if (d.account) {
          const linea = el('p', `Cuenta: ${d.account}. Tu alijo se puede usar desde cualquier navegador. `, 'muted');
          linea.append(boton('Salir de la cuenta', () => actions.logout()));
          return [saldo, linea];
        }
        const aviso = el('p', 'Sin cuenta: tu alijo vive solo en este navegador. Con una cuenta lo podés usar desde otro.', 'muted');
        const nombre = el('input');
        nombre.placeholder = 'Nombre';
        nombre.autocomplete = 'username';
        nombre.maxLength = 20;
        const clave = el('input');
        clave.type = 'password';
        clave.placeholder = 'Clave (8 o más)';
        clave.autocomplete = 'current-password';
        const fila = el('div', '', 'actions');
        fila.append(
          nombre,
          clave,
          boton('Crear cuenta', () => actions.register(nombre.value, clave.value)),
          boton('Entrar', () => actions.login(nombre.value, clave.value)),
        );
        return [saldo, aviso, fila];
      });

      const filasMercader = shopRows(d.stock, d.catalogo, d.credits);
      mercader(JSON.stringify(filasMercader), () => {
        if (filasMercader.length === 0) return [];
        const lista = el('ul', '', 'inventory');
        for (const f of filasMercader) {
          const li = el('li');
          li.append(
            el('span', `${f.name}${f.quantity > 1 ? ` ×${f.quantity}` : ''}`, 'item-name'),
            el('span', `${f.price} créditos`, 'muted'),
            boton('Comprar', () => actions.buy(f.id), !f.affordable),
          );
          lista.append(li);
        }
        return [el('h4', 'El mercader vende'), lista];
      });

      const filasVenta = sellRows(d.contents, d.catalogo);
      venta(JSON.stringify(filasVenta), () => {
        if (filasVenta.length === 0) return [];
        const lista = el('ul', '', 'inventory');
        for (const f of filasVenta) {
          const li = el('li');
          li.append(el('span', `${f.name} ×${f.count}`, 'item-name'), el('span', `${f.unitPrice} c/u`, 'muted'));
          li.append(boton('Vender uno', () => actions.sell({ [f.id]: 1 })));
          if (f.count > 1) {
            const todo = boton(`Vender todo (${f.unitPrice * f.count})`, () => actions.sell({ [f.id]: f.count }));
            todo.classList.add('next');
            li.append(todo);
          }
          lista.append(li);
        }
        return [el('h4', 'Venderle al mercader'), lista];
      });

      recibida(JSON.stringify(d.incoming), () => {
        const oferta = d.incoming;
        if (!oferta) return [];
        const caja = el('div', '', 'offer');
        const aceptar = boton('Aceptar', () => actions.answer(oferta.id, true));
        const rechazar = boton('Rechazar', () => actions.answer(oferta.id, false));
        caja.append(el('p', describeOffer(oferta, d.catalogo)), aceptar, rechazar);
        return [caja];
      });

      // Lo que se puede ofrecer y pedir cambia poco; lo que más cambia es
      // quién está en el lobby, y eso solo rehace la lista de nombres.
      const guardables = [...d.catalogo.values()].filter((i) => !i.noStash);
      const propios = Object.entries(d.contents).filter(([, n]) => n > 0);
      intercambio(JSON.stringify([d.others, propios, guardables.length]), () => {
        if (d.others.length === 0) {
          return [el('h4', 'Intercambiar'), el('p', 'No hay nadie más en el lobby con quien intercambiar.', 'muted')];
        }
        const opcion = (value: string, text: string) => {
          const o = el('option', text);
          o.value = value;
          return o;
        };
        const quien = el('select');
        quien.append(...d.others.map((o) => opcion(o.sessionId, o.name)));
        const doy = el('select');
        doy.append(opcion('', 'nada'), ...propios.map(([id, n]) => opcion(id, `${d.catalogo.get(id)?.name ?? id} (tenés ${n})`)));
        const doyCuantos = numero(1, 1);
        const doyCreditos = numero(0, 0);
        const pido = el('select');
        pido.append(opcion('', 'nada'), ...guardables.map((i) => opcion(i.id, i.name)));
        const pidoCuantos = numero(1, 1);
        const pidoCreditos = numero(0, 0);

        const etiqueta = (text: string, ...campos: HTMLElement[]) => {
          const l = el('label', `${text} `);
          l.append(...campos);
          return l;
        };
        const fila = (...nodos: HTMLElement[]) => {
          const f = el('div', '', 'actions');
          f.append(...nodos);
          return f;
        };
        const enviar = boton('Mandar oferta', () => {
          const pedido = buildOffer(
            quien.value,
            doy.value,
            Number(doyCuantos.value),
            Number(doyCreditos.value),
            pido.value,
            Number(pidoCuantos.value),
            Number(pidoCreditos.value),
          );
          if (pedido) actions.offer(pedido);
        });
        return [
          el('h4', 'Intercambiar'),
          fila(etiqueta('Con', quien)),
          fila(etiqueta('Doy', doy), etiqueta('×', doyCuantos), etiqueta('y créditos', doyCreditos)),
          fila(etiqueta('Pido', pido), etiqueta('×', pidoCuantos), etiqueta('y créditos', pidoCreditos)),
          fila(enviar),
          el('p', 'Se hace recién cuando el otro acepta, y entero: si a alguno le falta algo, no pasa nada.', 'muted'),
        ];
      });
    },
  };
}
