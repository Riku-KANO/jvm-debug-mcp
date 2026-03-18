public class DebugTest {
    public static void main(String[] args) throws InterruptedException {
        System.out.println("Debug test started. PID: " + ProcessHandle.current().pid());

        String message = "Hello, Debug!";
        int counter = 0;

        while (true) {
            counter++;
            String result = process(message, counter);
            System.out.println(result);
            Thread.sleep(2000);
        }
    }

    static String process(String msg, int count) {
        int doubled = count * 2;
        String formatted = String.format("[%d] %s (x2=%d)", count, msg, doubled);
        return formatted;
    }
}
