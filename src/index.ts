#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JDWPClient, formatValue } from "./jdwp/client.js";
import { ThreadStatus } from "./jdwp/constants.js";
import {
  detectBuildSystem,
  buildProject,
  launchWithDebug,
  stopProcess,
  getProcessOutput,
  getCurrentProcess,
} from "./launcher.js";

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

// --- Tool: detect_project ---
server.registerTool(
  "detect_project",
  {
    description:
      "Detect the build system (Gradle/Maven) in a project directory. Scans for build.gradle, build.gradle.kts, or pom.xml.",
    inputSchema: {
      projectDir: z.string().describe("Path to the project root directory"),
    },
  },
  ({ projectDir }) => {
    const detected = detectBuildSystem(projectDir);
    if (!detected) {
      return {
        content: [
          {
            type: "text",
            text: `No build system detected in ${projectDir}.\nLooked for: build.gradle, build.gradle.kts, pom.xml`,
          },
        ],
      };
    }
    const lines = [
      `Build system: ${detected.buildSystem}`,
      `Project dir: ${detected.projectDir}`,
      `Build files: ${detected.buildFiles.join(", ")}`,
      `Has wrapper: ${detected.hasWrapper}`,
    ];
    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  },
);

// --- Tool: build ---
server.registerTool(
  "build",
  {
    description: "Build a Gradle or Maven project. Runs 'gradle build -x test' or 'mvn compile'.",
    inputSchema: {
      projectDir: z.string().describe("Path to the project root directory"),
      buildSystem: z
        .enum(["gradle", "gradle-kts", "maven"])
        .optional()
        .describe("Build system (auto-detected if omitted)"),
    },
  },
  async ({ projectDir, buildSystem }) => {
    addEvent(`Building project: ${projectDir}`);
    const result = await buildProject(projectDir, buildSystem);
    addEvent(`Build ${result.success ? "succeeded" : "failed"}: ${result.buildSystem}`);
    return {
      content: [
        {
          type: "text",
          text: result.success
            ? `Build successful (${result.buildSystem})${result.output ? `\n${result.output}` : ""}`
            : `Build failed (${result.buildSystem}):\n${result.output}`,
        },
      ],
      isError: !result.success,
    };
  },
);

// --- Tool: launch ---
server.registerTool(
  "launch",
  {
    description:
      "Build and launch a Gradle/Maven project with JDWP debug agent enabled. " +
      "Auto-detects build system and configures debug flags. After launch, use 'connect' to attach the debugger. " +
      "Supported: Gradle (run, bootRun), Maven (spring-boot:run, exec:java).",
    inputSchema: {
      projectDir: z.string().describe("Path to the project root directory"),
      task: z
        .string()
        .optional()
        .describe(
          "Run task (e.g., 'bootRun', 'run', 'spring-boot:run', 'exec:java'). Auto-detected if omitted.",
        ),
      buildSystem: z
        .enum(["gradle", "gradle-kts", "maven"])
        .optional()
        .describe("Build system (auto-detected if omitted)"),
      port: z.number().default(5005).describe("JDWP debug port (default: 5005)"),
      suspend: z
        .boolean()
        .default(false)
        .describe("Suspend JVM on start, waiting for debugger to connect (default: false)"),
      jvmArgs: z.array(z.string()).default([]).describe("Additional JVM arguments"),
      args: z.array(z.string()).default([]).describe("Application arguments"),
      buildFirst: z.boolean().default(true).describe("Build before running (default: true)"),
    },
  },
  async ({ projectDir, task, buildSystem, port, suspend, jvmArgs, args, buildFirst }) => {
    addEvent(`Launching project: ${projectDir} (port=${port})`);
    const result = await launchWithDebug({
      projectDir,
      task,
      buildSystem,
      port,
      suspend,
      jvmArgs,
      args,
      buildFirst,
    });
    addEvent(
      `Launch ${result.success ? "succeeded" : "failed"}: ${result.buildSystem} ${result.task}`,
    );
    return {
      content: [{ type: "text", text: result.message }],
      isError: !result.success,
    };
  },
);

// --- Tool: stop ---
server.registerTool(
  "stop",
  { description: "Stop the currently launched debug target process" },
  async () => {
    const result = stopProcess();
    if (result.stopped) {
      addEvent("Target process stopped");
      if (client.isConnected) {
        try {
          await client.disconnect();
        } catch {
          /* ignore */
        }
        addEvent("Debugger disconnected");
      }
    }
    return { content: [{ type: "text", text: result.message }] };
  },
);

// --- Tool: process_output ---
server.registerTool(
  "process_output",
  {
    description: "Get recent stdout/stderr output from the launched process",
    inputSchema: {
      lines: z.number().default(50).describe("Number of recent lines to return"),
    },
  },
  ({ lines: lineCount }) => {
    const proc = getCurrentProcess();
    if (!proc) {
      return { content: [{ type: "text", text: "No launched process." }] };
    }
    const output = getProcessOutput(lineCount);
    if (output.length === 0) {
      return { content: [{ type: "text", text: "No output yet." }] };
    }
    const alive = !proc.process.killed && proc.process.exitCode === null;
    const header = `Process (PID=${String(proc.pid)}, ${alive ? "running" : "exited"}, ${proc.buildSystem} ${proc.task}):`;
    return {
      content: [{ type: "text", text: `${header}\n${output.join("\n")}` }],
    };
  },
);

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
      return { content: [{ type: "text", text: "Already connected. Use 'disconnect' first." }] };
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
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: disconnect ---
server.registerTool(
  "disconnect",
  { description: "Disconnect from the JVM debug session" },
  async () => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected." }] };
    }
    await client.disconnect();
    addEvent("Disconnected");
    return { content: [{ type: "text", text: "Disconnected from JVM." }] };
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
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    if (line === undefined && method === undefined) {
      return {
        content: [
          { type: "text", text: "Either 'line' or 'method' must be specified." },
        ],
        isError: true,
      };
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
      return {
        content: [
          {
            type: "text",
            text: `Breakpoint set at ${className}:${bp.line}${method ? ` (method: ${method})` : ""} (id=${bp.requestId}, suspendPolicy=${suspendPolicy})`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to set breakpoint: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
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
  async ({ breakpointId }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    try {
      await client.removeBreakpoint(breakpointId);
      addEvent(`Breakpoint removed: id=${breakpointId}`);
      return { content: [{ type: "text", text: `Breakpoint ${breakpointId} removed.` }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to remove breakpoint: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: list_breakpoints ---
server.registerTool("list_breakpoints", { description: "List all active breakpoints" }, () => {
  if (!client.isConnected) {
    return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
  }
  const bps = client.getBreakpoints();
  if (bps.length === 0) {
    return { content: [{ type: "text", text: "No breakpoints set." }] };
  }
  const lines = bps.map(
    (bp) => `  [${bp.requestId}] ${bp.className}:${bp.line} (suspend=${bp.suspendPolicy})`,
  );
  return {
    content: [{ type: "text", text: `Active breakpoints:\n${lines.join("\n")}` }],
  };
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
  async ({ threadId }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    try {
      if (threadId) {
        const tid = BigInt(threadId);
        await client.resumeThread(tid);
        addEvent(`Thread ${tid} resumed`);
        const remaining = client.allSuspendedThreadIds;
        const suffix =
          remaining.length > 0
            ? `\nStill suspended: ${remaining.map((id) => String(id)).join(", ")}`
            : "\nNo other suspended threads.";
        return { content: [{ type: "text", text: `Thread ${tid} resumed.${suffix}` }] };
      } else {
        await client.resumeVM();
        addEvent("VM resumed (all threads)");
        return { content: [{ type: "text", text: "All threads resumed." }] };
      }
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to resume: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: pause ---
server.registerTool(
  "pause",
  { description: "Suspend (pause) all threads in the JVM" },
  async () => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    try {
      await client.suspendVM();
      addEvent("VM suspended");
      return { content: [{ type: "text", text: "VM suspended. All threads paused." }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to suspend: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
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
  async ({ threadId }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    const tid = resolveThreadId(threadId);
    if (tid === null) {
      return {
        content: [
          {
            type: "text",
            text: "No suspended thread. Hit a breakpoint first or specify a thread ID.",
          },
        ],
        isError: true,
      };
    }
    try {
      await client.stepOver(tid);
      const others = client.allSuspendedThreadIds.filter((id) => id !== tid);
      const suffix =
        others.length > 0 ? `\nOther suspended threads: ${others.map(String).join(", ")}` : "";
      return { content: [{ type: "text", text: `Stepping over thread ${tid}...${suffix}` }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Step failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
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
  async ({ threadId }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    const tid = resolveThreadId(threadId);
    if (tid === null) {
      return { content: [{ type: "text", text: "No suspended thread." }], isError: true };
    }
    try {
      await client.stepInto(tid);
      const others = client.allSuspendedThreadIds.filter((id) => id !== tid);
      const suffix =
        others.length > 0 ? `\nOther suspended threads: ${others.map(String).join(", ")}` : "";
      return { content: [{ type: "text", text: `Stepping into thread ${tid}...${suffix}` }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Step failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
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
  async ({ threadId }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    const tid = resolveThreadId(threadId);
    if (tid === null) {
      return { content: [{ type: "text", text: "No suspended thread." }], isError: true };
    }
    try {
      await client.stepOut(tid);
      const others = client.allSuspendedThreadIds.filter((id) => id !== tid);
      const suffix =
        others.length > 0 ? `\nOther suspended threads: ${others.map(String).join(", ")}` : "";
      return { content: [{ type: "text", text: `Stepping out of thread ${tid}...${suffix}` }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Step failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
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
  async ({ threadId, maxFrames }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    const tid = resolveThreadId(threadId);
    if (tid === null) {
      return { content: [{ type: "text", text: "No suspended thread." }], isError: true };
    }
    try {
      const frames = await client.getFrames(tid, 0, maxFrames);
      if (frames.length === 0) {
        return { content: [{ type: "text", text: "No stack frames." }] };
      }
      const lines = frames.map((f, i) => {
        const cls = f.className ?? "<unknown>";
        const method = f.methodName ?? "<unknown>";
        const line = f.lineNumber !== undefined ? `:${f.lineNumber}` : "";
        const marker = i === 0 ? " <-- current" : "";
        return `  #${i} ${cls}.${method}(${line})${marker}`;
      });
      return {
        content: [{ type: "text", text: `Stack trace (thread=${tid}):\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get stack trace: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
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
  async ({ threadId, frameIndex }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    const tid = resolveThreadId(threadId);
    if (tid === null) {
      return { content: [{ type: "text", text: "No suspended thread." }], isError: true };
    }
    try {
      const frames = await client.getFrames(tid, 0, frameIndex + 1);
      if (frames.length <= frameIndex) {
        return {
          content: [{ type: "text", text: `Frame index ${frameIndex} out of range.` }],
          isError: true,
        };
      }
      const frame = frames[frameIndex];
      const variables = await client.getFrameVariables(tid, frame.frameId, frame.location);

      if (variables.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No local variables visible at ${frame.className}.${frame.methodName}:${frame.lineNumber}\n(Class may be compiled without debug info)`,
            },
          ],
        };
      }

      const lines = variables.map((v) => {
        const sig = simplifySignature(v.signature);
        let valueStr: string;

        if (v.stringValue !== undefined) {
          valueStr = `"${v.stringValue}"`;
        } else {
          valueStr = formatValue(v.tag, v.value);
        }

        return `  ${sig} ${v.name} = ${valueStr}`;
      });

      const loc = `${frame.className}.${frame.methodName}:${frame.lineNumber}`;
      return {
        content: [
          {
            type: "text",
            text: `Variables at ${loc} (frame #${frameIndex}):\n${lines.join("\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get variables: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
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
  async ({ objectId }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    try {
      const oid = BigInt(objectId);
      const fields = await client.getObjectFields(oid);
      if (fields.length === 0) {
        return { content: [{ type: "text", text: "No fields found." }] };
      }
      const lines = fields.map((f) => {
        const sig = simplifySignature(f.signature);
        return `  ${sig} ${f.name} = ${f.value}`;
      });
      return {
        content: [{ type: "text", text: `Object@${objectId} fields:\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to inspect object: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
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
  async ({ arrayId, startIndex, length }) => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    try {
      const result = await client.getArrayValues(BigInt(arrayId), startIndex, length);
      return { content: [{ type: "text", text: `Array@${arrayId}: ${result}` }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to inspect array: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: get_threads ---
server.registerTool(
  "get_threads",
  { description: "List all threads in the JVM with their status" },
  async () => {
    if (!client.isConnected) {
      return { content: [{ type: "text", text: "Not connected to JVM." }], isError: true };
    }
    try {
      const threads = await client.getAllThreads();
      const suspendedIds = new Set(client.allSuspendedThreadIds);
      const lines = threads.map((t) => {
        const statusName = getThreadStatusName(t.status);
        const suspended = t.suspendStatus === 1 ? " [SUSPENDED]" : "";
        const atBreakpoint = suspendedIds.has(t.id) ? " *** BREAKPOINT/STEP ***" : "";
        const current = t.id === client.currentThreadId ? " <-- current" : "";
        return `  [${t.id}] ${t.name} (${statusName})${suspended}${atBreakpoint}${current}`;
      });
      return {
        content: [{ type: "text", text: `Threads (${threads.length}):\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get threads: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: get_events ---
server.registerTool(
  "get_events",
  { description: "Get the recent debug event log (breakpoint hits, steps, etc.)" },
  () => {
    if (eventLog.length === 0) {
      return { content: [{ type: "text", text: "No events recorded." }] };
    }
    return {
      content: [{ type: "text", text: `Recent events:\n${eventLog.join("\n")}` }],
    };
  },
);

// --- Tool: status ---
server.registerTool("status", { description: "Get the current debug session status" }, () => {
  const connected = client.isConnected;
  const bps = connected ? client.getBreakpoints() : [];
  const suspendedThreads = connected ? client.allSuspendedThreadIds : [];
  const currentThread = client.currentThreadId;

  const proc = getCurrentProcess();
  const procAlive = proc !== null && !proc.process.killed && proc.process.exitCode === null;

  const vmSuspended = connected ? client.vmSuspended : false;

  const lines = [
    `Launched process: ${proc ? `PID=${String(proc.pid)} (${procAlive ? "running" : "exited"}, ${proc.buildSystem} ${proc.task}, port=${proc.port})` : "none"}`,
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

  return { content: [{ type: "text", text: lines.join("\n") }] };
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
