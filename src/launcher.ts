import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type BuildSystem = "gradle" | "gradle-kts" | "maven" | "raw-java";

export interface DetectedProject {
  buildSystem: BuildSystem;
  projectDir: string;
  buildFiles: string[];
  hasWrapper: boolean;
}

export interface LaunchOptions {
  projectDir: string;
  task?: string; // e.g., "bootRun", "run", "spring-boot:run", "exec:java"
  buildSystem?: BuildSystem; // auto-detect if not specified
  port?: number; // JDWP port (default: 5005)
  suspend?: boolean; // Suspend on start (default: false)
  jvmArgs?: string[]; // Additional JVM arguments
  args?: string[]; // Application arguments
  env?: Record<string, string>; // Additional environment variables
  buildFirst?: boolean; // Build before running (default: true)
}

export interface LaunchedProcess {
  process: ChildProcess;
  pid: number | undefined;
  port: number;
  buildSystem: BuildSystem;
  task: string;
  outputLines: string[];
}

const MAX_OUTPUT_LINES = 200;

/** Detect the build system used in a project directory */
export function detectBuildSystem(projectDir: string): DetectedProject | null {
  const checks: Array<{ file: string; system: BuildSystem }> = [
    { file: "build.gradle.kts", system: "gradle-kts" },
    { file: "build.gradle", system: "gradle" },
    { file: "pom.xml", system: "maven" },
  ];

  for (const check of checks) {
    const filePath = path.join(projectDir, check.file);
    if (fs.existsSync(filePath)) {
      const buildFiles = [check.file];
      // Check for settings file
      if (check.system === "gradle" || check.system === "gradle-kts") {
        if (fs.existsSync(path.join(projectDir, "settings.gradle.kts")))
          buildFiles.push("settings.gradle.kts");
        else if (fs.existsSync(path.join(projectDir, "settings.gradle")))
          buildFiles.push("settings.gradle");
      }

      const hasWrapper = check.system.startsWith("gradle")
        ? fs.existsSync(path.join(projectDir, "gradlew")) ||
          fs.existsSync(path.join(projectDir, "gradlew.bat"))
        : fs.existsSync(path.join(projectDir, "mvnw")) ||
          fs.existsSync(path.join(projectDir, "mvnw.cmd"));

      return {
        buildSystem: check.system,
        projectDir,
        buildFiles,
        hasWrapper,
      };
    }
  }
  return null;
}

/** Get the default run task for a build system */
function getDefaultTask(buildSystem: BuildSystem, projectDir: string): string {
  if (buildSystem === "gradle" || buildSystem === "gradle-kts") {
    // Check for Spring Boot plugin
    const buildFile = buildSystem === "gradle-kts" ? "build.gradle.kts" : "build.gradle";
    const buildContent = readFileSafe(path.join(projectDir, buildFile));
    if (buildContent.includes("spring-boot") || buildContent.includes("org.springframework.boot")) {
      return "bootRun";
    }
    // Check for application plugin
    if (buildContent.includes("application") || buildContent.includes("mainClass")) {
      return "run";
    }
    return "run";
  }

  if (buildSystem === "maven") {
    // Check for Spring Boot
    const pomContent = readFileSafe(path.join(projectDir, "pom.xml"));
    if (pomContent.includes("spring-boot-maven-plugin")) {
      return "spring-boot:run";
    }
    if (pomContent.includes("exec-maven-plugin")) {
      return "exec:java";
    }
    return "spring-boot:run";
  }

  return "run";
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Build the JDWP agent string */
function jdwpAgentArg(port: number, suspend: boolean): string {
  return `-agentlib:jdwp=transport=dt_socket,server=y,suspend=${suspend ? "y" : "n"},address=*:${port}`;
}

/**
 * Create a Gradle init script that injects JDWP debug args into JavaExec tasks.
 * This is the most reliable way to pass JVM args to the forked application JVM
 * without affecting the Gradle daemon itself (unlike JAVA_TOOL_OPTIONS).
 */
function createGradleInitScript(allJvmArgs: string[]): string {
  const tmpDir = os.tmpdir();
  const initScriptPath = path.join(tmpDir, `jvm-debug-mcp-init-${Date.now()}.gradle`);
  const argsLiteral = allJvmArgs.map((a) => `'${a}'`).join(", ");
  const script = `
allprojects {
    tasks.withType(JavaExec) {
        jvmArgs ${argsLiteral}
    }
}
`;
  fs.writeFileSync(initScriptPath, script, "utf-8");
  return initScriptPath;
}

/** Cleanup a temporary init script */
function cleanupInitScript(scriptPath: string): void {
  try {
    fs.unlinkSync(scriptPath);
  } catch {
    /* ignore */
  }
}

/** Determine the build/run command and environment */
function buildCommand(opts: LaunchOptions & { detected: DetectedProject }): {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  cleanup?: () => void;
} {
  const { detected, port = 5005, suspend = false, jvmArgs = [], args = [], env = {} } = opts;
  const task = opts.task ?? getDefaultTask(detected.buildSystem, detected.projectDir);
  const debugArg = jdwpAgentArg(port, suspend);
  const allJvmArgs = [debugArg, ...jvmArgs];
  const isWindows = process.platform === "win32";

  if (detected.buildSystem === "gradle" || detected.buildSystem === "gradle-kts") {
    const cmd = detected.hasWrapper ? (isWindows ? "gradlew.bat" : "./gradlew") : "gradle";
    const cmdArgs = [task];

    // Use a Gradle init script to inject JVM args ONLY into JavaExec tasks
    // (run, bootRun, etc.), without affecting the Gradle daemon/build JVM.
    //
    // The init script approach:
    //   allprojects { tasks.withType(JavaExec) { jvmArgs '...' } }
    //
    // This works for:
    //   - Application plugin's `run` task
    //   - Spring Boot's `bootRun` task
    //   - Any custom JavaExec task
    const initScriptPath = createGradleInitScript(allJvmArgs);
    cmdArgs.push("--init-script", initScriptPath);

    if (args.length > 0) {
      cmdArgs.push(`--args=${args.join(" ")}`);
    }

    return {
      cmd,
      args: cmdArgs,
      env,
      cleanup: () => cleanupInitScript(initScriptPath),
    };
  }

  if (detected.buildSystem === "maven") {
    const cmd = detected.hasWrapper ? (isWindows ? "mvnw.cmd" : "./mvnw") : "mvn";
    const cmdArgs = [task];

    // Maven plugin-specific JVM arg passing:
    //
    // spring-boot:run  → -Dspring-boot.run.jvmArguments="..."
    //   The Spring Boot Maven plugin correctly passes these to the forked app JVM only.
    //
    // exec:java → runs in Maven's JVM, use -Dexec.args for the main class args
    //   For debug, exec:exec is preferred (forks a new JVM).
    //
    // surefire/failsafe → -DargLine="..." for test execution
    //
    // Generic fallback: MAVEN_OPTS sets JVM args for Maven itself (not ideal
    //   but works for exec:java which runs in-process).
    if (task === "spring-boot:run") {
      cmdArgs.push(`-Dspring-boot.run.jvmArguments=${allJvmArgs.join(" ")}`);
      if (args.length > 0) {
        cmdArgs.push(`-Dspring-boot.run.arguments=${args.join(",")}`);
      }
    } else if (task === "exec:exec") {
      // exec:exec forks a new JVM — pass JDWP via exec.arguments
      cmdArgs.push(`-Dexec.arguments=${allJvmArgs.join(" ")}`);
    } else if (task.includes("test") || task.includes("verify")) {
      // Surefire/Failsafe
      cmdArgs.push(`-DargLine=${allJvmArgs.join(" ")}`);
    } else {
      // For exec:java or generic: use MAVEN_OPTS (runs in Maven's JVM)
      return {
        cmd,
        args: cmdArgs,
        env: { ...env, MAVEN_OPTS: allJvmArgs.join(" ") },
      };
    }

    return { cmd, args: cmdArgs, env };
  }

  // raw-java fallback
  return { cmd: "java", args: [...allJvmArgs, ...args], env };
}

/** Build the project without running */
export async function buildProject(
  projectDir: string,
  buildSystem?: BuildSystem,
): Promise<{
  success: boolean;
  output: string;
  buildSystem: BuildSystem;
}> {
  const detected = detectBuildSystem(projectDir);
  if (!detected) {
    return {
      success: false,
      output: "No build system detected (no build.gradle, build.gradle.kts, or pom.xml found)",
      buildSystem: "raw-java",
    };
  }

  const system = buildSystem ?? detected.buildSystem;
  const isWindows = process.platform === "win32";

  let cmd: string;
  let args: string[];

  if (system === "gradle" || system === "gradle-kts") {
    cmd = detected.hasWrapper ? (isWindows ? "gradlew.bat" : "./gradlew") : "gradle";
    args = ["build", "-x", "test"]; // Build without tests for speed
  } else {
    cmd = detected.hasWrapper ? (isWindows ? "mvnw.cmd" : "./mvnw") : "mvn";
    args = ["compile", "-q"];
  }

  return await new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: projectDir,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const output: string[] = [];
    proc.stdout.on("data", (data: Buffer) => output.push(data.toString()));
    proc.stderr.on("data", (data: Buffer) => output.push(data.toString()));

    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        output: output.join("").trim().substring(0, 5000), // Cap output
        buildSystem: system,
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        output: `Failed to execute ${cmd}: ${err.message}`,
        buildSystem: system,
      });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        output: "Build timed out after 2 minutes",
        buildSystem: system,
      });
    }, 120000);
  });
}

// Store the launched process globally
let currentProcess: LaunchedProcess | null = null;

export function getCurrentProcess(): LaunchedProcess | null {
  return currentProcess;
}

/** Launch a project with JDWP debug agent */
export async function launchWithDebug(opts: LaunchOptions): Promise<{
  success: boolean;
  message: string;
  port: number;
  buildSystem: BuildSystem;
  task: string;
}> {
  const detected = detectBuildSystem(opts.projectDir);
  if (!detected && !opts.buildSystem) {
    return {
      success: false,
      message:
        "No build system detected. Specify buildSystem manually or ensure build.gradle/pom.xml exists.",
      port: opts.port ?? 5005,
      buildSystem: "raw-java",
      task: "",
    };
  }

  const system = opts.buildSystem ?? detected?.buildSystem ?? "raw-java";
  const effectiveDetected = detected ?? {
    buildSystem: system,
    projectDir: opts.projectDir,
    buildFiles: [],
    hasWrapper: false,
  };

  const port = opts.port ?? 5005;
  const task = opts.task ?? getDefaultTask(system, opts.projectDir);

  // Build first if requested
  if (opts.buildFirst !== false) {
    const buildResult = await buildProject(opts.projectDir, system);
    if (!buildResult.success) {
      return {
        success: false,
        message: `Build failed:\n${buildResult.output}`,
        port,
        buildSystem: system,
        task,
      };
    }
  }

  // Kill existing process if any
  if (currentProcess?.process && !currentProcess.process.killed) {
    currentProcess.process.kill();
    currentProcess = null;
  }

  const { cmd, args, env, cleanup } = buildCommand({
    ...opts,
    port,
    task,
    detected: effectiveDetected,
  });

  return await new Promise((resolve) => {
    const outputLines: string[] = [];

    const proc = spawn(cmd, args, {
      cwd: opts.projectDir,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    const addOutput = (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.trim()) {
          outputLines.push(line);
          if (outputLines.length > MAX_OUTPUT_LINES) {
            outputLines.shift();
          }
        }
      }
    };

    proc.stdout.on("data", addOutput);
    proc.stderr.on("data", addOutput);

    proc.on("error", (err) => {
      cleanup?.();
      resolve({
        success: false,
        message: `Failed to launch: ${err.message}\nCommand: ${cmd} ${args.join(" ")}`,
        port,
        buildSystem: system,
        task,
      });
    });

    proc.on("close", (_code) => {
      cleanup?.();
      if (currentProcess?.process === proc) {
        currentProcess = null;
      }
    });

    currentProcess = {
      process: proc,
      pid: proc.pid,
      port,
      buildSystem: system,
      task,
      outputLines,
    };

    // Wait a bit for process to start, then check if it's still alive
    // and if JDWP port is listening
    setTimeout(() => {
      if (proc.exitCode !== null) {
        resolve({
          success: false,
          message: `Process exited immediately (code=${proc.exitCode}):\n${outputLines.join("\n")}`,
          port,
          buildSystem: system,
          task,
        });
      } else {
        resolve({
          success: true,
          message: `Launched: ${cmd} ${args.join(" ")}\nPID: ${proc.pid}\nJDWP port: ${port}\nUse 'connect' tool with port ${port} to start debugging.`,
          port,
          buildSystem: system,
          task,
        });
      }
    }, 3000);
  });
}

/** Stop the currently launched process */
export function stopProcess(): { stopped: boolean; message: string } {
  if (!currentProcess?.process || currentProcess.process.killed) {
    return { stopped: false, message: "No running process to stop." };
  }

  const pid = currentProcess.pid;
  currentProcess.process.kill();
  currentProcess = null;
  return { stopped: true, message: `Process ${pid} stopped.` };
}

/** Get output from the launched process */
export function getProcessOutput(lastN: number = 50): string[] {
  if (!currentProcess) return [];
  return currentProcess.outputLines.slice(-lastN);
}
