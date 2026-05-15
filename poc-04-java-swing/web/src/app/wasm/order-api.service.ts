import { Injectable } from '@angular/core';

export interface LineItem {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  customerId: string;
  currency: string;
  items: LineItem[];
}

interface TeaVMRuntime {
  exports: {
    'playground.wasm.OrderApi.totalCents': (
      customerId: string,
      currency: string,
      skus: string[],
      quantities: Int32Array,
      unitPricesCents: BigInt64Array,
    ) => bigint;
    'playground.wasm.OrderApi.validate': (
      customerId: string,
      currency: string,
      skus: string[],
      quantities: Int32Array,
      unitPricesCents: BigInt64Array,
    ) => string;
  };
}

declare function load(wasmUrl: string): Promise<TeaVMRuntime>;

@Injectable({ providedIn: 'root' })
export class OrderApiService {
  private runtime: Promise<TeaVMRuntime> | null = null;

  private ensureLoaded(): Promise<TeaVMRuntime> {
    if (!this.runtime) {
      this.runtime = load('/assets/wasm/classes.wasm');
    }
    return this.runtime;
  }

  async totalCents(order: Order): Promise<bigint> {
    const rt = await this.ensureLoaded();
    const { skus, quantities, prices } = this.flatten(order);
    return rt.exports['playground.wasm.OrderApi.totalCents'](
      order.customerId, order.currency, skus, quantities, prices,
    );
  }

  async validate(order: Order): Promise<string[]> {
    const rt = await this.ensureLoaded();
    const { skus, quantities, prices } = this.flatten(order);
    const joined = rt.exports['playground.wasm.OrderApi.validate'](
      order.customerId, order.currency, skus, quantities, prices,
    );
    return joined ? joined.split('\n') : [];
  }

  private flatten(order: Order) {
    const skus = order.items.map(i => i.sku);
    const quantities = Int32Array.from(order.items.map(i => i.quantity));
    const prices = BigInt64Array.from(order.items.map(i => BigInt(i.unitPriceCents)));
    return { skus, quantities, prices };
  }
}
