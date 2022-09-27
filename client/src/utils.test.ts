import { describe, expect, it } from '@jest/globals';
import { SortedArray } from './utils';

describe('sorted array', () => {
  let array: SortedArray<number>;

  beforeEach(() => {
    array = new SortedArray<number>((a: number, b: number) => (a < b ? -1 : 1));
  });

  it('should start out empty', () => {
    expect(array.size()).toEqual(0);
  });

  it('should correctly add', () => {
    array.add(2);
    expect(array.size()).toEqual(1);
    expect(array.get(0)).toEqual(2);

    array.add(1);
    expect(array.size()).toEqual(2);
    expect(array.get(0)).toEqual(1);
    expect(array.get(1)).toEqual(2);

    array.add(-1);
    expect(array.get(0)).toEqual(-1);
  });

  describe('iterator', () => {
    let seen: number[];

    beforeEach(() => {
      seen = [];
    });

    it('should correctly iterate (1/2)', () => {
      for (const elem of array) {
        seen.push(elem);
      }
      expect(seen.length).toEqual(0);
    });

    it('should correctly iterate (2/2)', () => {
      array.add(2);
      array.add(1);

      for (const elem of array) {
        seen.push(elem);
      }
      expect(seen).toEqual([1, 2]);
    });
  });
});
