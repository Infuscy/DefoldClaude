// Tiny protobuf encoder for the handful of engine messages we post (Reload, Exit, Resize).

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  while (v > 127) {
    out.push((v & 127) | 128);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

export function encodeString(field: number, s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8');
  return Buffer.concat([Buffer.from([(field << 3) | 2, ...varint(bytes.length)]), bytes]);
}

export function encodeVarint(field: number, n: number): Buffer {
  return Buffer.from([(field << 3) | 0, ...varint(n)]);
}

/** dmResourceDDF.Reload { repeated string resources = 1 } split into posts of at most `maxBytes`. */
export function encodeReloadBatches(resources: string[], maxBytes = 1000): Buffer[] {
  const batches: Buffer[] = [];
  let current: Buffer[] = [];
  let size = 0;
  for (const r of resources) {
    const enc = encodeString(1, r);
    if (size + enc.length > maxBytes && current.length) {
      batches.push(Buffer.concat(current));
      current = [];
      size = 0;
    }
    current.push(enc);
    size += enc.length;
  }
  if (current.length) batches.push(Buffer.concat(current));
  return batches;
}

/** dmSystemDDF.Exit { required int32 code = 1 } */
export function encodeExit(code = 0): Buffer {
  return encodeVarint(1, code);
}

/** dmRenderDDF.Resize { required uint32 width = 1; required uint32 height = 2 } */
export function encodeResize(width: number, height: number): Buffer {
  return Buffer.concat([encodeVarint(1, width), encodeVarint(2, height)]);
}
