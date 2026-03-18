// Test: detect, build, and launch a Gradle project with debug, then connect and debug
import * as path from "node:path";
import {
  detectBuildSystem,
  buildProject,
  launchWithDebug,
  stopProcess,
  getProcessOutput,
} from "../src/launcher.js";
import { JDWPClient } from "../src/jdwp/client.js";

const PROJECT_DIR = path.resolve(import.meta.dirname, "gradle-project");

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== Test: Gradle project detection ===");
  const detected = detectBuildSystem(PROJECT_DIR);
  if (!detected) {
    console.error("FAIL: No build system detected");
    process.exit(1);
  }
  console.log(`  Build system: ${detected.buildSystem}`);
  console.log(`  Build files: ${detected.buildFiles.join(", ")}`);
  console.log(`  Has wrapper: ${detected.hasWrapper}`);

  console.log("\n=== Test: Build project ===");
  const buildResult = await buildProject(PROJECT_DIR);
  if (!buildResult.success) {
    console.error(`FAIL: Build failed:\n${buildResult.output}`);
    process.exit(1);
  }
  console.log(`  Build succeeded (${buildResult.buildSystem})`);

  console.log("\n=== Test: Launch with debug ===");
  const launchResult = await launchWithDebug({
    projectDir: PROJECT_DIR,
    port: 5005,
    suspend: false,
    buildFirst: false, // Already built
  });
  console.log(`  ${launchResult.message}`);
  if (!launchResult.success) {
    console.error("FAIL: Launch failed");
    process.exit(1);
  }

  // Wait for app to start and JDWP to be ready
  console.log("  Waiting for JDWP to be ready...");
  await delay(5000);

  // Show process output
  const output = getProcessOutput(10);
  console.log("  Process output:");
  for (const line of output) {
    console.log(`    ${line}`);
  }

  console.log("\n=== Test: Connect debugger ===");
  const client = new JDWPClient();

  client.on("breakpoint", (ev: { requestId: number; threadId: bigint }) => {
    console.log(`  🔴 Breakpoint hit! threadId=${ev.threadId}`);
  });

  try {
    const version = await client.connect("localhost", 5005);
    console.log(`  Connected: ${version}`);

    // Set breakpoint
    const bp = await client.setBreakpoint("com.example.App", 16);
    console.log(`  Breakpoint set at com.example.App:${bp.line} (id=${bp.requestId})`);

    // Wait for breakpoint hit
    console.log("  Waiting for breakpoint...");
    await new Promise<void>((resolve) => {
      client.once("breakpoint", () => resolve());
    });

    // Get variables
    const threadId = client.currentThreadId!;
    const frames = await client.getFrames(threadId, 0, 3);
    console.log(
      `  Stack: ${frames[0]?.className}.${frames[0]?.methodName}(:${frames[0]?.lineNumber})`,
    );

    const vars = await client.getFrameVariables(threadId, frames[0].frameId, frames[0].location);
    for (const v of vars) {
      console.log(`  ${v.name} = ${v.stringValue ?? String(v.value)}`);
    }

    // Cleanup
    await client.removeBreakpoint(bp.requestId);
    await client.resumeVM();
    await client.disconnect();
    console.log("\n  Debugger disconnected.");
  } catch (err) {
    console.error("  Error:", err);
  }

  console.log("\n=== Stopping process ===");
  const stopped = stopProcess();
  console.log(`  ${stopped.message}`);

  console.log("\n🎉 Gradle launch + debug test PASSED!");
  process.exit(0);
}

main();
