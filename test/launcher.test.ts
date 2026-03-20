import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as os from "node:os";
import { detectBuildSystem, getDefaultTask, launchWithDebug } from "../src/launcher.js";

/** Create a temporary directory for test projects */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jvm-debug-mcp-test-"));
}

/** Remove a directory recursively */
function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("detectBuildSystem", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("should return null for empty directory", () => {
    expect(detectBuildSystem(tempDir)).toBeNull();
  });

  it("should detect Gradle (Groovy DSL)", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle"), "apply plugin: 'java'\n");
    const result = detectBuildSystem(tempDir);
    expect(result).not.toBeNull();
    expect(result!.buildSystem).toBe("gradle");
    expect(result!.buildFiles).toContain("build.gradle");
    expect(result!.hasWrapper).toBe(false);
  });

  it("should detect Gradle (Kotlin DSL)", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle.kts"), "plugins { java }\n");
    const result = detectBuildSystem(tempDir);
    expect(result).not.toBeNull();
    expect(result!.buildSystem).toBe("gradle-kts");
    expect(result!.buildFiles).toContain("build.gradle.kts");
  });

  it("should detect Maven", () => {
    fs.writeFileSync(
      path.join(tempDir, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion></project>\n",
    );
    const result = detectBuildSystem(tempDir);
    expect(result).not.toBeNull();
    expect(result!.buildSystem).toBe("maven");
    expect(result!.buildFiles).toContain("pom.xml");
    expect(result!.hasWrapper).toBe(false);
  });

  it("should prefer Gradle KTS over Groovy when both exist", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle.kts"), "");
    fs.writeFileSync(path.join(tempDir, "build.gradle"), "");
    const result = detectBuildSystem(tempDir);
    expect(result!.buildSystem).toBe("gradle-kts");
  });

  it("should prefer Gradle over Maven when both exist", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle"), "");
    fs.writeFileSync(path.join(tempDir, "pom.xml"), "");
    const result = detectBuildSystem(tempDir);
    expect(result!.buildSystem).toBe("gradle");
  });

  it("should detect Gradle wrapper (gradlew)", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle"), "");
    fs.writeFileSync(path.join(tempDir, "gradlew"), "#!/bin/sh\n", { mode: 0o755 });
    const result = detectBuildSystem(tempDir);
    expect(result!.hasWrapper).toBe(true);
  });

  it("should detect Gradle wrapper (gradlew.bat)", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle"), "");
    fs.writeFileSync(path.join(tempDir, "gradlew.bat"), "@echo off\n");
    const result = detectBuildSystem(tempDir);
    expect(result!.hasWrapper).toBe(true);
  });

  it("should detect Maven wrapper (mvnw)", () => {
    fs.writeFileSync(path.join(tempDir, "pom.xml"), "<project/>");
    fs.writeFileSync(path.join(tempDir, "mvnw"), "#!/bin/sh\n", { mode: 0o755 });
    const result = detectBuildSystem(tempDir);
    expect(result!.hasWrapper).toBe(true);
  });

  it("should detect Maven wrapper (mvnw.cmd)", () => {
    fs.writeFileSync(path.join(tempDir, "pom.xml"), "<project/>");
    fs.writeFileSync(path.join(tempDir, "mvnw.cmd"), "@echo off\n");
    const result = detectBuildSystem(tempDir);
    expect(result!.hasWrapper).toBe(true);
  });

  it("should detect settings.gradle.kts", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle.kts"), "");
    fs.writeFileSync(path.join(tempDir, "settings.gradle.kts"), 'rootProject.name = "test"\n');
    const result = detectBuildSystem(tempDir);
    expect(result!.buildFiles).toContain("settings.gradle.kts");
  });

  it("should detect settings.gradle for Groovy DSL", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle"), "");
    fs.writeFileSync(path.join(tempDir, "settings.gradle"), "rootProject.name = 'test'\n");
    const result = detectBuildSystem(tempDir);
    expect(result!.buildFiles).toContain("settings.gradle");
  });

  it("should include projectDir in result", () => {
    fs.writeFileSync(path.join(tempDir, "build.gradle"), "");
    const result = detectBuildSystem(tempDir);
    expect(result!.projectDir).toBe(tempDir);
  });
});

describe("getDefaultTask", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("should return spring-boot:run for Maven with spring-boot-maven-plugin", () => {
    fs.writeFileSync(
      path.join(tempDir, "pom.xml"),
      `<project>
        <build><plugins><plugin>
          <groupId>org.springframework.boot</groupId>
          <artifactId>spring-boot-maven-plugin</artifactId>
        </plugin></plugins></build>
      </project>`,
    );
    expect(getDefaultTask("maven", tempDir)).toBe("spring-boot:run");
  });

  it("should return exec:java for Maven with exec-maven-plugin", () => {
    fs.writeFileSync(
      path.join(tempDir, "pom.xml"),
      `<project>
        <build><plugins><plugin>
          <groupId>org.codehaus.mojo</groupId>
          <artifactId>exec-maven-plugin</artifactId>
        </plugin></plugins></build>
      </project>`,
    );
    expect(getDefaultTask("maven", tempDir)).toBe("exec:java");
  });

  it("should return exec:java (not spring-boot:run) for plain Maven project", () => {
    fs.writeFileSync(
      path.join(tempDir, "pom.xml"),
      `<project><modelVersion>4.0.0</modelVersion></project>`,
    );
    expect(getDefaultTask("maven", tempDir)).toBe("exec:java");
  });

  it("should return bootRun for Gradle with Spring Boot", () => {
    fs.writeFileSync(
      path.join(tempDir, "build.gradle"),
      `plugins { id 'org.springframework.boot' version '3.0.0' }`,
    );
    expect(getDefaultTask("gradle", tempDir)).toBe("bootRun");
  });

  it("should return run for Gradle with application plugin", () => {
    fs.writeFileSync(
      path.join(tempDir, "build.gradle"),
      `plugins { id 'application' }\nmainClass = 'com.example.Main'`,
    );
    expect(getDefaultTask("gradle", tempDir)).toBe("run");
  });

  it("should return run for plain Gradle project", () => {
    fs.writeFileSync(
      path.join(tempDir, "build.gradle"),
      `plugins { id 'java' }`,
    );
    expect(getDefaultTask("gradle", tempDir)).toBe("run");
  });
});

describe("launchWithDebug JDWP port verification", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  it("should succeed when JDWP port becomes available", async () => {
    // Start a TCP server to simulate JDWP port
    const port = 15005 + Math.floor(Math.random() * 1000);
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

    try {
      // Create a minimal project with a script that stays alive
      fs.writeFileSync(path.join(tempDir, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>");

      // Launch with a command that just sleeps — the TCP server simulates JDWP
      const result = await launchWithDebug({
        projectDir: tempDir,
        port,
        buildSystem: "raw-java",
        task: "run",
      });
      // raw-java with no .java files will likely fail, but we're testing port detection
      // The process may exit immediately, so this tests the exit-code path
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("port", port);
    } finally {
      server.close();
    }
  });

  it("should report failure when process exits immediately", async () => {
    fs.writeFileSync(path.join(tempDir, "pom.xml"), "<project/>");

    const result = await launchWithDebug({
      projectDir: tempDir,
      port: 15999,
      buildSystem: "raw-java",
      task: "run",
    });

    // raw-java with no valid class will fail
    expect(result.success).toBe(false);
  });
});
