// Simple test script to verify JDWP client works directly
import { JDWPClient } from "../src/jdwp/client.js";

async function main() {
  const client = new JDWPClient();

  // Listen for events
  client.on("breakpoint", (ev: { requestId: number; threadId: bigint }) => {
    console.log(`\n🔴 BREAKPOINT HIT! requestId=${ev.requestId}, threadId=${ev.threadId}`);
  });

  client.on("step", (ev: { threadId: bigint }) => {
    console.log(`\n👣 STEP completed, threadId=${ev.threadId}`);
  });

  try {
    // Connect
    console.log("Connecting to JVM...");
    const version = await client.connect("localhost", 5005);
    console.log(`Connected: ${version}`);

    // List threads
    console.log("\n--- Threads ---");
    const threads = await client.getAllThreads();
    for (const t of threads) {
      console.log(`  [${t.id}] ${t.name} (status=${t.status}, suspended=${t.suspendStatus})`);
    }

    // Set breakpoint on line 10 (inside the while loop)
    console.log("\n--- Setting breakpoint ---");
    const bp = await client.setBreakpoint("DebugTest", 10);
    console.log(`Breakpoint set: id=${bp.requestId}, class=${bp.className}, line=${bp.line}`);

    // Wait for breakpoint to hit
    console.log("\nWaiting for breakpoint hit...");
    await new Promise<void>((resolve) => {
      client.once("breakpoint", () => resolve());
    });

    // Get stack trace
    const threadId = client.currentThreadId!;
    console.log(`\n--- Stack trace (thread=${threadId}) ---`);
    const frames = await client.getFrames(threadId);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      console.log(`  #${i} ${f.className}.${f.methodName}(:${f.lineNumber})`);
    }

    // Get variables
    if (frames.length > 0) {
      console.log("\n--- Variables (frame 0) ---");
      const vars = await client.getFrameVariables(threadId, frames[0].frameId, frames[0].location);
      for (const v of vars) {
        const valStr = v.stringValue !== undefined ? `"${v.stringValue}"` : String(v.value);
        console.log(`  ${v.name} (${v.signature}) = ${valStr}`);
      }
    }

    // Step over
    console.log("\n--- Step over ---");
    const stepPromise = new Promise<void>((resolve) => {
      client.once("step", () => resolve());
    });
    await client.stepOver(threadId);
    await stepPromise;

    // Get stack trace after step
    const threadId2 = client.currentThreadId!;
    console.log(`\n--- Stack trace after step (thread=${threadId2}) ---`);
    const frames2 = await client.getFrames(threadId2);
    for (let i = 0; i < Math.min(3, frames2.length); i++) {
      const f = frames2[i];
      console.log(`  #${i} ${f.className}.${f.methodName}(:${f.lineNumber})`);
    }

    // Get variables after step
    if (frames2.length > 0) {
      console.log("\n--- Variables after step ---");
      const vars2 = await client.getFrameVariables(
        threadId2,
        frames2[0].frameId,
        frames2[0].location,
      );
      for (const v of vars2) {
        const valStr = v.stringValue !== undefined ? `"${v.stringValue}"` : String(v.value);
        console.log(`  ${v.name} (${v.signature}) = ${valStr}`);
      }
    }

    // Remove breakpoint and resume
    console.log("\n--- Cleanup ---");
    await client.removeBreakpoint(bp.requestId);
    console.log("Breakpoint removed");
    await client.resumeVM();
    console.log("VM resumed");

    // Disconnect
    await client.disconnect();
    console.log("Disconnected");

    console.log("\n✅ All tests passed!");
  } catch (err) {
    console.error("Error:", err);
  }

  process.exit(0);
}

main();
