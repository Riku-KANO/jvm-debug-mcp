# JVM Debug MCP

MCP server for debugging Java/Kotlin applications via JDWP (Java Debug Wire Protocol).

Enables AI assistants (Claude, etc.) to set breakpoints, step through code, inspect variables, and control multi-threaded Java/Kotlin applications — all through the [Model Context Protocol](https://modelcontextprotocol.io/).

**[Documentation (EN)](https://riku-kano.github.io/jvm-debug-mcp/en/)** | **[ドキュメント (JA)](https://riku-kano.github.io/jvm-debug-mcp/ja/)**

## Features

- **Breakpoint debugging** — Set breakpoints by class and line, step over/into/out, resume
- **Multi-thread support** — Per-thread suspend, resume, and step (independent thread control)
- **Variable inspection** — Local variables, object fields, array elements, string values
- **Build system integration** — Auto-detect and launch Gradle / Maven / Spring Boot projects
- **22 MCP tools** — Full debug workflow from project detection to variable inspection

## Prerequisites

- **Node.js** 18+
- **Java JDK** 11+ (for the target application)
- Gradle or Maven (optional, for build system integration)

## Setup

```bash
git clone https://github.com/Riku-KANO/jvm-debug-mcp.git
cd jvm-debug-mcp
pnpm install
```

`pnpm install` automatically runs the build via the `prepare` script.

## MCP Client Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jvm-debug": {
      "command": "node",
      "args": ["/absolute/path/to/jvm-debug-mcp/dist/index.js"]
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project or `~/.claude/.mcp.json` globally:

```json
{
  "mcpServers": {
    "jvm-debug": {
      "command": "node",
      "args": ["/absolute/path/to/jvm-debug-mcp/dist/index.js"]
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client can use this server. Set the command to `node` and the argument to the absolute path of `dist/index.js`.

## Quick Start

### Option A: Launch a project with debug

```
1. detect_project({ projectDir: "/path/to/project" })
2. launch({ projectDir: "/path/to/project" })       // builds & starts with JDWP on port 5005, verifies port is connectable
3. connect({ host: "localhost", port: 5005 })
4. set_breakpoint({ className: "com.example.MyClass", line: 25 })
5. get_stack_trace({})
6. get_variables({})
```

### Option B: Attach to a running JVM

Start your app with JDWP enabled:

```bash
java -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 -jar app.jar
```

Then connect via the MCP tool:

```
connect({ host: "localhost", port: 5005 })
```

## MCP Tools

| Category        | Tools                                                                                |
| --------------- | ------------------------------------------------------------------------------------ |
| **Project**     | `detect_project`, `build`, `launch` (with JDWP port verification), `stop`, `process_output` |
| **Connection**  | `connect`, `disconnect`                                                              |
| **Breakpoints** | `set_breakpoint`, `remove_breakpoint`, `list_breakpoints`                            |
| **Execution**   | `resume`, `pause`, `step_over`, `step_into`, `step_out`                              |
| **Inspection**  | `get_stack_trace`, `get_variables`, `inspect_object`, `inspect_array`, `get_threads` |
| **Status**      | `get_events`, `status`                                                               |

## Build System Support

| Build System    | Detection          | Default Task                    | Spring Boot   |
| --------------- | ------------------ | ------------------------------- | ------------- |
| Gradle (Groovy) | `build.gradle`     | `run` / `bootRun`               | Auto-detected |
| Gradle (Kotlin) | `build.gradle.kts` | `run` / `bootRun`               | Auto-detected |
| Maven           | `pom.xml`          | `exec:java` / `spring-boot:run` | Auto-detected |

## Development

```bash
pnpm run check    # TypeScript + ESLint + Prettier + Vitest
pnpm run lint     # ESLint only
pnpm run test     # Vitest only
pnpm run build    # TypeScript compile
```

## Architecture

```
AI Assistant  ←── MCP (stdio) ──→  JVM Debug MCP Server  ←── JDWP (TCP) ──→  Target JVM
```

The server implements JDWP directly over TCP (no JDI dependency), running in pure Node.js.

## License

MIT
