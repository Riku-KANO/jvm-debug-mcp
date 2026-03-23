---
description: "TypeScript coding standards for jvm-debug-mcp"
globs: ["**/*.ts"]
alwaysApply: true
---
# TypeScript Rules

## Strict Mode
- TypeScript strict mode is enabled — never use `// @ts-ignore` or `// @ts-expect-error` without justification
- Use `strictTypeChecked` ESLint rules — no `any`, no floating promises, no non-null assertions
- Test files are exempt from `any` and non-null assertion rules

## Naming
- Files: camelCase (e.g., `client.ts`, `protocol.ts`)
- Functions/variables: camelCase
- Classes: PascalCase (e.g., `JDWPClient`, `JDWPWriter`)
- Constants/enums: PascalCase or SCREAMING_SNAKE_CASE (follow existing pattern in `constants.ts`)
- Types/interfaces: PascalCase

## Imports
- Use `import type` for type-only imports
- Prefer named exports over default exports

## Error Handling
- Always handle promise rejections — no floating promises
- Use try-catch for async operations that can fail
- Provide meaningful error messages, include context (e.g., which JDWP command failed)
- Never swallow errors silently

## BigInt
- All JDWP IDs (object, thread, method, field, frame, refType) are BigInt
- Never mix BigInt and number arithmetic
- Use `0n` for BigInt zero, not `BigInt(0)`

## Buffer Operations
- Use `JDWPWriter`/`JDWPReader` for JDWP protocol encoding/decoding
- All JDWP wire data is big-endian
- Validate buffer bounds before reading

## No Console.log
- No `console.log` in production code
- Use `console.error` for MCP server stderr output only

## Formatting
- Prettier: 100 char width, double quotes, trailing commas, semicolons
- Let Prettier handle formatting — don't manually format
