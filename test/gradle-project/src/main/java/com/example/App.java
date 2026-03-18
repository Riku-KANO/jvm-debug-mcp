package com.example;

public class App {
    public static void main(String[] args) throws InterruptedException {
        System.out.println("Gradle app started!");
        int counter = 0;
        while (true) {
            counter++;
            String msg = greet("World", counter);
            System.out.println(msg);
            Thread.sleep(2000);
        }
    }

    static String greet(String name, int n) {
        String greeting = "Hello, " + name + " #" + n;
        return greeting;
    }
}
