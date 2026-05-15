package playground.sharedcore.validation;

import playground.sharedcore.domain.Order;

import java.util.ArrayList;
import java.util.List;

public final class OrderValidator {

    public List<String> validate(Order order) {
        List<String> errors = new ArrayList<>();
        if (order.customerId() == null || order.customerId().isBlank()) {
            errors.add("customerId is required");
        }
        if (order.items().isEmpty()) {
            errors.add("order must contain at least one line item");
        }
        for (Order.LineItem item : order.items()) {
            if (item.quantity() <= 0) {
                errors.add("quantity must be positive for sku " + item.sku());
            }
            if (item.unitPriceCents() < 0) {
                errors.add("unit price must be non-negative for sku " + item.sku());
            }
        }
        return errors;
    }
}
