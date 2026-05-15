package playground.wasm;

import org.teavm.jso.JSExport;
import playground.sharedcore.domain.Order;
import playground.sharedcore.pricing.PricingEngine;
import playground.sharedcore.validation.OrderValidator;

import java.util.ArrayList;
import java.util.List;

/**
 * Thin JS-facing adapter. Accepts flat primitive arrays so we don't cross the
 * JS/WASM boundary with object graphs. The Angular service serializes an Order
 * into parallel arrays before calling.
 */
public final class OrderApi {

    private static final OrderValidator VALIDATOR = new OrderValidator();
    private static final PricingEngine PRICING = new PricingEngine();

    @JSExport
    public static long totalCents(
            String customerId,
            String currency,
            String[] skus,
            int[] quantities,
            long[] unitPricesCents) {
        return PRICING.totalCents(buildOrder(customerId, currency, skus, quantities, unitPricesCents));
    }

    @JSExport
    public static String validate(
            String customerId,
            String currency,
            String[] skus,
            int[] quantities,
            long[] unitPricesCents) {
        List<String> errors = VALIDATOR.validate(
                buildOrder(customerId, currency, skus, quantities, unitPricesCents));
        return String.join("\n", errors);
    }

    private static Order buildOrder(
            String customerId, String currency,
            String[] skus, int[] quantities, long[] unitPricesCents) {
        List<Order.LineItem> items = new ArrayList<>(skus.length);
        for (int i = 0; i < skus.length; i++) {
            items.add(new Order.LineItem(skus[i], quantities[i], unitPricesCents[i]));
        }
        return new Order(customerId, items, currency);
    }

    public static void main(String[] args) {
        // entry point required by TeaVM
    }
}
