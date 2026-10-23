import { BossProtocolError, bossId } from './boss-protobuf.js';
import type { BossId } from './boss-protobuf.js';

/** MQTT protocol level 4, including this client's nonstandard 18-byte PUBACK. */
export type BossMqttPacket =
  | { type: 'connack'; sessionPresent: boolean; returnCode: number }
  | { type: 'publish'; topic: string; packetId?: number; qos: 0 | 1 | 2; retained: boolean; duplicate: boolean; payload: Uint8Array }
  | { type: 'puback'; packetId: number; cmid?: string; mid?: string; extended: boolean }
  | { type: 'suback'; packetId: number; returnCodes: number[] }
  | { type: 'pubrec' | 'pubrel' | 'pubcomp' | 'unsuback'; packetId: number }
  | { type: 'pingresp' | 'disconnect' }
  | { type: 'unknown'; packetType: number; flags: number; payload: Uint8Array };
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MQTT_MAX_REMAINING_LENGTH = 268435455;
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
}
function uint16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new BossProtocolError('Value must fit uint16');
  return Uint8Array.of(value >> 8, value & 255);
}
function packetIdentifier(value: number): Uint8Array {
  if (value === 0) throw new BossProtocolError('MQTT packet identifier cannot be zero');
  return uint16(value);
}
function utf8(value: string): Uint8Array {
  if (value.includes('\0')) throw new BossProtocolError('MQTT string contains NUL');
  const bytes = encoder.encode(value); return concat([uint16(bytes.length), bytes]);
}
function remainingLength(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > MQTT_MAX_REMAINING_LENGTH) throw new BossProtocolError('MQTT packet too large');
  const out: number[] = [];
  do { let byte = value % 128; value = Math.floor(value / 128); if (value) byte |= 128; out.push(byte); } while (value);
  return Uint8Array.from(out);
}
function frame(first: number, payload: Uint8Array): Uint8Array { return concat([Uint8Array.of(first), remainingLength(payload.length), payload]); }
export function encodeBossMqttConnect(options: { clientId: string; username: string; password: string; keepAlive?: number }): Uint8Array {
  const keepAlive = options.keepAlive ?? 25;
  return frame(0x10, concat([Uint8Array.of(0, 4, 77, 81, 84, 84, 4, 0xc2), uint16(keepAlive), utf8(options.clientId), utf8(options.username), utf8(options.password)]));
}
export function encodeBossMqttSubscribe(packetId: number, topic = 'chat'): Uint8Array {
  return frame(0x82, concat([packetIdentifier(packetId), utf8(topic), Uint8Array.of(1)]));
}
export function encodeBossMqttPublish(options: { packetId?: number; topic?: string; payload: Uint8Array; qos?: 0 | 1 | 2; retained?: boolean; duplicate?: boolean }): Uint8Array {
  const qos = options.qos ?? 1;
  if (qos !== 0 && qos !== 1 && qos !== 2) throw new BossProtocolError('Unsupported PUBLISH QoS');
  if (qos > 0 && options.packetId === undefined) throw new BossProtocolError('QoS PUBLISH requires a packet identifier');
  const flags = (options.duplicate ? 8 : 0) | (qos << 1) | ((options.retained ?? true) ? 1 : 0);
  return frame(0x30 | flags, concat([utf8(options.topic ?? 'chat'), ...(qos > 0 ? [packetIdentifier(options.packetId!)] : []), options.payload]));
}
export function encodeBossMqttPuback(packetId: number): Uint8Array { return frame(0x40, packetIdentifier(packetId)); }
export function encodeBossMqttControl(type: 'pubrec' | 'pubrel' | 'pubcomp', packetId: number): Uint8Array {
  return frame(type === 'pubrec' ? 0x50 : type === 'pubrel' ? 0x62 : 0x70, packetIdentifier(packetId));
}
export function encodeBossMqttPing(): Uint8Array { return Uint8Array.of(0xc0, 0); }
export function encodeBossMqttDisconnect(): Uint8Array { return Uint8Array.of(0xe0, 0); }
function read16(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset], b = bytes[offset + 1];
  if (a === undefined || b === undefined) throw new BossProtocolError('Truncated MQTT uint16');
  return a * 256 + b;
}
function readPacketId(bytes: Uint8Array, offset = 0): number {
  const id = read16(bytes, offset); if (!id) throw new BossProtocolError('MQTT packet identifier cannot be zero'); return id;
}
function read64(bytes: Uint8Array, offset: number): string {
  if (offset + 8 > bytes.length) throw new BossProtocolError('Truncated MQTT uint64');
  let n = 0n; for (let i = 0; i < 8; i++) n = n * 256n + BigInt(bytes[offset + i]!); return n.toString();
}
/** Fixture/helper encoder, not a frame sent by the chat client. */
export function encodeBossExtendedPuback(packetId: number, cmid: BossId, mid: BossId): Uint8Array {
  function uint64(id: BossId): Uint8Array {
    let value = BigInt(bossId(id, true)); const bytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; } return bytes;
  }
  return frame(0x40, concat([packetIdentifier(packetId), uint64(cmid), uint64(mid)]));
}
function decodeFrame(first: number, bytes: Uint8Array): BossMqttPacket {
  const type = first >> 4, flags = first & 15;
  const requireLength = (length: number) => { if (bytes.length !== length) throw new BossProtocolError(`Invalid MQTT type ${type} length`); };
  const expectedFlags = type === 6 || type === 8 || type === 10 ? 2 : 0;
  if (type !== 3 && flags !== expectedFlags) throw new BossProtocolError('Invalid MQTT control flags');
  switch (type) {
    case 2:
      requireLength(2);
      if (bytes[0]! & 0xfe) throw new BossProtocolError('Invalid CONNACK flags');
      return { type: 'connack', sessionPresent: !!(bytes[0]! & 1), returnCode: bytes[1]! };
    case 3: {
      const qos = (flags >> 1) & 3;
      if (qos === 3) throw new BossProtocolError('Invalid PUBLISH QoS');
      const length = read16(bytes, 0), topicEnd = 2 + length;
      if (!length || topicEnd > bytes.length) throw new BossProtocolError('Invalid PUBLISH topic length');
      const topic = decoder.decode(bytes.subarray(2, topicEnd));
      const packetId = qos > 0 ? readPacketId(bytes, topicEnd) : undefined;
      const start = topicEnd + (qos > 0 ? 2 : 0);
      return { type: 'publish', topic, packetId, qos: qos as 0 | 1 | 2, retained: !!(flags & 1), duplicate: !!(flags & 8), payload: bytes.slice(start) };
    }
    case 4:
      if (bytes.length !== 2 && bytes.length !== 18) throw new BossProtocolError('Unsupported PUBACK extension length');
      return { type: 'puback', packetId: readPacketId(bytes), extended: bytes.length === 18, ...(bytes.length === 18 ? { cmid: read64(bytes, 2), mid: read64(bytes, 10) } : {}) };
    case 5: case 6: case 7: case 11:
      requireLength(2);
      return { type: type === 5 ? 'pubrec' : type === 6 ? 'pubrel' : type === 7 ? 'pubcomp' : 'unsuback', packetId: readPacketId(bytes) };
    case 9:
      if (bytes.length < 3) throw new BossProtocolError('Invalid SUBACK');
      return { type: 'suback', packetId: readPacketId(bytes), returnCodes: Array.from(bytes.subarray(2)) };
    case 13: requireLength(0); return { type: 'pingresp' };
    case 14: requireLength(0); return { type: 'disconnect' };
    default: return { type: 'unknown', packetType: type, flags, payload: bytes.slice() };
  }
}
/** Handles both fragmented packets and multiple MQTT packets in one WS message. */
export class BossMqttDecoder {
  #buffer = new Uint8Array(0);
  readonly #maxPacketBytes: number;
  constructor(maxPacketBytes = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxPacketBytes) || maxPacketBytes < 2 || maxPacketBytes > MQTT_MAX_REMAINING_LENGTH + 5) throw new BossProtocolError('Invalid MQTT packet size limit');
    this.#maxPacketBytes = maxPacketBytes;
  }
  get bufferedBytes(): number { return this.#buffer.length; }
  reset(): void { this.#buffer = new Uint8Array(0); }
  push(input: Uint8Array | ArrayBuffer | ArrayBufferView): BossMqttPacket[] {
    const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const all = concat([this.#buffer, bytes]); const packets: BossMqttPacket[] = []; let offset = 0;
    while (offset < all.length) {
      const start = offset, first = all[start]!;
      let index = start + 1, length = 0, multiplier = 1, complete = false;
      for (let i = 0; i < 4; i++) {
        const byte = all[index]; if (byte === undefined) break;
        index++; length += (byte & 127) * multiplier; multiplier *= 128;
        if (!(byte & 128)) { complete = true; break; }
        if (i === 3) throw new BossProtocolError('MQTT remaining length exceeds four bytes');
      }
      if (!complete) break;
      const end = index + length;
      if (end - start > this.#maxPacketBytes) throw new BossProtocolError('MQTT packet exceeds configured limit');
      if (end > all.length) break;
      packets.push(decodeFrame(first, all.subarray(index, end))); offset = end;
    }
    this.#buffer = all.slice(offset);
    if (this.#buffer.length > this.#maxPacketBytes) throw new BossProtocolError('MQTT receive buffer exceeds configured limit');
    return packets;
  }
}
