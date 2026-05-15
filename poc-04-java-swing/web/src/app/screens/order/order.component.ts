import { Component, signal } from '@angular/core';
import { OrderApiService, Order } from '../../wasm/order-api.service';

@Component({
  selector: 'app-order',
  standalone: true,
  template: `
    <h2>Order</h2>
    <pre>total = {{ total() }} cents</pre>
    <ul>
      <li *ngFor="let err of errors()">{{ err }}</li>
    </ul>
    <button (click)="price()">Price</button>
  `,
})
export class OrderComponent {
  total = signal<bigint | null>(null);
  errors = signal<string[]>([]);

  private readonly order: Order = {
    customerId: 'cust-42',
    currency: 'EUR',
    items: [
      { sku: 'A', quantity: 2, unitPriceCents: 1999 },
      { sku: 'B', quantity: 1, unitPriceCents: 4999 },
    ],
  };

  constructor(private readonly api: OrderApiService) {}

  async price() {
    this.errors.set(await this.api.validate(this.order));
    if (this.errors().length === 0) {
      this.total.set(await this.api.totalCents(this.order));
    }
  }
}
