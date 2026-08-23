import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addToBag,
  bagCount,
  bagLines,
  clearBag,
  setBagQuantity,
  subscribeBag,
} from './store-bag';

beforeEach(() => clearBag());

describe('store bag', () => {
  it('accumulates quantity for the same product', () => {
    addToBag('tee');
    addToBag('tee', 2);
    expect(bagCount()).toBe(3);
    expect(bagLines()).toEqual([{ product_id: 'tee', quantity: 3 }]);
  });

  it('counts across products', () => {
    addToBag('tee', 2);
    addToBag('belt');
    expect(bagCount()).toBe(3);
    expect(bagLines()).toHaveLength(2);
  });

  it('setBagQuantity is absolute and zero removes the line', () => {
    addToBag('tee', 5);
    setBagQuantity('tee', 2);
    expect(bagLines()).toEqual([{ product_id: 'tee', quantity: 2 }]);
    setBagQuantity('tee', 0);
    expect(bagLines()).toEqual([]);
  });

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const spy = vi.fn();
    const off = subscribeBag(spy);
    addToBag('tee');
    setBagQuantity('tee', 4);
    expect(spy).toHaveBeenCalledTimes(2);
    off();
    addToBag('belt');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
