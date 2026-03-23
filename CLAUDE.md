# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JVM Debug MCP is a Model Context Protocol (MCP) server that enables AI assistants to debug Java/Kotlin applications via JDWP (Java Debug Wire Protocol). It implements the JDWP binary protocol directly over TCP using pure Node.js — no JDI dependency.

## Build & Development Commands

The project uses pnpm. The user has mise configured (`mise.toml`), so use `mise exec --` prefix for build/test commands.

```bash
mise exec -- pnpm install        # Install dependencies (also runs tsc via prepare script)
mise exec -- pnpm run build      # TypeScript compilation to dist/
mise exec -- pnpm test           # Run vitest (unit tests)
mise exec -- pnpm test:watch     # Vitest in watch mode
mise exec -- pnpm run lint       # ESLint check
mise exec -- pnpm run lint:fix   # ESLint auto-fix
mise exec -- pnpm run format     # Prettier format
mise exec -- pnpm run check      # Full validation: tsc + eslint + prettier + vitest
```

To run a single test file:
```bash
mise exec -- pnpm vitest run test/protocol.test.ts
```

## Architecture

```
AI Assistant ──stdio (MCP)──▶ MCP Server (index.ts) ──TCP (JDWP)──▶ Target JVM
```

### Source files (src/)

- **`index.ts`** — MCP server entry point. Registers 17 MCP tools (connect, breakpoints, stepping, inspection, etc.). Manages event log and session state via EventEmitter.
- **`jdwp/client.ts`** — High-level JDWP client (`JDWPClient extends EventEmitter`). Handles connection handshake, thread control, breakpoints (including deferred breakpoints via ClassPrepare events), stepping, variable/object inspection, and string value resolution.
- **`jdwp/protocol.ts`** — Binary wire protocol: `JDWPWriter`/`JDWPReader` for encoding/decoding big-endian JDWP packets with variable-size IDs.
- **`jdwp/constants.ts`** — JDWP specification enums: CommandSet, EventKind, Tag, ThreadStatus, StepDepth, ModKind, error codes, etc.

### Key design details

- JDWP IDs (object, thread, method, field, frame, refType) use BigInt throughout due to variable sizing (2-8 bytes).
- Breakpoints on not-yet-loaded classes are queued and set automatically when a ClassPrepare event fires.
- String object values are resolved automatically via StringReference command rather than showing raw object IDs.
- Pending JDWP commands have a 10-second timeout.

### Tests (test/)

Unit tests use Vitest (30s timeout). Two test files with automated tests:
- `test/protocol.test.ts` — JDWPWriter/Reader roundtrips, packet functions
- `test/client-events.test.ts` — JDWPClient event handling

Manual integration tests (`test-client.ts`, `test-multithread.ts`) require a running JVM.

## Code Style

- **TypeScript strict mode** with `strictTypeChecked` ESLint rules
- **Prettier**: 100 char width, double quotes, trailing commas, semicolons
- **ESLint enforces**: no `any`, no floating promises, no non-null assertions, consistent type imports
- Test files have relaxed lint rules (allows `any`, non-null assertions)
