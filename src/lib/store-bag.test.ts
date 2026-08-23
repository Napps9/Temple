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
    addToBag('tee', null, 2);
    expect(bagCount()).toBe(3);
    expect(bagLines()).toEqual([
      { product_id: 'tee', variant_id: null, quantity: 3 },
    ]);
  });

  it('keeps sizes of one product as separate lines', () => {
    addToBag('tee', 'size-m', 2);
    addToBag('tee', 'size-l');
    addToBag('tee', 'size-m');
    expect(bagCount()).toBe(4);
    expect(bagLines()).toEqual([
      { product_id: 'tee', variant_id: 'size-m', quantity: 3 },
      { product_id: 'tee', variant_id: 'size-l', quantity: 1 },
    ]);
  });

  it('counts across products', () => {
    addToBag('tee', null, 2);
    addToBag('belt');
    expect(bagCount()).toBe(3);
    expect(bagLines()).toHaveLength(2);
  });

  it('setBagQuantity is absolute, per variant, and zero removes the line', () => {
    addToBag('tee', 'size-m', 5);
    addToBag('tee', 'size-l', 1);
    setBagQuantity('tee', 'size-m', 2);
    expect(bagLines()).toEqual([
      { product_id: 'tee', variant_id: 'size-m', quantity: 2 },
      { product_id: 'tee', variant_id: 'size-l', quantity: 1 },
    ]);
    setBagQuantity('tee', 'size-m', 0);
    expect(bagLines()).toEqual([
      { product_id: 'tee', variant_id: 'size-l', quantity: 1 },
    ]);
  });

  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const spy = vi.fn();
    const off = subscribeBag(spy);
    addToBag('tee');
    setBagQuantity('tee', null, 4);
    expect(spy).toHaveBeenCalledTimes(2);
    off();
    addToBag('belt');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
