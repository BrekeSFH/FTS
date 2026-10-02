import { describe, expect, it } from 'vitest';
import { WALL_OCCLUSION_DEPTH, hidesCell, shouldDrawWall } from '../src/iso/occlusion';

/**
 * Mapa de prueba: una sala de 3x3 rodeada de roca.
 *
 *   . = piso    # = roca
 *   #####
 *   #...#
 *   #...#
 *   #...#
 *   #####
 */
const SALA = ['#####', '#...#', '#...#', '#...#', '#####'];
const esPiso = (x: number, y: number) => SALA[y]?.[x] === '.';

describe('shouldDrawWall', () => {
  it('dibuja la roca que tiene piso adelante, que es la pared del fondo', () => {
    // La fila de arriba y la columna izquierda bordean la sala por detrás.
    expect(shouldDrawWall(esPiso, 1, 0)).toBe(true);
    expect(shouldDrawWall(esPiso, 0, 1)).toBe(true);
  });

  it('omite la esquina de atrás, que no da a ninguna sala', () => {
    // (0,0) tiene roca tanto en x+1 como en y+1: no es cara de nada.
    expect(shouldDrawWall(esPiso, 0, 0)).toBe(false);
  });

  it('omite la roca del lado cercano, que taparía la sala', () => {
    // La fila de abajo y la columna derecha solo tienen piso detrás.
    expect(shouldDrawWall(esPiso, 1, 4)).toBe(false);
    expect(shouldDrawWall(esPiso, 4, 1)).toBe(false);
    expect(shouldDrawWall(esPiso, 4, 4)).toBe(false);
  });

  it('no dibuja roca rodeada de roca', () => {
    const macizo = () => false;
    expect(shouldDrawWall(macizo, 5, 5)).toBe(false);
  });

  it('no dibuja nada donde hay piso adelante pero la celda misma es piso', () => {
    // La función no mira si la celda es roca; eso lo decide quien llama.
    // Acá solo se documenta que depende exclusivamente de los vecinos.
    expect(shouldDrawWall(esPiso, 1, 1)).toBe(true);
  });
});

describe('hidesCell', () => {
  const PARED = { x: 6, y: 6 };
  const tapa = (x: number, y: number) => hidesCell(PARED.x, PARED.y, x, y);

  it('no se tapa a sí misma', () => {
    expect(tapa(PARED.x, PARED.y)).toBe(false);
  });

  it('no tapa lo que está adelante', () => {
    expect(tapa(PARED.x + 1, PARED.y)).toBe(false);
    expect(tapa(PARED.x, PARED.y + 1)).toBe(false);
    expect(tapa(PARED.x + 1, PARED.y + 1)).toBe(false);
  });

  it('tapa lo que tiene justo detrás', () => {
    expect(tapa(PARED.x - 1, PARED.y)).toBe(true);
    expect(tapa(PARED.x, PARED.y - 1)).toBe(true);
    expect(tapa(PARED.x - 1, PARED.y - 1)).toBe(true);
  });

  it('tapa hasta donde llega su alto y no más', () => {
    // Dos celdas en diagonal son cuatro filas de pantalla: el límite.
    expect(tapa(PARED.x - 2, PARED.y - 2)).toBe(true);
    expect(tapa(PARED.x - 3, PARED.y - 3)).toBe(false);
  });

  it('no tapa lo que queda corrido a los costados', () => {
    // Misma profundidad, pero desplazado en horizontal más de medio rombo.
    expect(tapa(PARED.x - 4, PARED.y)).toBe(false);
    expect(tapa(PARED.x, PARED.y - 4)).toBe(false);
  });

  it('la profundidad que tapa coincide con la constante', () => {
    let maxima = 0;
    for (let dx = 0; dx <= 8; dx++) {
      for (let dy = 0; dy <= 8; dy++) {
        if (tapa(PARED.x - dx, PARED.y - dy)) maxima = Math.max(maxima, dx + dy);
      }
    }
    expect(maxima).toBe(WALL_OCCLUSION_DEPTH);
  });
});
