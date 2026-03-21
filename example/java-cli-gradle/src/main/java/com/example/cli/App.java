package com.example.cli;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Number processing demo application.
 * Processes batches of numbers with a delay between each batch,
 * making it suitable for interactive debugging.
 */
public class App {

    public static void main(String[] args) {
        System.out.println("=== Number Processor Demo ===");

        int batchSize = 5;
        int totalBatches = 4;

        for (int batch = 1; batch <= totalBatches; batch++) {
            int from = (batch - 1) * batchSize + 1;
            int to = batch * batchSize;
            System.out.printf("%n--- Batch %d: numbers %d to %d ---%n", batch, from, to);

            List<Integer> numbers = generateNumbers(from, to);
            System.out.println("Generated: " + numbers);

            List<Integer> evenNumbers = filterEven(numbers);
            System.out.println("Even numbers: " + evenNumbers);

            List<Integer> squared = square(evenNumbers);
            System.out.println("Squared: " + squared);

            int sum = sum(squared);
            System.out.println("Sum: " + sum);

            String fizzBuzzResult = fizzBuzzRange(from, to);
            System.out.println("FizzBuzz: " + fizzBuzzResult);

            // Pause between batches to allow debugging
            if (batch < totalBatches) {
                try {
                    Thread.sleep(2000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        System.out.println("\nAll batches processed. Done!");
    }

    static List<Integer> generateNumbers(int from, int to) {
        List<Integer> list = new ArrayList<>();
        for (int i = from; i <= to; i++) {
            list.add(i);
        }
        return list;
    }

    static List<Integer> filterEven(List<Integer> numbers) {
        return numbers.stream()
                .filter(n -> n % 2 == 0)
                .collect(Collectors.toList());
    }

    static List<Integer> square(List<Integer> numbers) {
        return numbers.stream()
                .map(n -> n * n)
                .collect(Collectors.toList());
    }

    static int sum(List<Integer> numbers) {
        return numbers.stream()
                .mapToInt(Integer::intValue)
                .sum();
    }

    static double average(List<Integer> numbers) {
        return numbers.stream()
                .mapToInt(Integer::intValue)
                .average()
                .orElse(0.0);
    }

    static String fizzBuzz(int n) {
        if (n % 15 == 0) return "FizzBuzz";
        if (n % 3 == 0) return "Fizz";
        if (n % 5 == 0) return "Buzz";
        return String.valueOf(n);
    }

    static String fizzBuzzRange(int from, int to) {
        List<String> results = new ArrayList<>();
        for (int i = from; i <= to; i++) {
            results.add(fizzBuzz(i));
        }
        return String.join(", ", results);
    }
}
