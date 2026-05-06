import crypto from 'crypto';
import { config } from './config';

const FINGERPRINT_PREFIX = 'wf1_';
const ZERO_START = '\u2063';
const ZERO_END = '\u2060';
const ZERO_ZERO = '\u200b';
const ZERO_ONE = '\u200c';

export interface DownloadFingerprintInput {
  downloadId: number;
  userId: number;
  workId: number;
  versionId: number | null;
  createdAt: string;
  nonce: string;
}

function hmac(value: string): string {
  return crypto.createHmac('sha256', config.fingerprintSecret).update(value).digest('base64url');
}

export function createFingerprintNonce(): string {
  return crypto.randomBytes(12).toString('base64url');
}

export function createFingerprintToken(input: DownloadFingerprintInput): string {
  const raw = [
    input.downloadId,
    input.userId,
    input.workId,
    input.versionId || 0,
    input.createdAt,
    input.nonce,
  ].join(':');
  return `${FINGERPRINT_PREFIX}${hmac(raw).slice(0, 38)}`;
}

export function createDownloadFileToken(downloadId: number, fingerprintToken: string): string {
  return hmac(`download-file:${downloadId}:${fingerprintToken}`).slice(0, 40);
}

function zeroEncode(value: string): string {
  const bits = Buffer.from(value, 'utf8')
    .toString('hex')
    .split('')
    .map(char => parseInt(char, 16).toString(2).padStart(4, '0'))
    .join('');
  return ZERO_START + bits.replace(/0/g, ZERO_ZERO).replace(/1/g, ZERO_ONE) + ZERO_END;
}

function zeroDecode(content: string): string[] {
  const results: string[] = [];
  let start = content.indexOf(ZERO_START);
  while (start >= 0) {
    const end = content.indexOf(ZERO_END, start + ZERO_START.length);
    if (end < 0) break;
    const encoded = content.slice(start + ZERO_START.length, end);
    const bits = [...encoded].map(char => char === ZERO_ONE ? '1' : char === ZERO_ZERO ? '0' : '').join('');
    if (bits.length && bits.length % 8 === 0) {
      try {
        const bytes: number[] = [];
        for (let i = 0; i < bits.length; i += 8) {
          bytes.push(parseInt(bits.slice(i, i + 8), 2));
        }
        const decoded = Buffer.from(bytes).toString('utf8');
        if (isFingerprintToken(decoded)) results.push(decoded);
      } catch { /* ignore invalid marker */ }
    }
    start = content.indexOf(ZERO_START, end + ZERO_END.length);
  }
  return results;
}

export function isFingerprintToken(value: string): boolean {
  return /^wf1_[A-Za-z0-9_-]{20,80}$/.test(value.trim());
}

export function extractFingerprintTokenFromText(content: string): string | undefined {
  const direct = content.match(/wf1_[A-Za-z0-9_-]{20,80}/)?.[0];
  if (direct) return direct;
  return zeroDecode(content).at(0);
}

function attachJsonFingerprint(value: unknown, token: string): boolean {
  const attach = (target: any): boolean => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return false;
    if (target.extensions && typeof target.extensions === 'object' && !Array.isArray(target.extensions)) {
      target.extensions.ws = token;
    } else {
      target._ws = { v: 1, k: token };
    }
    return true;
  };

  if (Array.isArray(value)) {
    const target = value.find(item => item && typeof item === 'object' && !Array.isArray(item));
    return attach(target);
  }
  return attach(value);
}

export function embedTextFingerprint(content: string, token: string): string {
  try {
    const parsed = JSON.parse(content);
    if (attachJsonFingerprint(parsed, token)) {
      return JSON.stringify(parsed, null, 2);
    }
    return content;
  } catch {
    return `${content}${zeroEncode(token)}`;
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let crcTable: number[] | null = null;

function getCrcTable(): number[] {
  if (crcTable) return crcTable;
  crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(buffer: Buffer): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function isPng(buffer: Buffer): boolean {
  return buffer.length > 16 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

export function embedPngFingerprint(buffer: Buffer, token: string): Buffer {
  if (!isPng(buffer)) return buffer;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const next = offset + 12 + length;
    if (next > buffer.length) return buffer;
    if (type === 'IEND') {
      const textChunk = makePngChunk('tEXt', Buffer.from(`ws\0${token}`, 'latin1'));
      return Buffer.concat([buffer.subarray(0, offset), textChunk, buffer.subarray(offset)]);
    }
    offset = next;
  }
  return buffer;
}

export function extractFingerprintTokenFromBuffer(buffer: Buffer): string | undefined {
  if (!isPng(buffer)) return extractFingerprintTokenFromText(buffer.toString('utf8'));
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const next = offset + 12 + length;
    if (next > buffer.length) break;
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const found = extractFingerprintTokenFromText(buffer.subarray(dataStart, dataEnd).toString('latin1'));
      if (found) return found;
    }
    offset = next;
  }
  return undefined;
}
