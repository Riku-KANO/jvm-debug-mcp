---
description: "Security rules for JDWP network communication"
globs: ["src/**/*.ts"]
alwaysApply: true
---
# Security Rules

## No Hardcoded Secrets
```typescript
// NEVER
const password = "secret123"

// ALWAYS
const password = process.env.DEBUG_PASSWORD
```

## Input Validation
- Validate all MCP tool parameters before use
- Validate host/port values before TCP connection
- Never pass user input directly to shell commands

## Network Security
- JDWP connections are unencrypted by design — document this limitation
- Validate JDWP handshake response before proceeding
- Set timeouts on all network operations (current: 10s)
- Close sockets properly on error/disconnect

## Error Messages
- Never expose internal paths or stack traces to MCP clients
- Never include raw JDWP error codes without human-readable context
