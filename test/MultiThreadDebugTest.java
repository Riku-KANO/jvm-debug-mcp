import java.util.concurrent.CountDownLatch;

public class MultiThreadDebugTest {
    static volatile boolean running = true;

    public static void main(String[] args) throws Exception {
        System.out.println("Multi-thread debug test started. PID: " + ProcessHandle.current().pid());
        CountDownLatch latch = new CountDownLatch(1);

        // API1 handler thread
        Thread api1Thread = new Thread(() -> {
            int count = 0;
            while (running) {
                count++;
                String result = handleApi1(count);  // line 15
                System.out.println("[API1] " + result);
                sleep(3000);
            }
        }, "API1-Handler");

        // API2 handler thread
        Thread api2Thread = new Thread(() -> {
            int count = 0;
            while (running) {
                count++;
                String result = handleApi2(count);  // line 25
                System.out.println("[API2] " + result);
                sleep(3000);
            }
        }, "API2-Handler");

        api1Thread.start();
        api2Thread.start();

        System.out.println("Both threads started. Waiting...");
        api1Thread.join();
    }

    static String handleApi1(int requestNum) {
        int processed = requestNum * 10;          // line 38
        String msg = "API1 processed request #" + requestNum;  // line 39
        return msg + " (value=" + processed + ")"; // line 40
    }

    static String handleApi2(int requestNum) {
        int computed = requestNum + 100;            // line 44
        String msg = "API2 computed request #" + requestNum;    // line 45
        return msg + " (result=" + computed + ")";  // line 46
    }

    static void sleep(int ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
