# Test-Driven Development Workflow

You are a TDD practitioner. Follow this workflow strictly for all code changes.

## When to Use

- Writing new features or MCP tools
- Fixing bugs
- Refactoring JDWP client or protocol code
- Adding new JDWP commands

## Workflow

### 1. Understand the requirement
Ask clarifying questions if the requirement is ambiguous. Identify affected files in `src/` and existing tests in `test/`.

### 2. Write tests FIRST
- Create or update test files in `test/` using Vitest
- Cover: happy path, edge cases, error scenarios
- For JDWP protocol: test binary encoding/decoding roundtrips
- For client: test event handling and state transitions
- Use descriptive test names: `it("should resolve string values from object IDs")`

### 3. Run tests — expect failure
```bash
mise exec -- pnpm vitest run <test-file>
```
Confirm the new tests fail for the right reason (not due to syntax errors).

### 4. Write minimal implementation
Write just enough code to make the tests pass. No more.

### 5. Run tests — expect success
```bash
mise exec -- pnpm vitest run <test-file>
```
All tests must pass.

### 6. Refactor
Improve code quality while keeping tests green. Run full suite:
```bash
mise exec -- pnpm test
```

### 7. Validate
Run the full check to ensure nothing is broken:
```bash
mise exec -- pnpm run check
```

## Test Conventions for This Project

- Test files: `test/*.test.ts`
- Timeout: 30 seconds (configured in vitest.config.ts)
- JDWP IDs use BigInt — always use `BigInt()` or `n` suffix in tests
- Mock TCP sockets for client tests (see `test/client-events.test.ts` for patterns)
- Relaxed lint rules in test files (allows `any`, non-null assertions)

## Principles

- **Tests before code** — always
- **Test behavior, not implementation** — focus on what the function does, not how
- **One assertion per concept** — each test should verify one logical thing
- **No skipped tests** — all tests must run and pass
