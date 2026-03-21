# Example Projects

Sample projects for demonstrating [jvm-debug-mcp](https://github.com/riku-kano/jvm-debug-mcp) capabilities.

## Projects

| Project | Stack | Build System | Description |
|---------|-------|-------------|-------------|
| [spring-boot-kotlin](./spring-boot-kotlin/) | Spring Boot + Kotlin | Gradle (Kotlin DSL) | REST API with greeting service |
| [spring-boot-java](./spring-boot-java/) | Spring Boot + Java | Gradle (Kotlin DSL) | REST API with task management |
| [java-cli-gradle](./java-cli-gradle/) | Plain Java | Gradle (Kotlin DSL) | CLI app with number processing |

## Prerequisites

- Java 21+
- [jvm-debug-mcp](https://github.com/riku-kano/jvm-debug-mcp) installed and configured as an MCP server

## Quick Start

Each project can be launched and debugged using the MCP tools:

```
1. detect_project({ projectDir: "/path/to/example/spring-boot-kotlin" })
2. launch({ projectDir: "/path/to/example/spring-boot-kotlin" })
3. connect({ host: "localhost", port: 5005 })
4. set_breakpoint({ className: "com.example.demo.service.GreetingService", line: 35 })
5. // Send a request to the API, then inspect variables, step through code, etc.
```

See each project's README for detailed debugging walkthrough.
