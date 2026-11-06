// Minimal read-only ZIP reader for E2E file-content checks (TEST-ONLY).
//
// An .xlsx is a ZIP of XML parts. The spec needs only to read a few named
// entries (xl/sharedStrings.xml, xl/worksheets/sheet1.xml), so this walks the
// central directory and inflates with Node's built-in zlib: no new dependency,
// works the same on Linux and Windows (no `unzip` binary needed).
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Every entry of the ZIP at `file`, name -> uncompressed bytes. */
export function readZipEntries(file: string): Map<string, Buffer> {
  const buf = readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${file}: not a ZIP (no end-of-central-directory record)`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error(`${file}: bad central directory entry ${n}`);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(local) !== LOC_SIG) throw new Error(`${file}: bad local header for ${name}`);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`${file}: entry ${name} uses unsupported method ${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
