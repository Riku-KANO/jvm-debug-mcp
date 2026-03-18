import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectBuildSystem } from "../src/launcher.js";

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
