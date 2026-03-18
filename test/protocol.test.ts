import { describe, it, expect } from "vitest";
import {
  JDWPWriter,
  JDWPReader,
  buildCommandPacket,
  hasCompletePacket,
  getPacketLength,
  isReplyPacket,
} from "../src/jdwp/protocol.js";
import { Tag } from "../src/jdwp/constants.js";

const defaultIDSizes = {
  fieldIDSize: 8,
  methodIDSize: 8,
  objectIDSize: 8,
  referenceTypeIDSize: 8,
  frameIDSize: 8,
};

describe("JDWPWriter", () => {
  it("should write byte", () => {
    const writer = new JDWPWriter();
    writer.writeByte(0x42);
    const buf = writer.toBuffer();
    expect(buf.length).toBe(1);
    expect(buf[0]).toBe(0x42);
  });

  it("should write boolean", () => {
    const writer = new JDWPWriter();
    writer.writeBoolean(true);
    writer.writeBoolean(false);
    const buf = writer.toBuffer();
    expect(buf[0]).toBe(1);
    expect(buf[1]).toBe(0);
  });

  it("should write short (big-endian)", () => {
    const writer = new JDWPWriter();
    writer.writeShort(0x1234);
    const buf = writer.toBuffer();
    expect(buf[0]).toBe(0x12);
    expect(buf[1]).toBe(0x34);
  });

  it("should write int (big-endian)", () => {
    const writer = new JDWPWriter();
    writer.writeInt(0x12345678);
    const buf = writer.toBuffer();
    expect(buf.readInt32BE(0)).toBe(0x12345678);
  });

  it("should write long (big-endian)", () => {
    const writer = new JDWPWriter();
    writer.writeLong(0x123456789abcdef0n);
    const buf = writer.toBuffer();
    expect(buf.readBigInt64BE(0)).toBe(0x123456789abcdef0n);
  });

  it("should write string with length prefix", () => {
    const writer = new JDWPWriter();
    writer.writeString("hello");
    const buf = writer.toBuffer();
    // 4 bytes length + 5 bytes "hello"
    expect(buf.length).toBe(9);
    expect(buf.readInt32BE(0)).toBe(5);
    expect(buf.subarray(4).toString("utf-8")).toBe("hello");
  });

  it("should write objectID with correct size", () => {
    const writer = new JDWPWriter({ ...defaultIDSizes, objectIDSize: 4 });
    writer.writeObjectID(0x12345678n);
    const buf = writer.toBuffer();
    expect(buf.length).toBe(4);
    expect(buf.readUInt32BE(0)).toBe(0x12345678);
  });

  it("should write location", () => {
    const writer = new JDWPWriter(defaultIDSizes);
    writer.writeLocation(1, 100n, 200n, 300n);
    const buf = writer.toBuffer();
    // 1 byte typeTag + 8 byte classID + 8 byte methodID + 8 byte index = 25
    expect(buf.length).toBe(25);
    expect(buf[0]).toBe(1);
  });

  it("should concatenate multiple writes", () => {
    const writer = new JDWPWriter();
    writer.writeByte(1).writeInt(42).writeString("hi");
    const buf = writer.toBuffer();
    // 1 + 4 + (4 + 2) = 11
    expect(buf.length).toBe(11);
  });
});

describe("JDWPReader", () => {
  it("should read byte", () => {
    const buf = Buffer.from([0x42]);
    const reader = new JDWPReader(buf);
    expect(reader.readByte()).toBe(0x42);
  });

  it("should read boolean", () => {
    const buf = Buffer.from([1, 0]);
    const reader = new JDWPReader(buf);
    expect(reader.readBoolean()).toBe(true);
    expect(reader.readBoolean()).toBe(false);
  });

  it("should read int (big-endian)", () => {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(12345, 0);
    const reader = new JDWPReader(buf);
    expect(reader.readInt()).toBe(12345);
  });

  it("should read long (big-endian)", () => {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(123456789n, 0);
    const reader = new JDWPReader(buf);
    expect(reader.readLong()).toBe(123456789n);
  });

  it("should read string", () => {
    const str = "hello";
    const strBuf = Buffer.from(str, "utf-8");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeInt32BE(strBuf.length, 0);
    const buf = Buffer.concat([lenBuf, strBuf]);
    const reader = new JDWPReader(buf);
    expect(reader.readString()).toBe("hello");
  });

  it("should read objectID with correct size", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(0xdeadbeef, 0);
    const reader = new JDWPReader(buf, { ...defaultIDSizes, objectIDSize: 4 });
    expect(reader.readObjectID()).toBe(0xdeadbeefn);
  });

  it("should track remaining bytes", () => {
    const buf = Buffer.alloc(10);
    const reader = new JDWPReader(buf);
    expect(reader.remaining).toBe(10);
    reader.readByte();
    expect(reader.remaining).toBe(9);
    reader.readInt();
    expect(reader.remaining).toBe(5);
  });

  it("should read primitive values by tag", () => {
    const writer = new JDWPWriter();
    writer.writeInt(42); // Int value
    const buf = writer.toBuffer();
    const reader = new JDWPReader(buf);
    const val = reader.readValue(Tag.Int);
    expect(val.tag).toBe(Tag.Int);
    expect(val.value).toBe(42);
  });

  it("should read boolean value by tag", () => {
    const buf = Buffer.from([1]);
    const reader = new JDWPReader(buf);
    const val = reader.readValue(Tag.Boolean);
    expect(val.tag).toBe(Tag.Boolean);
    expect(val.value).toBe(true);
  });

  it("should read null value by tag", () => {
    const reader = new JDWPReader(Buffer.alloc(0));
    const val = reader.readValue(Tag.Null);
    expect(val.value).toBeNull();
  });

  it("should read location", () => {
    const writer = new JDWPWriter(defaultIDSizes);
    writer.writeByte(1); // typeTag
    writer.writeReferenceTypeID(100n);
    writer.writeMethodID(200n);
    writer.writeLong(300n);
    const reader = new JDWPReader(writer.toBuffer(), defaultIDSizes);
    const loc = reader.readLocation();
    expect(loc.typeTag).toBe(1);
    expect(loc.classID).toBe(100n);
    expect(loc.methodID).toBe(200n);
    expect(loc.index).toBe(300n);
  });
});

describe("Writer/Reader roundtrip", () => {
  it("should roundtrip complex data", () => {
    const sizes = defaultIDSizes;
    const writer = new JDWPWriter(sizes);
    writer.writeByte(5);
    writer.writeInt(-1);
    writer.writeLong(9999999999n);
    writer.writeString("test string with unicode: こんにちは");
    writer.writeObjectID(42n);

    const reader = new JDWPReader(writer.toBuffer(), sizes);
    expect(reader.readByte()).toBe(5);
    expect(reader.readInt()).toBe(-1);
    expect(reader.readLong()).toBe(9999999999n);
    expect(reader.readString()).toBe("test string with unicode: こんにちは");
    expect(reader.readObjectID()).toBe(42n);
    expect(reader.remaining).toBe(0);
  });
});

describe("Packet functions", () => {
  it("should build a command packet with correct header", () => {
    const data = Buffer.from([1, 2, 3]);
    const packet = buildCommandPacket(42, 1, 7, data);
    // length=11+3=14, id=42, flags=0, commandSet=1, command=7
    expect(packet.length).toBe(14);
    expect(packet.readInt32BE(0)).toBe(14); // length
    expect(packet.readInt32BE(4)).toBe(42); // id
    expect(packet.readUInt8(8)).toBe(0); // flags
    expect(packet.readUInt8(9)).toBe(1); // commandSet
    expect(packet.readUInt8(10)).toBe(7); // command
    expect(packet[11]).toBe(1);
    expect(packet[12]).toBe(2);
    expect(packet[13]).toBe(3);
  });

  it("should build a command packet without data", () => {
    const packet = buildCommandPacket(1, 15, 3);
    expect(packet.length).toBe(11);
    expect(packet.readInt32BE(0)).toBe(11);
  });

  it("should detect complete packets", () => {
    // Empty buffer
    expect(hasCompletePacket(Buffer.alloc(0))).toBe(false);
    // Too short
    expect(hasCompletePacket(Buffer.from([0, 0, 0]))).toBe(false);
    // Length says 11 but only 4 bytes
    const incomplete = Buffer.alloc(4);
    incomplete.writeInt32BE(11, 0);
    expect(hasCompletePacket(incomplete)).toBe(false);
    // Complete
    const complete = Buffer.alloc(11);
    complete.writeInt32BE(11, 0);
    expect(hasCompletePacket(complete)).toBe(true);
  });

  it("should get packet length", () => {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(42, 0);
    expect(getPacketLength(buf)).toBe(42);
    expect(getPacketLength(Buffer.alloc(2))).toBe(-1);
  });

  it("should detect reply packets", () => {
    const cmd = Buffer.alloc(11);
    cmd.writeUInt8(0, 8); // flags=0 → command
    expect(isReplyPacket(cmd)).toBe(false);

    const reply = Buffer.alloc(11);
    reply.writeUInt8(0x80, 8); // flags=0x80 → reply
    expect(isReplyPacket(reply)).toBe(true);
  });
});
