package playground;

import org.teavm.jso.JSExport;

public class Hello {
    @JSExport
    public static int add(int a, int b) {
        return a + b;
    }

    public static void main(String[] args) {
        // entry point required by TeaVM; logic lives in exported methods
    }
}
