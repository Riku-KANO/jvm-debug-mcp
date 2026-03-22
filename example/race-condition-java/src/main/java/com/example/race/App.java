package com.example.race;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;

/**
 * Race condition demo for MCP debugging.
 *
 * Two threads repeatedly increment a shared counter without synchronization.
 * Use breakpoints, thread inspection, and variable inspection to observe
 * the race condition as it happens.
 *
 * Debugging walkthrough:
 *   1. launch & connect
 *   2. set_breakpoint({ className: "com.example.race.App", line: 80 })
 *      -- catches the READ of sharedCounter inside incrementUnsafe()
 *   3. get_threads() to see Worker-A and Worker-B
 *   4. get_variables() to inspect "current" vs actual sharedCounter
 *   5. step_over() to watch the interleaving
 *   6. resume() and check process_output() for lost update reports
 */
public class App {

    static int sharedCounter = 0;
    static final int INCREMENTS_PER_ROUND = 10_000;
    static final int TOTAL_ROUNDS = 10;

    public static void main(String[] args) throws Exception {
        System.out.println("=== Race Condition Demo ===");
        System.out.println("Each round: 2 threads x " + INCREMENTS_PER_ROUND + " increments = "
                + (INCREMENTS_PER_ROUND * 2) + " expected");
        System.out.println();

        int raceCount = 0;

        for (int round = 1; round <= TOTAL_ROUNDS; round++) {
            sharedCounter = 0;
            int expected = INCREMENTS_PER_ROUND * 2;

            CyclicBarrier barrier = new CyclicBarrier(2);
            CountDownLatch done = new CountDownLatch(2);

            Thread t1 = new Thread(() -> {
                awaitBarrier(barrier);
                for (int i = 0; i < INCREMENTS_PER_ROUND; i++) {
                    incrementUnsafe();
                }
                done.countDown();
            }, "Worker-A");

            Thread t2 = new Thread(() -> {
                awaitBarrier(barrier);
                for (int i = 0; i < INCREMENTS_PER_ROUND; i++) {
                    incrementUnsafe();
                }
                done.countDown();
            }, "Worker-B");

            t1.start();
            t2.start();
            done.await();

            boolean raced = reportResult(round, expected, sharedCounter);
            if (raced) raceCount++;

            // Pause between rounds for debugging
            Thread.sleep(2000);
        }

        System.out.println("\n=== Summary ===");
        System.out.printf("Race detected in %d / %d rounds%n", raceCount, TOTAL_ROUNDS);
        System.out.println("All rounds complete.");
    }

    /**
     * Non-atomic increment -- the race condition is here.
     *
     * Set a breakpoint on line 80 (the READ) and use get_variables()
     * to inspect "current" from both threads. When both threads read
     * the same value, one write will be lost.
     */
    static void incrementUnsafe() {
        int current = sharedCounter;       // READ  (breakpoint here: line 80)
        current = current + 1;             // local increment
        sharedCounter = current;           // WRITE (may overwrite other thread's write)
    }

    static boolean reportResult(int round, int expected, int actual) {
        if (actual < expected) {
            int lost = expected - actual;
            System.out.printf("[Round %2d] RACE DETECTED  expected=%d  actual=%d  lost=%d%n",
                    round, expected, actual, lost);
            return true;
        } else {
            System.out.printf("[Round %2d] OK             expected=%d  actual=%d%n",
                    round, expected, actual);
            return false;
        }
    }

    static void awaitBarrier(CyclicBarrier barrier) {
        try {
            barrier.await();
        } catch (Exception e) {
            Thread.currentThread().interrupt();
        }
    }
}
