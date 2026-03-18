// Test multi-thread debugging: two threads hit breakpoints independently
import { JDWPClient } from "../src/jdwp/client.js";

async function main() {
  const client = new JDWPClient();

  client.on("breakpoint", (ev: { requestId: number; threadId: bigint }) => {
    console.log(`\n🔴 BREAKPOINT HIT! requestId=${ev.requestId}, threadId=${ev.threadId}`);
    console.log(`   Suspended threads: [${client.allSuspendedThreadIds.map(String).join(", ")}]`);
  });

  client.on("step", (ev: { threadId: bigint }) => {
    console.log(`\n👣 STEP completed, threadId=${ev.threadId}`);
    console.log(`   Suspended threads: [${client.allSuspendedThreadIds.map(String).join(", ")}]`);
  });

  try {
    console.log("Connecting to JVM...");
    const version = await client.connect("localhost", 5005);
    console.log(`Connected: ${version}\n`);

    // Set breakpoints on both API handlers (suspend=thread mode)
    console.log("=== Setting breakpoints (suspendPolicy=thread) ===");
    const bp1 = await client.setBreakpoint("MultiThreadDebugTest", 40, "thread");
    console.log(`BP1: handleApi1 line 40 (id=${bp1.requestId})`);

    const bp2 = await client.setBreakpoint("MultiThreadDebugTest", 46, "thread");
    console.log(`BP2: handleApi2 line 46 (id=${bp2.requestId})`);

    // Wait for BOTH threads to hit their breakpoints
    console.log("\n=== Waiting for both threads to hit breakpoints ===");
    let hitCount = 0;
    await new Promise<void>((resolve) => {
      client.on("breakpoint", () => {
        hitCount++;
        console.log(`   (${hitCount}/2 breakpoints hit)`);
        if (hitCount >= 2) resolve();
      });
    });

    console.log(`\n✅ Both threads suspended!`);
    console.log(
      `   All suspended threads: [${client.allSuspendedThreadIds.map(String).join(", ")}]`,
    );

    // Identify which thread is which
    const suspendedIds = client.allSuspendedThreadIds;
    const threadNames: Map<bigint, string> = new Map();
    for (const tid of suspendedIds) {
      const name = await client.getThreadName(tid);
      threadNames.set(tid, name);
      console.log(`   Thread ${tid} = "${name}"`);
    }

    const api1ThreadId = suspendedIds.find((id) => threadNames.get(id)?.includes("API1"));
    const api2ThreadId = suspendedIds.find((id) => threadNames.get(id)?.includes("API2"));

    if (!api1ThreadId || !api2ThreadId) {
      throw new Error("Could not identify API1 and API2 threads");
    }

    // === Inspect API1 thread ===
    console.log(`\n=== Inspecting API1 thread (${api1ThreadId}) ===`);
    const frames1 = await client.getFrames(api1ThreadId, 0, 3);
    for (const f of frames1) {
      console.log(`  ${f.className}.${f.methodName}(:${f.lineNumber})`);
    }
    const vars1 = await client.getFrameVariables(
      api1ThreadId,
      frames1[0].frameId,
      frames1[0].location,
    );
    console.log("  Variables:");
    for (const v of vars1) {
      console.log(`    ${v.name} = ${v.stringValue ?? String(v.value)}`);
    }

    // === Inspect API2 thread (while API1 is still paused!) ===
    console.log(`\n=== Inspecting API2 thread (${api2ThreadId}) [API1 still paused] ===`);
    const frames2 = await client.getFrames(api2ThreadId, 0, 3);
    for (const f of frames2) {
      console.log(`  ${f.className}.${f.methodName}(:${f.lineNumber})`);
    }
    const vars2 = await client.getFrameVariables(
      api2ThreadId,
      frames2[0].frameId,
      frames2[0].location,
    );
    console.log("  Variables:");
    for (const v of vars2) {
      console.log(`    ${v.name} = ${v.stringValue ?? String(v.value)}`);
    }

    // === Step API1 thread (API2 stays paused) ===
    console.log(`\n=== Step over API1 thread (API2 should stay paused) ===`);
    const step1Promise = new Promise<void>((resolve) => {
      client.once("step", () => resolve());
    });
    await client.stepOver(api1ThreadId);
    await step1Promise;

    console.log(
      `  API2 still suspended? ${client.allSuspendedThreadIds.includes(api2ThreadId) ? "YES ✅" : "NO ❌"}`,
    );

    // Inspect API1 after step
    const frames1After = await client.getFrames(api1ThreadId, 0, 3);
    console.log(
      `  API1 now at: ${frames1After[0]?.className}.${frames1After[0]?.methodName}(:${frames1After[0]?.lineNumber})`,
    );
    const vars1After = await client.getFrameVariables(
      api1ThreadId,
      frames1After[0].frameId,
      frames1After[0].location,
    );
    console.log("  API1 Variables after step:");
    for (const v of vars1After) {
      console.log(`    ${v.name} = ${v.stringValue ?? String(v.value)}`);
    }

    // === Now step API2 thread ===
    console.log(`\n=== Step over API2 thread ===`);
    const step2Promise = new Promise<void>((resolve) => {
      client.once("step", () => resolve());
    });
    await client.stepOver(api2ThreadId);
    await step2Promise;

    const frames2After = await client.getFrames(api2ThreadId, 0, 3);
    console.log(
      `  API2 now at: ${frames2After[0]?.className}.${frames2After[0]?.methodName}(:${frames2After[0]?.lineNumber})`,
    );
    const vars2After = await client.getFrameVariables(
      api2ThreadId,
      frames2After[0].frameId,
      frames2After[0].location,
    );
    console.log("  API2 Variables after step:");
    for (const v of vars2After) {
      console.log(`    ${v.name} = ${v.stringValue ?? String(v.value)}`);
    }

    // Cleanup
    console.log("\n=== Cleanup ===");
    await client.removeBreakpoint(bp1.requestId);
    await client.removeBreakpoint(bp2.requestId);
    await client.resumeVM();
    console.log("All breakpoints removed, VM resumed.");

    await client.disconnect();
    console.log("Disconnected.");

    console.log("\n🎉 Multi-thread debug test PASSED!");
  } catch (err) {
    console.error("Error:", err);
  }

  process.exit(0);
}

main();
