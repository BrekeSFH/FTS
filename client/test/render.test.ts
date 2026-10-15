/**
 * Tests del render con un contexto 2D falso.
 *
 * No se comprueban píxeles sino decisiones: qué celdas se dibujan, con cuánta
 * opacidad y a quién se muestra. Eso es lo que la niebla tiene que acertar, y
 * se puede verificar sin un navegador.
 */
import { describe, expect, it } from 'vitest';
import type { LobbyPlayer, LobbyState } from '../src/lobby/connection';
import type { VisionView } from '../src/lobby/fog';
import { renderLobby, type PlacedTile } from '../src/lobby/render';

interface Dibujo {
  alpha: number;
}

function contextoFalso() {
  const imagenes: Dibujo[] = [];
  const textos: string[] = [];
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    setTransform: () => {},
    translate: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    ellipse: () => {},
    strokeText: () => {},
    drawImage: () => imagenes.push({ alpha: context.globalAlpha }),
    fillText: (texto: string) => textos.push(texto),
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  return { canvas: canvas as unknown as HTMLCanvasElement, imagenes, textos };
}

const TILE: PlacedTile = { bitmap: {} as ImageBitmap, anchorX: 36, anchorY: 43 };

/** Tres celdas de piso en fila, con un jugador en cada punta. */
function estado(): LobbyState {
  const players = new Map<string, LobbyPlayer>([
    ['yo', { x: 0, y: 0, name: 'Yo', hue: 0, facing: 4 }],
    ['otro', { x: 2, y: 0, name: 'Otro', hue: 120, facing: 4 }],
  ]);
  return { width: 3, height: 1, cells: '...', players };
}

/** Visión declarada a mano: qué se ve y qué se recuerda. */
function vista(visibles: number[], exploradas: number[]): VisionView {
  return {
    visible: (x, y) => y === 0 && visibles.includes(x),
    explored: (x, y) => y === 0 && (visibles.includes(x) || exploradas.includes(x)),
  };
}

describe('renderLobby con niebla', () => {
  it('sin visión dibuja todo y a todos', () => {
    const { canvas, imagenes, textos } = contextoFalso();
    renderLobby(canvas, estado(), { ownSessionId: 'yo', floors: [TILE] });

    expect(imagenes).toHaveLength(3);
    expect(imagenes.every((i) => i.alpha === 1)).toBe(true);
    expect(textos).toEqual(expect.arrayContaining(['Yo', 'Otro']));
  });

  it('no dibuja lo que nunca se vio', () => {
    const { canvas, imagenes } = contextoFalso();
    renderLobby(canvas, estado(), { ownSessionId: 'yo', floors: [TILE], vision: vista([0], [1]) });

    // La celda 2 no se vio nunca: ni piso ni contorno.
    expect(imagenes).toHaveLength(2);
  });

  it('apaga lo explorado que ya no se ve', () => {
    const { canvas, imagenes } = contextoFalso();
    renderLobby(canvas, estado(), { ownSessionId: 'yo', floors: [TILE], vision: vista([0], [1]) });

    expect(imagenes[0].alpha, 'la celda visible').toBe(1);
    expect(imagenes[1].alpha, 'la recordada').toBeLessThan(1);
    expect(imagenes[1].alpha).toBeGreaterThan(0);
  });

  it('no muestra a quien está en una celda que no se ve', () => {
    const { canvas, textos } = contextoFalso();
    renderLobby(canvas, estado(), { ownSessionId: 'yo', floors: [TILE], vision: vista([0], [1, 2]) });

    // La celda del otro está explorada, así que el piso se dibuja; él no.
    expect(textos).toContain('Yo');
    expect(textos).not.toContain('Otro');
  });

  it('muestra a quien sí se ve', () => {
    const { canvas, textos } = contextoFalso();
    renderLobby(canvas, estado(), { ownSessionId: 'yo', floors: [TILE], vision: vista([0, 2], []) });

    expect(textos).toEqual(expect.arrayContaining(['Yo', 'Otro']));
  });
});

describe('renderLobby con escaleras', () => {
  it('marca hacia dónde lleva cada escalera', () => {
    const { canvas, textos } = contextoFalso();
    const conEscaleras: LobbyState = { ...estado(), cells: '>.<' };
    renderLobby(canvas, conEscaleras, { ownSessionId: 'yo', floors: [TILE] });

    expect(textos).toEqual(expect.arrayContaining(['▼', '▲']));
  });

  it('una escalera nunca vista no se delata', () => {
    const { canvas, textos } = contextoFalso();
    const conEscaleras: LobbyState = { ...estado(), cells: '..>' };
    renderLobby(canvas, conEscaleras, { ownSessionId: 'yo', floors: [TILE], vision: vista([0], []) });

    expect(textos).not.toContain('▼');
  });
});

describe('renderLobby con botín y salidas', () => {
  it('distingue un contenedor lleno de uno vaciado', () => {
    const { canvas, textos } = contextoFalso();
    const con: LobbyState = {
      ...estado(),
      caches: [
        { floor: 0, x: 0, y: 0, looted: false },
        { floor: 0, x: 1, y: 0, looted: true },
      ],
    };
    renderLobby(canvas, con, { ownSessionId: 'yo', floors: [TILE] });
    expect(textos).toEqual(expect.arrayContaining(['■', '□']));
  });

  it('una salida se ve solo mientras se la está viendo', () => {
    const con: LobbyState = { ...estado(), exits: [{ floor: 0, x: 1, y: 0, closes: 5 }] };

    const vista1 = contextoFalso();
    renderLobby(vista1.canvas, con, { ownSessionId: 'yo', floors: [TILE], vision: vista([0, 1], []) });
    expect(vista1.textos).toContain('SALIDA');

    const vista2 = contextoFalso();
    renderLobby(vista2.canvas, con, { ownSessionId: 'yo', floors: [TILE], vision: vista([0], [1]) });
    expect(vista2.textos, 'explorada pero no a la vista').not.toContain('SALIDA');
  });
});
