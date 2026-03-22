import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as net from "node:net";
import { JDWPClient } from "../src/jdwp/client.js";
import { HANDSHAKE, CommandSet, EventKind, SuspendPolicy } from "../src/jdwp/constants.js";
import { JDWPWriter, buildCommandPacket } from "../src/jdwp/protocol.js";

const defaultIDSizes = {
  fieldIDSize: 8,
  methodIDSize: 8,
  objectIDSize: 8,
  referenceTypeIDSize: 8,
  frameIDSize: 8,
};

/**
 * Build a JDWP composite event packet (commandSet=64, command=100)
 * that the JVM would send to the debugger.
 */
function buildEventPacket(
  suspendPolicy: number,
  events: Array<{ kind: number; data: Buffer }>,
): Buffer {
  const writer = new JDWPWriter(defaultIDSizes);
  writer.writeByte(suspendPolicy);
  writer.writeInt(events.length);
  for (const ev of events) {
    writer.writeByte(ev.kind);
    // Append raw event data after the kind byte
  }
  const eventData = Buffer.concat([
    writer.toBuffer(),
    ...events.map((ev) => ev.data),
  ]);

  // Re-build properly: we need to interleave kind + data per event
  // Let's just manually construct the data payload
  const parts: Buffer[] = [];
  // suspendPolicy (1 byte)
  const spBuf = Buffer.alloc(1);
  spBuf.writeInt8(suspendPolicy);
  parts.push(spBuf);
  // event count (4 bytes)
  const countBuf = Buffer.alloc(4);
  countBuf.writeInt32BE(events.length);
  parts.push(countBuf);
  // each event: kind (1 byte) + event-specific data
  for (const ev of events) {
    const kindBuf = Buffer.alloc(1);
    kindBuf.writeInt8(ev.kind);
    parts.push(kindBuf, ev.data);
  }

  const data = Buffer.concat(parts);
  // Build as a command packet from VM: commandSet=64 (Event), command=100 (Composite)
  return buildCommandPacket(0, CommandSet.Event, 100, data);
}

/**
 * Build the data portion for a VMStart event (requestId + threadID).
 */
function buildVMStartData(requestId: number, threadId: bigint): Buffer {
  const writer = new JDWPWriter(defaultIDSizes);
  writer.writeInt(requestId);
  writer.writeObjectID(threadId); // threadID uses objectIDSize
  return writer.toBuffer();
}

/**
 * Build the data portion for a Breakpoint event (requestId + threadID + location).
 */
function buildBreakpointData(
  requestId: number,
  threadId: bigint,
  typeTag: number,
  classID: bigint,
  methodID: bigint,
  index: bigint,
): Buffer {
  const writer = new JDWPWriter(defaultIDSizes);
  writer.writeInt(requestId);
  writer.writeObjectID(threadId);
  writer.writeLocation(typeTag, classID, methodID, index);
  return writer.toBuffer();
}

/**
 * Build the data portion for a ClassPrepare event.
 */
function buildClassPrepareData(
  requestId: number,
  threadId: bigint,
  typeID: bigint,
  signature: string,
  status: number,
): Buffer {
  const writer = new JDWPWriter(defaultIDSizes);
  writer.writeInt(requestId);
  writer.writeObjectID(threadId);
  writer.writeByte(1); // refTypeTag = Class
  writer.writeID(typeID, defaultIDSizes.referenceTypeIDSize);
  writer.writeString(signature);
  writer.writeInt(status);
  return writer.toBuffer();
}

/**
 * Build a JDWP reply packet for a given command.
 */
function buildReplyPacket(id: number, errorCode: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const length = 11 + data.length;
  const header = Buffer.alloc(11);
  header.writeInt32BE(length, 0);
  header.writeInt32BE(id, 4);
  header.writeUInt8(0x80, 8); // flags = reply
  header.writeUInt16BE(errorCode, 9);
  return Buffer.concat([header, data]);
}

/**
 * Build IDSizes reply data.
 */
function buildIDSizesReplyData(): Buffer {
  const writer = new JDWPWriter();
  writer.writeInt(8); // fieldIDSize
  writer.writeInt(8); // methodIDSize
  writer.writeInt(8); // objectIDSize
  writer.writeInt(8); // referenceTypeIDSize
  writer.writeInt(8); // frameIDSize
  return writer.toBuffer();
}

/**
 * Build Version reply data.
 */
function buildVersionReplyData(): Buffer {
  const writer = new JDWPWriter();
  writer.writeString("Test JDWP"); // description
  writer.writeInt(1); // jdwpMajor
  writer.writeInt(8); // jdwpMinor
  writer.writeString("17.0.5"); // vmVersion
  writer.writeString("OpenJDK"); // vmName
  return writer.toBuffer();
}

describe("JDWPClient event handling", () => {
  let client: JDWPClient;
  let mockServer: net.Server;
  let serverSocket: net.Socket | null;
  let serverPort: number;

  // Track commands the client sends so we can intercept Resume commands
  let commandsSent: Array<{ commandSet: number; command: number; id: number }>;

  beforeEach(async () => {
    client = new JDWPClient();
    serverSocket = null;
    commandsSent = [];

    // Create a real TCP server that simulates a JDWP-speaking JVM
    await new Promise<void>((resolve) => {
      mockServer = net.createServer((socket) => {
        serverSocket = socket;

        let handshakeDone = false;
        let buf = Buffer.alloc(0);

        socket.on("data", (data) => {
          buf = Buffer.concat([buf, data]);

          if (!handshakeDone) {
            if (buf.length >= HANDSHAKE.length) {
              const hs = buf.subarray(0, HANDSHAKE.length).toString();
              if (hs === HANDSHAKE) {
                // Reply with handshake
                socket.write(HANDSHAKE);
                handshakeDone = true;
                buf = buf.subarray(HANDSHAKE.length);
              }
            }
          }

          // Process command packets from client
          while (buf.length >= 11) {
            const pktLen = buf.readInt32BE(0);
            if (buf.length < pktLen) break;

            const pkt = buf.subarray(0, pktLen);
            buf = buf.subarray(pktLen);

            const id = pkt.readInt32BE(4);
            const flags = pkt.readUInt8(8);
            if (flags !== 0x80) {
              // Command packet from client
              const cmdSet = pkt.readUInt8(9);
              const cmd = pkt.readUInt8(10);
              commandsSent.push({ commandSet: cmdSet, command: cmd, id });

              // Auto-reply to known commands
              if (cmdSet === 1 && cmd === 7) {
                // IDSizes
                socket.write(buildReplyPacket(id, 0, buildIDSizesReplyData()));
              } else if (cmdSet === 1 && cmd === 1) {
                // Version
                socket.write(buildReplyPacket(id, 0, buildVersionReplyData()));
              } else if (cmdSet === 1 && cmd === 9) {
                // Resume - just acknowledge
                socket.write(buildReplyPacket(id, 0));
              } else {
                // Default: OK reply
                socket.write(buildReplyPacket(id, 0));
              }
            }
          }
        });
      });
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as net.AddressInfo;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    try {
      if (client.isConnected) {
        await client.disconnect();
      }
    } catch {
      // ignore
    }
    serverSocket?.destroy();
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  it("should NOT auto-resume on VMStart event (suspend=y scenario)", async () => {
    await client.connect("127.0.0.1", serverPort);
    expect(client.isConnected).toBe(true);

    // Clear commands from initial handshake/init
    commandsSent = [];

    // Send a VMStart event with SuspendPolicy.All (what JVM sends with suspend=y)
    const vmStartData = buildVMStartData(0, 1n);
    const eventPacket = buildEventPacket(SuspendPolicy.All, [
      { kind: EventKind.VMStart, data: vmStartData },
    ]);
    serverSocket!.write(eventPacket);

    // Wait for event processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The client should NOT have sent a Resume command (cmdSet=1, cmd=9)
    const resumeCommands = commandsSent.filter((c) => c.commandSet === 1 && c.command === 9);
    expect(resumeCommands).toHaveLength(0);

    // vmSuspended should be true
    expect(client.vmSuspended).toBe(true);
  });

  it("should keep VM suspended on ClassPrepare event", async () => {
    await client.connect("127.0.0.1", serverPort);
    commandsSent = [];

    // Send a ClassPrepare event with SuspendPolicy.All
    const cpData = buildClassPrepareData(1, 1n, 100n, "Lcom/example/Test;", 7);
    const eventPacket = buildEventPacket(SuspendPolicy.All, [
      { kind: EventKind.ClassPrepare, data: cpData },
    ]);
    serverSocket!.write(eventPacket);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // The client should NOT have sent a Resume command (ClassPrepare preserves suspend
    // so breakpoints can be set before execution continues)
    const resumeCommands = commandsSent.filter((c) => c.commandSet === 1 && c.command === 9);
    expect(resumeCommands).toHaveLength(0);

    // vmSuspended should be true
    expect(client.vmSuspended).toBe(true);
  });

  it("should emit vmstart event on VMStart", async () => {
    await client.connect("127.0.0.1", serverPort);

    const vmstartPromise = new Promise<{ requestId: number; threadId: bigint }>((resolve) => {
      client.on("vmstart", resolve);
    });

    const vmStartData = buildVMStartData(0, 42n);
    const eventPacket = buildEventPacket(SuspendPolicy.All, [
      { kind: EventKind.VMStart, data: vmStartData },
    ]);
    serverSocket!.write(eventPacket);

    const ev = await vmstartPromise;
    expect(ev.requestId).toBe(0);
    expect(ev.threadId).toBe(42n);
  });

  it("should clear vmSuspended when resumeVM is called", async () => {
    await client.connect("127.0.0.1", serverPort);
    commandsSent = [];

    // Trigger VMStart to set vmSuspended=true
    const vmStartData = buildVMStartData(0, 1n);
    const eventPacket = buildEventPacket(SuspendPolicy.All, [
      { kind: EventKind.VMStart, data: vmStartData },
    ]);
    serverSocket!.write(eventPacket);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.vmSuspended).toBe(true);

    // Now resume
    await client.resumeVM();
    expect(client.vmSuspended).toBe(false);
  });

  it("should NOT set vmSuspended for Breakpoint with SuspendPolicy.EventThread", async () => {
    await client.connect("127.0.0.1", serverPort);
    commandsSent = [];

    // Build a Breakpoint event with SuspendPolicy.EventThread (default for breakpoints)
    const bpData = buildBreakpointData(1, 42n, 1, 100n, 200n, 0n);
    const eventPacket = buildEventPacket(SuspendPolicy.EventThread, [
      { kind: EventKind.Breakpoint, data: bpData },
    ]);
    serverSocket!.write(eventPacket);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should NOT auto-resume (breakpoint is a suspend-preserving event)
    const resumeCommands = commandsSent.filter((c) => c.commandSet === 1 && c.command === 9);
    expect(resumeCommands).toHaveLength(0);

    // vmSuspended should be false — only the hitting thread is suspended, not the whole VM
    expect(client.vmSuspended).toBe(false);

    // But the thread should be tracked as suspended
    expect(client.allSuspendedThreadIds).toContain(42n);
  });

  it("should set vmSuspended for Breakpoint with SuspendPolicy.All", async () => {
    await client.connect("127.0.0.1", serverPort);
    commandsSent = [];

    const bpData = buildBreakpointData(1, 42n, 1, 100n, 200n, 0n);
    const eventPacket = buildEventPacket(SuspendPolicy.All, [
      { kind: EventKind.Breakpoint, data: bpData },
    ]);
    serverSocket!.write(eventPacket);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // vmSuspended should be true — SuspendPolicy.All means entire VM is paused
    expect(client.vmSuspended).toBe(true);
    expect(client.allSuspendedThreadIds).toContain(42n);
  });
});
