import { describe, expect, it } from 'vitest';

import { ACTIONS, actionsFor, findAction } from './index';
import { addStoreProduct, matchProduct, setStoreProductPrice, storeSales } from './store';
import { argInt, argMoney, argString } from './types';

describe('the registry', () => {
  it('names every action uniquely and describes every argument', () => {
    const names = ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const a of ACTIONS) {
      expect(a.name).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(a.says.length).toBeGreaterThan(20);
      for (const arg of a.args) {
        expect(arg.desc.length).toBeGreaterThan(3);
      }
    }
  });

  it('gives every `do` an apply and no `ask` one', () => {
    for (const a of ACTIONS) {
      if (a.kind === 'do') expect(typeof a.apply).toBe('function');
      else expect(a.apply).toBeUndefined();
    }
  });

  it('only offers what the caller may actually do', () => {
    const none = actionsFor(() => false);
    expect(none).toEqual([]);
    // Undefined is "not loaded yet", which is not permission.
    expect(actionsFor(() => undefined)).toEqual([]);
    const storeOnly = actionsFor((c) => c === 'can_manage_store');
    expect(storeOnly.map((a) => a.name)).toContain('store.add_product');
    expect(storeOnly.map((a) => a.name)).not.toContain('store.sales');
  });

  it('resolves an action by name and refuses anything else', () => {
    expect(findAction('store.add_product')?.name).toBe('store.add_product');
    expect(findAction('store.delete_everything')).toBeNull();
    expect(findAction(null)).toBeNull();
    expect(findAction(42)).toBeNull();
  });
});

describe('argument readers', () => {
  it('takes money the way people write it, in pounds, and stores pence', () => {
    expect(argMoney({ price: 1 }, 'price')).toBe(100);
    expect(argMoney({ price: '£1.50' }, 'price')).toBe(150);
    expect(argMoney({ price: '35' }, 'price')).toBe(3500);
    expect(argMoney({ price: 0 }, 'price')).toBe(0);
  });

  it('refuses money it would have to round or invent', () => {
    expect(argMoney({ price: '1.005' }, 'price')).toBeNull();
    expect(argMoney({ price: 'a fiver' }, 'price')).toBeNull();
    expect(argMoney({ price: -5 }, 'price')).toBeNull();
    expect(argMoney({ price: 99999 }, 'price')).toBeNull();
    expect(argMoney({}, 'price')).toBeNull();
  });

  it('bounds integers and tidies strings', () => {
    expect(argInt({ stock: 20 }, 'stock', 0, 100)).toBe(20);
    expect(argInt({ stock: 500 }, 'stock', 0, 100)).toBeNull();
    expect(argString({ name: '  water   bottle ' }, 'name')).toBe('water bottle');
    expect(argString({ name: '   ' }, 'name')).toBeNull();
  });
});

describe('store actions', () => {
  it('needs a name and a price before it will add anything', () => {
    expect(addStoreProduct.sanitise({ name: 'Water bottle', price: 1 })).toEqual({
      name: 'Water bottle',
      priceCents: 100,
      kind: 'physical',
      stock: null,
    });
    expect(addStoreProduct.sanitise({ name: 'Water bottle' })).toBeNull();
    expect(addStoreProduct.sanitise({ price: 1 })).toBeNull();
  });

  it('takes stock and kind when they were said', () => {
    expect(
      addStoreProduct.sanitise({ name: 'Hoodie', price: 35, stock: 20 })?.stock,
    ).toBe(20);
    expect(
      addStoreProduct.sanitise({ name: 'Guide', price: 12, kind: 'digital' })?.kind,
    ).toBe('digital');
    // An invented kind falls back rather than reaching the insert.
    expect(
      addStoreProduct.sanitise({ name: 'Guide', price: 12, kind: 'course' })?.kind,
    ).toBe('physical');
  });

  it('previews a bottle the way the owner would read it back', async () => {
    const args = addStoreProduct.sanitise({ name: 'Water bottle', price: 1 })!;
    const preview = await addStoreProduct.preview(args, null as never);
    expect(preview.title).toBe('Add this to the shop?');
    expect(preview.lines[0]).toBe('Water bottle — £1');
  });

  it('defaults the sales window to a month', () => {
    expect(storeSales.sanitise({})).toEqual({ days: 30 });
    expect(storeSales.sanitise({ days: 7 })).toEqual({ days: 7 });
    expect(storeSales.sanitise({ days: 99999 })).toEqual({ days: 30 });
  });

  it('needs both halves of a price change', () => {
    expect(setStoreProductPrice.sanitise({ name: 'Water bottle', price: 2 })).toEqual({
      name: 'Water bottle',
      priceCents: 200,
    });
    expect(setStoreProductPrice.sanitise({ name: 'Water bottle' })).toBeNull();
  });
});

describe('matchProduct', () => {
  const shop = [
    { name: 'Temple Water Bottle 750ml' },
    { name: 'Hoodie' },
    { name: 'Technique Guide' },
  ];

  it('finds what the owner called it, not what it was typed as', () => {
    expect(matchProduct(shop, 'water bottle')?.name).toBe(
      'Temple Water Bottle 750ml',
    );
    expect(matchProduct(shop, 'the hoodie')?.name).toBe('Hoodie');
  });

  it('refuses to pick between two that both answer to it', () => {
    const two = [{ name: 'Small bottle' }, { name: 'Large bottle' }];
    expect(matchProduct(two, 'bottle')).toBeNull();
  });

  it('returns nothing when nothing matches', () => {
    expect(matchProduct(shop, 'protein')).toBeNull();
  });
});
