import { describe, expect, it } from 'vitest';
import { createMotion } from '../src/lobby/motion';

const PASO = 300;

describe('createMotion', () => {
  it('la primera vez aparece quieto en su celda', () => {
    const m = createMotion(PASO);
    m.update('a', 3, 4, 0);
    expect(m.position('a', 0)).toMatchObject({ x: 3, y: 4, cellX: 3, cellY: 4, walking: false });
  });

  it('camina de una celda a la otra a lo largo del paso', () => {
    const m = createMotion(PASO);
    m.update('a', 3, 4, 0);
    m.update('a', 4, 4, 1000);
    expect(m.position('a', 1000)).toMatchObject({ x: 3, y: 4, walking: true });
    expect(m.position('a', 1150)!.x).toBeCloseTo(3.5);
    expect(m.position('a', 1300)).toMatchObject({ x: 4, y: 4 });
    expect(m.position('a', 2000)!.walking).toBe(false);
  });

  it('pasos encadenados no reinician el ciclo de caminata', () => {
    const m = createMotion(PASO);
    m.update('a', 0, 0, 0);
    m.update('a', 1, 0, 1000);
    m.update('a', 2, 0, 1300);
    expect(m.position('a', 1400)!.walkStart).toBe(1000);
  });

  it('un paso que llega antes de terminar el anterior sale de donde estaba', () => {
    const m = createMotion(PASO);
    m.update('a', 0, 0, 0);
    m.update('a', 1, 0, 1000);
    m.update('a', 2, 0, 1150);
    expect(m.position('a', 1150)!.x).toBeCloseTo(0.5);
  });

  it('un salto largo, como una escalera, no se camina', () => {
    const m = createMotion(PASO);
    m.update('a', 0, 0, 0);
    m.update('a', 10, 7, 1000);
    expect(m.position('a', 1000)).toMatchObject({ x: 10, y: 7, walking: false });
  });

  it('caminando hacia atrás se lo dibuja en la celda de adelante', () => {
    const m = createMotion(PASO);
    m.update('a', 5, 5, 0);
    m.update('a', 4, 5, 1000);
    expect(m.position('a', 1100)).toMatchObject({ cellX: 5, cellY: 5 });
    expect(m.position('a', 1400)).toMatchObject({ cellX: 4, cellY: 5 });
  });

  it('dice si hay que seguir redibujando', () => {
    const m = createMotion(PASO);
    m.update('a', 0, 0, 0);
    expect(m.moving(10)).toBe(false);
    m.update('a', 1, 0, 1000);
    expect(m.moving(1100)).toBe(true);
    m.forget('a');
    expect(m.moving(1100)).toBe(false);
  });
});
