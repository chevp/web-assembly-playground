package playground.sharedcore.pricing;

import playground.sharedcore.domain.Order;

public final class PricingEngine {

    public long totalCents(Order order) {
        long total = 0;
        for (Order.LineItem item : order.items()) {
            total += (long) item.quantity() * item.unitPriceCents();
        }
        return applyDiscount(total);
    }

    private long applyDiscount(long subtotalCents) {
        if (subtotalCents >= 10_000_00L) {
            return subtotalCents - (subtotalCents / 10);
        }
        return subtotalCents;
    }
}
