/**
 * Comercio y cuentas en el lobby, contra un servidor con alijo.
 */
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LOBBY_ROOM, VAULT_ROOM, createServer } from '../src/createServer';
import { STOCK } from '../src/rooms/market';
import {
  NOTICE_MESSAGE,
  STASH_MESSAGE,
  TRADE_CLOSED_MESSAGE,
  TRADE_MESSAGE,
  type LobbyRoom,
  type StashMessage,
  type TradeOffer,
} from '../src/rooms/LobbyRoom';
import { type VaultRoom } from '../src/rooms/VaultRoom';
import { currentStash, openStash, playerIdFromToken, type Stash } from '../src/stash';

let colyseus: ColyseusTestServer;
let stash: Stash;

beforeAll(async () => {
  colyseus = await boot(createServer({ stash: openStash(':memory:') }), 2593);
  stash = currentStash()!;
});
afterAll(async () => await colyseus.shutdown());
afterEach(async () => await colyseus.cleanup());

/** Un token nuevo por test, para que no se pisen los alijos. */
let n = 0;
const nuevoToken = () => `token-comercio-${++n}-0123456789abcdef`;

/** Entra al lobby y junta lo que le va llegando. */
async function entrar(room: LobbyRoom, token: string, name = 'Alguien') {
  const client = await colyseus.connectTo(room, { token, name });
  const avisos: string[] = [];
  const ofertas: TradeOffer[] = [];
  const cerradas: string[] = [];
  let alijo: StashMessage | null = null;
  client.onMessage('items', () => {});
  client.onMessage('vision', () => {});
  client.onMessage('shop', () => {});
  client.onMessage(STASH_MESSAGE, (m: StashMessage) => (alijo = m));
  client.onMessage(NOTICE_MESSAGE, (m: { text: string }) => avisos.push(m.text));
  client.onMessage(TRADE_MESSAGE, (m: TradeOffer) => ofertas.push(m));
  client.onMessage(TRADE_CLOSED_MESSAGE, (m: { text: string }) => cerradas.push(m.text));
  return { client, avisos, ofertas, cerradas, alijo: () => alijo };
}

async function esperar(room: LobbyRoom, hasta: () => boolean): Promise<void> {
  for (let i = 0; i < 30 && !hasta(); i++) await room.waitForNextPatch();
}

const jugador = (token: string) => stash.resolve(playerIdFromToken(token)!);

describe('el mercader', () => {
  it('compra a lo que vale y manda el alijo nuevo', async () => {
    const token = nuevoToken();
    stash.add(jugador(token), ['holodisco', 'chatarra']);
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, { seed: 4321 });
    const yo = await entrar(room, token);

    yo.client.send('sell', { items: { holodisco: 1 } });
    await esperar(room, () => yo.alijo()?.credits === 40);
    expect(yo.alijo()).toMatchObject({ contents: { chatarra: 1 }, credits: 40 });
  });

  it('vende lo suyo si alcanza, y si no, avisa', async () => {
    const token = nuevoToken();
    const balas = STOCK.find((e) => e.id === 'balas-9mm')!;
    stash.exchange(jugador(token), { items: [], credits: 0 }, { items: [], credits: balas.price });
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, { seed: 4321 });
    const yo = await entrar(room, token);

    yo.client.send('buy', { item: 'balas-9mm' });
    await esperar(room, () => yo.alijo()?.credits === 0);
    expect(yo.alijo()!.contents).toEqual({ 'balas-9mm': balas.quantity });

    yo.client.send('buy', { item: 'balas-9mm' });
    await esperar(room, () => yo.avisos.some((t) => /no te alcanza/i.test(t)));
    expect(stash.contents(jugador(token))).toEqual({ 'balas-9mm': balas.quantity });
  });

  it('no vende lo bueno', async () => {
    const token = nuevoToken();
    stash.exchange(jugador(token), { items: [], credits: 0 }, { items: [], credits: 10_000 });
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, { seed: 4321 });
    const yo = await entrar(room, token);
    yo.client.send('buy', { item: 'rifle-laser' });
    for (let i = 0; i < 5; i++) await room.waitForNextPatch();
    expect(stash.credits(jugador(token))).toBe(10_000);
  });
});

describe('intercambiar', () => {
  async function dos() {
    const ta = nuevoToken();
    const tb = nuevoToken();
    stash.add(jugador(ta), ['escopeta']);
    stash.add(jugador(tb), ['holodisco']);
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, { seed: 4321 });
    const a = await entrar(room, ta, 'Ana');
    const b = await entrar(room, tb, 'Beto');
    return { room, ta, tb, a, b };
  }

  it('la oferta llega y, si se acepta, pasa entera', async () => {
    const { room, ta, tb, a, b } = await dos();
    a.client.send('tradeOffer', { to: b.client.sessionId, give: { escopeta: 1 }, want: { holodisco: 1 } });
    await esperar(room, () => b.ofertas.length > 0);
    expect(b.ofertas[0]).toMatchObject({ fromName: 'Ana', give: { escopeta: 1 }, want: { holodisco: 1 } });

    b.client.send('tradeAnswer', { id: b.ofertas[0].id, accept: true });
    await esperar(room, () => a.cerradas.length > 0 && b.cerradas.length > 0);
    expect(a.cerradas[0]).toMatch(/hecho/i);
    expect(stash.contents(jugador(ta))).toEqual({ holodisco: 1 });
    expect(stash.contents(jugador(tb))).toEqual({ escopeta: 1 });
  });

  it('rechazada, no pasa nada', async () => {
    const { room, ta, tb, a, b } = await dos();
    a.client.send('tradeOffer', { to: b.client.sessionId, give: { escopeta: 1 }, want: { holodisco: 1 } });
    await esperar(room, () => b.ofertas.length > 0);
    b.client.send('tradeAnswer', { id: b.ofertas[0].id, accept: false });
    await esperar(room, () => a.cerradas.length > 0);
    expect(a.cerradas[0]).toMatch(/rechazada/i);
    expect(stash.contents(jugador(ta))).toEqual({ escopeta: 1 });
    expect(stash.contents(jugador(tb))).toEqual({ holodisco: 1 });
  });

  it('no se puede ofrecer lo que no se tiene', async () => {
    const { room, a, b } = await dos();
    a.client.send('tradeOffer', { to: b.client.sessionId, give: { 'rifle-laser': 1 }, want: {} });
    await esperar(room, () => a.avisos.length > 0);
    expect(a.avisos[0]).toMatch(/no tenés/i);
    expect(b.ofertas).toEqual([]);
  });

  it('si al aceptar ya no lo tiene, no pasa nada', async () => {
    const { room, ta, tb, a, b } = await dos();
    a.client.send('tradeOffer', { to: b.client.sessionId, give: { escopeta: 1 }, want: { holodisco: 1 } });
    await esperar(room, () => b.ofertas.length > 0);
    // Mientras tanto, A se llevó la escopeta a una Vault.
    stash.take(jugador(ta), ['escopeta']);
    b.client.send('tradeAnswer', { id: b.ofertas[0].id, accept: true });
    await esperar(room, () => b.cerradas.length > 0);
    expect(b.cerradas[0]).toMatch(/no se pudo/i);
    expect(stash.contents(jugador(tb))).toEqual({ holodisco: 1 });
  });

  it('una oferta reemplazada no se puede aceptar', async () => {
    const { room, tb, a, b } = await dos();
    a.client.send('tradeOffer', { to: b.client.sessionId, give: { escopeta: 1 }, want: {} });
    await esperar(room, () => b.ofertas.length > 0);
    a.client.send('tradeOffer', { to: b.client.sessionId, give: {}, want: { holodisco: 1 } });
    await esperar(room, () => b.ofertas.length > 1);
    b.client.send('tradeAnswer', { id: b.ofertas[0].id, accept: true });
    await esperar(room, () => b.avisos.some((t) => /ya no está/i.test(t)));
    expect(stash.contents(jugador(tb))).toEqual({ holodisco: 1 });
  });

  it('si se va quien ofreció, la oferta se cierra', async () => {
    const { room, a, b } = await dos();
    a.client.send('tradeOffer', { to: b.client.sessionId, give: { escopeta: 1 }, want: {} });
    await esperar(room, () => b.ofertas.length > 0);
    await a.client.leave();
    await esperar(room, () => b.cerradas.length > 0);
    expect(b.cerradas[0]).toMatch(/se fue/i);
  });
});

describe('las cuentas', () => {
  it('crear una cuenta y entrar desde otro navegador da el mismo alijo, también en la Vault', async () => {
    const t1 = nuevoToken();
    const t2 = nuevoToken();
    stash.add(jugador(t1), ['escopeta']);
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, { seed: 4321 });
    const uno = await entrar(room, t1);
    uno.client.send('register', { name: `Cuenta${n}`, password: 'clave-larga' });
    await esperar(room, () => uno.alijo()?.account !== null && uno.alijo()?.account !== undefined);
    expect(uno.alijo()).toMatchObject({ account: `Cuenta${n}`, contents: { escopeta: 1 } });

    const dos = await entrar(room, t2);
    dos.client.send('login', { name: `Cuenta${n}`, password: 'clave-larga' });
    await esperar(room, () => dos.alijo()?.account === `Cuenta${n}`);
    expect(dos.alijo()!.contents).toEqual({ escopeta: 1 });

    // Desde el otro navegador se entra a la Vault con lo de la cuenta.
    const vault = await colyseus.createRoom<VaultRoom>(VAULT_ROOM, { seed: 7, enemies: false });
    const enVault = await colyseus.connectTo(vault, { token: t2, loadout: ['escopeta'] });
    enVault.onMessage('vision', () => {});
    enVault.onMessage('items', () => {});
    expect(vault.state.players.get(enVault.sessionId)!.weapon).toBe('escopeta');
    expect(stash.contents(jugador(t1))).toEqual({});
  });

  it('con la clave equivocada no entra, y a los cinco intentos frena', async () => {
    const t1 = nuevoToken();
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, { seed: 4321 });
    const yo = await entrar(room, t1);
    for (let i = 0; i < 6; i++) yo.client.send('login', { name: 'NoExiste', password: 'lo-que-sea' });
    await esperar(room, () => yo.avisos.length >= 6);
    expect(yo.avisos.slice(0, 5).every((t) => /incorrectos/i.test(t))).toBe(true);
    expect(yo.avisos[5]).toMatch(/demasiados/i);
  });

  it('salir deja el navegador sin cuenta y el alijo en la cuenta', async () => {
    const t1 = nuevoToken();
    stash.add(jugador(t1), ['holodisco']);
    const room = await colyseus.createRoom<LobbyRoom>(LOBBY_ROOM, { seed: 4321 });
    const yo = await entrar(room, t1);
    yo.client.send('register', { name: `Sale${n}`, password: 'clave-larga' });
    await esperar(room, () => Boolean(yo.alijo()?.account));
    const cuenta = jugador(t1);

    yo.client.send('logout');
    await esperar(room, () => yo.alijo()?.account === null);
    expect(yo.alijo()!.contents).toEqual({});
    expect(stash.contents(cuenta)).toEqual({ holodisco: 1 });
  });
});
