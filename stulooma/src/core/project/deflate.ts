import { fail } from '../validation/project';

// RFC 1951 token inspection, without materializing output. ZIP size fields alone
// are untrusted: an attacker can declare a tiny size for an enormous bitstream.
class Bits {
  position = 0;
  constructor(readonly data: Uint8Array) {}
  read(length: number): number {
    if (this.position + length > this.data.length * 8) fail('DEFLATE: 잘린 비트 스트림입니다.');
    let value = 0;
    for (let bit = 0; bit < length; bit++) value |= ((this.data[this.position >>> 3]! >>> (this.position++ & 7)) & 1) << bit;
    return value;
  }
}

interface Tree { table: Int32Array; maximum: number }
function tree(lengths: number[]): Tree {
  const maximum = Math.max(...lengths);
  if (maximum > 15 || maximum < 1) fail('DEFLATE: 허프만 코드가 올바르지 않습니다.');
  const counts = new Int32Array(16), next = new Int32Array(16);
  for (const length of lengths) if (length) counts[length]++;
  let code = 0, available = 1;
  for (let bits = 1; bits <= maximum; bits++) {
    available = available * 2 - counts[bits]!;
    if (available < 0) fail('DEFLATE: 중복 허프만 코드입니다.');
    code = (code + counts[bits - 1]!) << 1; next[bits] = code;
  }
  const table = new Int32Array(1 << maximum);
  lengths.forEach((length, symbol) => {
    if (!length) return;
    let canonical = next[length]++, reversed = 0;
    for (let bit = 0; bit < length; bit++) { reversed = (reversed << 1) | (canonical & 1); canonical >>>= 1; }
    for (let index = reversed; index < table.length; index += 1 << length) table[index] = (symbol << 5) | length;
  });
  return { table, maximum };
}

function symbol(bits: Bits, codes: Tree): number {
  const byte = bits.position >>> 3, shift = bits.position & 7;
  const peek = ((bits.data[byte] ?? 0) | ((bits.data[byte + 1] ?? 0) << 8) | ((bits.data[byte + 2] ?? 0) << 16)) >>> shift;
  const entry = codes.table[peek & ((1 << codes.maximum) - 1)]!;
  const length = entry & 31;
  if (!length || bits.position + length > bits.data.length * 8) fail('DEFLATE: 유효하지 않은 허프만 기호입니다.');
  bits.position += length; return entry >>> 5;
}

const fixedLiterals = tree(Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
const fixedDistances = tree(Array(32).fill(5));
const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const distanceBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const distanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

export function inspectDeflate(data: Uint8Array, expectedSize: number): void {
  const bits = new Bits(data);
  let output = 0, final = 0;
  const add = (size: number) => { output += size; if (output > expectedSize) fail('DEFLATE: 실제 압축 해제 크기가 선언된 제한을 초과합니다.'); };
  do {
    final = bits.read(1); const mode = bits.read(2);
    if (mode === 0) {
      bits.position = Math.ceil(bits.position / 8) * 8;
      const length = bits.read(16), complement = bits.read(16);
      if ((length ^ complement) !== 65535 || bits.position + length * 8 > data.length * 8) fail('DEFLATE: 저장 블록 크기가 손상되었습니다.');
      add(length); bits.position += length * 8; continue;
    }
    if (mode === 3) fail('DEFLATE: 예약된 블록 유형입니다.');
    let literals = fixedLiterals, distances = fixedDistances;
    if (mode === 2) {
      const literalCount = bits.read(5) + 257, distanceCount = bits.read(5) + 1, codeCount = bits.read(4) + 4;
      if (literalCount > 286) fail('DEFLATE: 리터럴 코드 수가 올바르지 않습니다.');
      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const codeLengths = Array<number>(19).fill(0);
      for (let index = 0; index < codeCount; index++) codeLengths[order[index]!] = bits.read(3);
      const codes = tree(codeLengths), lengths: number[] = [];
      while (lengths.length < literalCount + distanceCount) {
        const value = symbol(bits, codes);
        if (value < 16) lengths.push(value);
        else {
          const repeated = value === 16 ? lengths.at(-1) : 0;
          if (repeated === undefined || value > 18) fail('DEFLATE: 코드 반복이 올바르지 않습니다.');
          const count = value === 16 ? bits.read(2) + 3 : value === 17 ? bits.read(3) + 3 : bits.read(7) + 11;
          if (lengths.length + count > literalCount + distanceCount) fail('DEFLATE: 코드 반복이 범위를 벗어났습니다.');
          for (let index = 0; index < count; index++) lengths.push(repeated);
        }
      }
      if (!lengths[256]) fail('DEFLATE: 종료 기호가 없습니다.');
      literals = tree(lengths.slice(0, literalCount));
      const distanceLengths = lengths.slice(literalCount);
      // A literals-only block may have one unused distance code of length zero.
      distances = distanceLengths.every((length) => length === 0) ? { table: new Int32Array(2), maximum: 1 } : tree(distanceLengths);
    }
    for (;;) {
      const value = symbol(bits, literals);
      if (value < 256) { add(1); continue; }
      if (value === 256) break;
      if (value > 285) fail('DEFLATE: 예약된 길이 기호입니다.');
      const index = value - 257, length = lengthBase[index]! + bits.read(lengthExtra[index]!);
      const distanceCode = symbol(bits, distances);
      if (distanceCode > 29) fail('DEFLATE: 예약된 거리 기호입니다.');
      const distance = distanceBase[distanceCode]! + bits.read(distanceExtra[distanceCode]!);
      if (distance > output) fail('DEFLATE: 이전 데이터 범위를 벗어난 참조입니다.');
      add(length);
    }
  } while (!final);
  if (output !== expectedSize || Math.ceil(bits.position / 8) !== data.length) fail('DEFLATE: 실제 데이터 길이가 일치하지 않습니다.');
}
