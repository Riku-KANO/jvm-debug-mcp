#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JDWPClient, formatValue } from "./jdwp/client.js";
import { ThreadStatus } from "./jdwp/constants.js";

const client = new JDWPClient();

// Event log for breakpoint hits, steps, etc.
let eventLog: string[] = [];
const MAX_EVENT_LOG = 50;

function addEvent(msg: string) {
  const timestamp = new Date().toISOString().substring(11, 23);
  eventLog.push(`[${timestamp}] ${msg}`);
  if (eventLog.length > MAX_EVENT_LOG) {
    eventLog = eventLog.slice(-MAX_EVENT_LOG);
  }
}

// Set up event listeners
client.on(
  "breakpoint",
  (ev: {
    requestId: number;
    threadId: bigint;
    location: { classID: bigint; methodID: bigint; index: bigint };
  }) => {
    const bp = client.getBreakpoints().find((b) => b.requestId === ev.requestId);
    const desc = bp ? `${bp.className}:${bp.line}` : `request#${ev.requestId}`;
    addEvent(`Breakpoint hit: ${desc} (thread=${ev.threadId})`);
  },
);

client.on(
  "step",
  (ev: { threadId: bigint; location: { classID: bigint; methodID: bigint; index: bigint } }) => {
    addEvent(`Step completed (thread=${ev.threadId})`);
  },
);

client.on("vmdeath", () => {
  addEvent("VM terminated");
});

client.on("close", () => {
  addEvent("Connection closed");
});

// Create MCP server
const server = new McpServer({
  name: "jvm-debug",
  version: "1.0.0",
});

function resolveThreadId(threadId: string | undefined): bigint | null {
  if (threadId) {
    return BigInt(threadId);
  }
  return client.currentThreadId;
}

// --- Shared tool response helpers ---

type ToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean };

function toolResult(text: string, isError?: boolean): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wraps an async tool handler that requires a connected JVM.
 * Handles the common `isConnected` guard and try/catch error formatting.
 */
function connectedHandler<T>(
  fn: (args: T) => Promise<ToolResult>,
): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    if (!client.isConnected) {
      return toolResult("Not connected to JVM.", true);
    }
    try {
      return await fn(args);
    } catch (err) {
      return toolResult(`Failed: ${formatError(err)}`, true);
    }
  };
}

/**
 * Creates a step tool handler (step over/into/out share identical logic).
 */
function stepHandler(
  direction: string,
  stepFn: (threadId: bigint) => Promise<void>,
): (args: { threadId?: string }) => Promise<ToolResult> {
  return connectedHandler(async ({ threadId }: { threadId?: string }) => {
    const tid = resolveThreadId(threadId);
    if (tid === null) {
      return toolResult(
        "No suspended thread. Hit a breakpoint first or specify a thread ID.",
        true,
      );
    }
    await stepFn(tid);
    const others = client.allSuspendedThreadIds.filter((id) => id !== tid);
    const suffix =
      others.length > 0 ? `\nOther suspended threads: ${others.map(String).join(", ")}` : "";
    return toolResult(`Stepping ${direction} thread ${tid}...${suffix}`);
  });
}

// --- Tool: connect ---
server.registerTool(
  "connect",
  {
    description:
      "Connect to a JVM running with JDWP debug agent. The target JVM must be started with: -agentlib:jdwp=transport=dt_socket,server=y,address=<port>. " +
      "If the JVM was launched with suspend=y, it will remain suspended after connect so you can set breakpoints before resuming.",
    inputSchema: {
      host: z.string().default("localhost").describe("Host to connect to"),
      port: z.number().describe("JDWP debug port"),
    },
  },
  async ({ host, port }) => {
    if (client.isConnected) {
      return toolResult("Already connected. Use 'disconnect' first.");
    }
    try {
      const version = await client.connect(host, port);
      addEvent(`Connected to ${host}:${port}`);
      const lines = [`Connected to JVM at ${host}:${port}`, version];
      if (client.vmSuspended) {
        lines.push(
          "",
          "VM is suspended (launched with suspend=y).",
          "You can set breakpoints now, then use 'resume' to start execution.",
        );
        addEvent("VM is suspended (suspend=y) — waiting for breakpoints before resume");
      }
      return toolResult(lines.join("\n"));
    } catch (err) {
      return toolResult(`Failed to connect: ${formatError(err)}`, true);
    }
  },
);

// --- Tool: disconnect ---
server.registerTool(
  "disconnect",
  { description: "Disconnect from the JVM debug session" },
  async () => {
    if (!client.isConnected) {
      return toolResult("Not connected.");
    }
    await client.disconnect();
    addEvent("Disconnected");
    return toolResult("Disconnected from JVM.");
  },
);

// --- Tool: set_breakpoint ---
server.registerTool(
  "set_breakpoint",
  {
    description:
      "Set a breakpoint at a specific class and line number, or at the entry of a method. " +
      "Use fully qualified class name (e.g., com.example.MyClass). " +
      "Specify either 'line' (line number) or 'method' (method name) to set the breakpoint location. " +
      "When 'method' is specified, the breakpoint is set at the first executable line of that method. " +
      "suspendPolicy controls what happens when the breakpoint hits: 'thread' (default) suspends only the hitting thread " +
      "(other threads keep running - ideal for multi-thread debugging), 'all' suspends all threads.",
    inputSchema: {
      className: z.string().describe("Fully qualified class name (e.g., com.example.MyClass)"),
      line: z.number().optional().describe("Line number to set breakpoint at"),
      method: z
        .string()
        .optional()
        .describe(
          "Method name to set breakpoint at (sets breakpoint at the first line of the method)",
        ),
      suspendPolicy: z
        .enum(["thread", "all"])
        .default("thread")
        .describe(
          "'thread' = only suspend the hitting thread (default, best for multi-thread debugging), 'all' = suspend all threads",
        ),
    },
  },
  async ({ className, line, method, suspendPolicy }) => {
    if (!client.isConnected) {
      return toolResult("Not connected to JVM.", true);
    }
    if (line === undefined && method === undefined) {
      return toolResult("Either 'line' or 'method' must be specified.", true);
    }
    try {
      let bp;
      if (method !== undefined) {
        bp = await client.setBreakpointByMethod(className, method, suspendPolicy);
        addEvent(
          `Breakpoint set: ${className}.${method}() (line ${bp.line}, id=${bp.requestId}, suspend=${suspendPolicy})`,
        );
      } else {
        bp = await client.setBreakpoint(className, line!, suspendPolicy);
        addEvent(
          `Breakpoint set: ${className}:${line} (id=${bp.requestId}, suspend=${suspendPolicy})`,
        );
      }
      return toolResult(
        `Breakpoint set at ${className}:${bp.line}${method ? ` (method: ${method})` : ""} (id=${bp.requestId}, suspendPolicy=${suspendPolicy})`,
      );
    } catch (err) {
      return toolResult(`Failed to set breakpoint: ${formatError(err)}`, true);
    }
  },
);

// --- Tool: remove_breakpoint ---
server.registerTool(
  "remove_breakpoint",
  {
    description: "Remove a breakpoint by its ID",
    inputSchema: {
      breakpointId: z.number().describe("Breakpoint request ID to remove"),
    },
  },
  connectedHandler(async ({ breakpointId }) => {
    await client.removeBreakpoint(breakpointId);
    addEvent(`Breakpoint removed: id=${breakpointId}`);
    return toolResult(`Breakpoint ${breakpointId} removed.`);
  }),
);

// --- Tool: list_breakpoints ---
server.registerTool("list_breakpoints", { description: "List all active breakpoints" }, () => {
  if (!client.isConnected) {
    return toolResult("Not connected to JVM.", true);
  }
  const bps = client.getBreakpoints();
  if (bps.length === 0) {
    return toolResult("No breakpoints set.");
  }
  const lines = bps.map(
    (bp) => `  [${bp.requestId}] ${bp.className}:${bp.line} (suspend=${bp.suspendPolicy})`,
  );
  return toolResult(`Active breakpoints:\n${lines.join("\n")}`);
});

// --- Tool: resume ---
server.registerTool(
  "resume",
  {
    description:
      "Resume execution. By default resumes ALL threads. Specify threadId to resume only a specific thread (leaving other suspended threads paused).",
    inputSchema: {
      threadId: z
        .string()
        .optional()
        .describe("Thread ID to resume (decimal string). If omitted, resumes ALL threads."),
    },
  },
  connectedHandler(async ({ threadId }) => {
    if (threadId) {
      const tid = BigInt(threadId);
      await client.resumeThread(tid);
      addEvent(`Thread ${tid} resumed`);
      const remaining = client.allSuspendedThreadIds;
      const suffix =
        remaining.length > 0
          ? `\nStill suspended: ${remaining.map((id) => String(id)).join(", ")}`
          : "\nNo other suspended threads.";
      return toolResult(`Thread ${tid} resumed.${suffix}`);
    } else {
      await client.resumeVM();
      addEvent("VM resumed (all threads)");
      return toolResult("All threads resumed.");
    }
  }),
);

// --- Tool: pause ---
server.registerTool(
  "pause",
  { description: "Suspend (pause) all threads in the JVM" },
  connectedHandler(async () => {
    await client.suspendVM();
    addEvent("VM suspended");
    return toolResult("VM suspended. All threads paused.");
  }),
);

// --- Tool: step_over ---
server.registerTool(
  "step_over",
  {
    description:
      "Step over the current line (execute current line and stop at next line in the same method)",
    inputSchema: {
      threadId: z
        .string()
        .optional()
        .describe(
          "Thread ID (decimal string). Uses the thread that hit the last breakpoint if omitted.",
        ),
    },
  },
  stepHandler("over", (tid) => client.stepOver(tid)),
);

// --- Tool: step_into ---
server.registerTool(
  "step_into",
  {
    description: "Step into the current line (enter method call if present)",
    inputSchema: {
      threadId: z
        .string()
        .optional()
        .describe(
          "Thread ID (decimal string). Uses the thread that hit the last breakpoint if omitted.",
        ),
    },
  },
  stepHandler("into", (tid) => client.stepInto(tid)),
);

// --- Tool: step_out ---
server.registerTool(
  "step_out",
  {
    description: "Step out of the current method (continue until returning to the caller)",
    inputSchema: {
      threadId: z
        .string()
        .optional()
        .describe(
          "Thread ID (decimal string). Uses the thread that hit the last breakpoint if omitted.",
        ),
    },
  },
  stepHandler("out of", (tid) => client.stepOut(tid)),
);

// --- Tool: get_stack_trace ---
server.registerTool(
  "get_stack_trace",
  {
    description: "Get the stack trace of a suspended thread",
    inputSchema: {
      threadId: z
        .string()
        .optional()
        .describe(
          "Thread ID (decimal string). Uses the thread that hit the last breakpoint if omitted.",
        ),
      maxFrames: z.number().default(20).describe("Maximum number of frames to return"),
    },
  },
  connectedHandler(async ({ threadId, maxFrames }) => {
    const tid = resolveThreadId(threadId);
    if (tid === null) {
      return toolResult("No suspended thread.", true);
    }
    const frames = await client.getFrames(tid, 0, maxFrames);
    if (frames.length === 0) {
      return toolResult("No stack frames.");
    }
    const lines = frames.map((f, i) => {
      const cls = f.className ?? "<unknown>";
      const method = f.methodName ?? "<unknown>";
      const line = f.lineNumber !== undefined ? `:${f.lineNumber}` : "";
      const marker = i === 0 ? " <-- current" : "";
      return `  #${i} ${cls}.${method}(${line})${marker}`;
    });
    return toolResult(`Stack trace (thread=${tid}):\n${lines.join("\n")}`);
  }),
);

// --- Tool: get_variables ---
server.registerTool(
  "get_variables",
  {
    description:
      "Get local variables and their values in the current stack frame of a suspended thread",
    inputSchema: {
      threadId: z
        .string()
        .optional()
        .describe(
          "Thread ID (decimal string). Uses the thread that hit the last breakpoint if omitted.",
        ),
      frameIndex: z.number().default(0).describe("Frame index (0 = top/current frame)"),
    },
  },
  connectedHandler(async ({ threadId, frameIndex }) => {
    const tid = resolveThreadId(threadId);
    if (tid === null) {
      return toolResult("No suspended thread.", true);
    }
    const frames = await client.getFrames(tid, 0, frameIndex + 1);
    if (frames.length <= frameIndex) {
      return toolResult(`Frame index ${frameIndex} out of range.`, true);
    }
    const frame = frames[frameIndex];
    const variables = await client.getFrameVariables(tid, frame.frameId, frame.location);

    if (variables.length === 0) {
      return toolResult(
        `No local variables visible at ${frame.className}.${frame.methodName}:${frame.lineNumber}\n(Class may be compiled without debug info)`,
      );
    }

    const lines = variables.map((v) => {
      const sig = simplifySignature(v.signature);
      const valueStr = v.stringValue !== undefined ? `"${v.stringValue}"` : formatValue(v.tag, v.value);
      return `  ${sig} ${v.name} = ${valueStr}`;
    });

    const loc = `${frame.className}.${frame.methodName}:${frame.lineNumber}`;
    return toolResult(`Variables at ${loc} (frame #${frameIndex}):\n${lines.join("\n")}`);
  }),
);

// --- Tool: inspect_object ---
server.registerTool(
  "inspect_object",
  {
    description:
      "Inspect the fields of an object by its object ID (shown in variable values as Object@<id>)",
    inputSchema: {
      objectId: z.string().describe("Object ID (decimal string, from variable inspection)"),
    },
  },
  connectedHandler(async ({ objectId }) => {
    const oid = BigInt(objectId);
    const fields = await client.getObjectFields(oid);
    if (fields.length === 0) {
      return toolResult("No fields found.");
    }
    const lines = fields.map((f) => {
      const sig = simplifySignature(f.signature);
      return `  ${sig} ${f.name} = ${f.value}`;
    });
    return toolResult(`Object@${objectId} fields:\n${lines.join("\n")}`);
  }),
);

// --- Tool: inspect_array ---
server.registerTool(
  "inspect_array",
  {
    description: "Inspect the elements of an array by its object ID",
    inputSchema: {
      arrayId: z.string().describe("Array object ID (decimal string)"),
      startIndex: z.number().default(0).describe("Start index"),
      length: z.number().optional().describe("Number of elements to read (default: up to 100)"),
    },
  },
  connectedHandler(async ({ arrayId, startIndex, length }) => {
    const result = await client.getArrayValues(BigInt(arrayId), startIndex, length);
    return toolResult(`Array@${arrayId}: ${result}`);
  }),
);

// --- Tool: get_threads ---
server.registerTool(
  "get_threads",
  { description: "List all threads in the JVM with their status" },
  connectedHandler(async () => {
    const threads = await client.getAllThreads();
    const suspendedIds = new Set(client.allSuspendedThreadIds);
    const lines = threads.map((t) => {
      const statusName = getThreadStatusName(t.status);
      const suspended = t.suspendStatus === 1 ? " [SUSPENDED]" : "";
      const atBreakpoint = suspendedIds.has(t.id) ? " *** BREAKPOINT/STEP ***" : "";
      const current = t.id === client.currentThreadId ? " <-- current" : "";
      return `  [${t.id}] ${t.name} (${statusName})${suspended}${atBreakpoint}${current}`;
    });
    return toolResult(`Threads (${threads.length}):\n${lines.join("\n")}`);
  }),
);

// --- Tool: get_events ---
server.registerTool(
  "get_events",
  { description: "Get the recent debug event log (breakpoint hits, steps, etc.)" },
  () => {
    if (eventLog.length === 0) {
      return toolResult("No events recorded.");
    }
    return toolResult(`Recent events:\n${eventLog.join("\n")}`);
  },
);

// --- Tool: status ---
server.registerTool("status", { description: "Get the current debug session status" }, () => {
  const connected = client.isConnected;
  const bps = connected ? client.getBreakpoints() : [];
  const suspendedThreads = connected ? client.allSuspendedThreadIds : [];
  const currentThread = client.currentThreadId;

  const vmSuspended = connected ? client.vmSuspended : false;

  const lines = [
    `Debugger connected: ${connected}`,
    `VM suspended: ${vmSuspended}`,
    `Breakpoints: ${bps.length}`,
    `Suspended threads: ${suspendedThreads.length > 0 ? suspendedThreads.map(String).join(", ") : "none"}`,
    `Last active thread: ${currentThread !== null ? String(currentThread) : "none"}`,
    `Recent events: ${eventLog.length}`,
  ];

  if (bps.length > 0) {
    lines.push("\nActive breakpoints:");
    for (const bp of bps) {
      lines.push(`  [${bp.requestId}] ${bp.className}:${bp.line} (suspend=${bp.suspendPolicy})`);
    }
  }

  if (eventLog.length > 0) {
    lines.push(`\nLast event: ${eventLog[eventLog.length - 1]}`);
  }

  return toolResult(lines.join("\n"));
});

// Helper functions

function getThreadStatusName(status: number): string {
  switch (status) {
    case ThreadStatus.Zombie:
      return "zombie";
    case ThreadStatus.Running:
      return "running";
    case ThreadStatus.Sleeping:
      return "sleeping";
    case ThreadStatus.Monitor:
      return "monitor";
    case ThreadStatus.Wait:
      return "wait";
    default:
      return `unknown(${status})`;
  }
}

function simplifySignature(sig: string): string {
  switch (sig) {
    case "B":
      return "byte";
    case "C":
      return "char";
    case "D":
      return "double";
    case "F":
      return "float";
    case "I":
      return "int";
    case "J":
      return "long";
    case "S":
      return "short";
    case "V":
      return "void";
    case "Z":
      return "boolean";
    case "Ljava/lang/String;":
      return "String";
    case "Ljava/lang/Object;":
      return "Object";
    case "Ljava/lang/Integer;":
      return "Integer";
    case "Ljava/lang/Long;":
      return "Long";
    case "Ljava/lang/Boolean;":
      return "Boolean";
    case "Ljava/lang/Double;":
      return "Double";
    default: {
      if (sig.startsWith("[")) return `${simplifySignature(sig.substring(1))}[]`;
      if (sig.startsWith("L") && sig.endsWith(";")) {
        const cls = sig.substring(1, sig.length - 1).replace(/\//g, ".");
        const lastDot = cls.lastIndexOf(".");
        return lastDot >= 0 ? cls.substring(lastDot + 1) : cls;
      }
      return sig;
    }
  }
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
