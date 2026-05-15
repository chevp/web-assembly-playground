package playground.sharedcore.domain;

import java.util.List;

public final class Order {
    private final String customerId;
    private final List<LineItem> items;
    private final String currency;

    public Order(String customerId, List<LineItem> items, String currency) {
        this.customerId = customerId;
        this.items = List.copyOf(items);
        this.currency = currency;
    }

    public String customerId() { return customerId; }
    public List<LineItem> items() { return items; }
    public String currency() { return currency; }

    public static final class LineItem {
        private final String sku;
        private final int quantity;
        private final long unitPriceCents;

        public LineItem(String sku, int quantity, long unitPriceCents) {
            this.sku = sku;
            this.quantity = quantity;
            this.unitPriceCents = unitPriceCents;
        }

        public String sku() { return sku; }
        public int quantity() { return quantity; }
        public long unitPriceCents() { return unitPriceCents; }
    }
}
