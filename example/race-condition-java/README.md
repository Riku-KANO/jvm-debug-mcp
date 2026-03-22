# Race Condition Demo

Two threads increment a shared counter without synchronization.
Use the MCP debugger to observe the race condition in real time.

## Debugging Walkthrough

```
1. detect_project({ projectDir: ".../example/race-condition-java" })
2. launch({ projectDir: ".../example/race-condition-java" })
3. connect({ host: "localhost", port: 5005 })

4. set_breakpoint({ className: "com.example.race.App", line: 72 })
   -- Breaks when either thread reads sharedCounter

5. (Wait for a breakpoint hit)

6. get_threads()
   -- Find Worker-A and Worker-B threads

7. get_variables()
   -- Inspect "current" to see the stale read

8. resume() then wait for the other thread to hit the same breakpoint

9. get_variables()
   -- Both threads may have the same "current" value = lost update

10. step_over() / resume() to continue
11. process_output() to see race condition reports
```

## Key Lines

| Line | What happens |
|------|-------------|
| 72   | `int current = sharedCounter` -- READ (may be stale) |
| 73   | `current = current + 1` -- local increment |
| 74   | `sharedCounter = current` -- WRITE (may overwrite) |
| 58   | `reportResult(...)` -- prints OK or RACE DETECTED |
