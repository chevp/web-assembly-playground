package playground.swing;

import playground.sharedcore.domain.Order;
import playground.sharedcore.pricing.PricingEngine;
import playground.sharedcore.validation.OrderValidator;

import javax.swing.*;
import java.awt.*;
import java.util.ArrayList;
import java.util.List;

/**
 * Stand-in for a screen from the legacy 120k-LOC Swing app. The UI is plain
 * Swing; the business calls go through shared-core, which is the same module
 * the WASM build packages for the Angular client.
 */
public final class OrderScreen extends JPanel {

    private final OrderValidator validator = new OrderValidator();
    private final PricingEngine pricing = new PricingEngine();

    private final JTextField customerField = new JTextField("cust-42", 12);
    private final JTextField currencyField = new JTextField("EUR", 4);
    private final LineItemRow row1 = new LineItemRow("A", 2, 1999);
    private final LineItemRow row2 = new LineItemRow("B", 1, 4999);
    private final JTextArea output = new JTextArea(8, 40);

    public OrderScreen() {
        super(new BorderLayout(8, 8));
        setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));

        JPanel form = new JPanel(new GridLayout(0, 1, 4, 4));
        form.add(labeled("Customer", customerField));
        form.add(labeled("Currency", currencyField));
        form.add(row1);
        form.add(row2);

        JButton validateBtn = new JButton("Validate");
        JButton priceBtn = new JButton("Price");
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT));
        buttons.add(validateBtn);
        buttons.add(priceBtn);

        output.setEditable(false);

        add(form, BorderLayout.NORTH);
        add(buttons, BorderLayout.CENTER);
        add(new JScrollPane(output), BorderLayout.SOUTH);

        validateBtn.addActionListener(e -> showValidation());
        priceBtn.addActionListener(e -> showPrice());
    }

    private void showValidation() {
        List<String> errors = validator.validate(currentOrder());
        output.setText(errors.isEmpty() ? "OK" : String.join("\n", errors));
    }

    private void showPrice() {
        Order order = currentOrder();
        List<String> errors = validator.validate(order);
        if (!errors.isEmpty()) {
            output.setText(String.join("\n", errors));
            return;
        }
        long cents = pricing.totalCents(order);
        output.setText(String.format("Total: %d.%02d %s",
                cents / 100, Math.abs(cents % 100), currencyField.getText().trim()));
    }

    private Order currentOrder() {
        List<Order.LineItem> items = new ArrayList<>();
        row1.appendTo(items);
        row2.appendTo(items);
        return new Order(customerField.getText().trim(), items, currencyField.getText().trim());
    }

    private static JPanel labeled(String label, JComponent field) {
        JPanel p = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        p.add(new JLabel(label + ":"));
        p.add(field);
        return p;
    }

    private static final class LineItemRow extends JPanel {
        private final JTextField sku;
        private final JTextField qty;
        private final JTextField priceCents;

        LineItemRow(String defaultSku, int defaultQty, long defaultPriceCents) {
            super(new FlowLayout(FlowLayout.LEFT, 6, 0));
            sku = new JTextField(defaultSku, 6);
            qty = new JTextField(String.valueOf(defaultQty), 4);
            priceCents = new JTextField(String.valueOf(defaultPriceCents), 6);
            add(new JLabel("SKU:"));   add(sku);
            add(new JLabel("Qty:"));   add(qty);
            add(new JLabel("Cents:")); add(priceCents);
        }

        void appendTo(List<Order.LineItem> items) {
            String s = sku.getText().trim();
            if (s.isEmpty()) return;
            items.add(new Order.LineItem(
                    s,
                    parseInt(qty.getText(), 0),
                    parseLong(priceCents.getText(), 0L)));
        }

        private static int parseInt(String s, int fallback) {
            try { return Integer.parseInt(s.trim()); } catch (NumberFormatException e) { return fallback; }
        }

        private static long parseLong(String s, long fallback) {
            try { return Long.parseLong(s.trim()); } catch (NumberFormatException e) { return fallback; }
        }
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame frame = new JFrame("Order — Swing client");
            frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
            frame.setContentPane(new OrderScreen());
            frame.pack();
            frame.setLocationRelativeTo(null);
            frame.setVisible(true);
        });
    }
}
