---
description: "Testing rules for Vitest"
globs: ["test/**/*.ts"]
alwaysApply: true
---
# Testing Rules

## Framework
- Vitest with 30s timeout
- Test files: `test/*.test.ts`

## Coverage Target
- Aim for 80%+ coverage on new code
- Protocol encoding/decoding must have roundtrip tests
- Event handling must have state transition tests

## Patterns
- Use `describe` blocks to group related tests
- Use `it` with descriptive behavior-focused names
- One logical assertion per test
- Mock TCP sockets for client tests — never connect to real JVMs in unit tests
- Use `BigInt` literals (`1n`, `0n`) for JDWP IDs in tests

## Test Structure
```typescript
describe("FeatureName", () => {
  it("should do expected behavior when given input", () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Forbidden in Tests
- No `test.skip` or `it.skip` — fix or remove
- No `test.only` or `it.only` — never commit focused tests
- No real network connections in unit tests
