// Pure-JS PNG downscaling (box filter) so screenshots stay small on every platform.
import { PNG } from 'pngjs';

export function downscalePng(data: Buffer, maxSize: number): { png: Buffer; width: number; height: number; srcWidth: number; srcHeight: number; blank: boolean } {
  const src = PNG.sync.read(data);
  const scale = Math.min(1, maxSize / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  let out: PNG;
  if (scale === 1) out = src;
  else {
    out = new PNG({ width: w, height: h });
    const fx = src.width / w;
    const fy = src.height / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * fy);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * fx);
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let sy = y0; sy < y1 && sy < src.height; sy++) {
          for (let sx = x0; sx < x1 && sx < src.width; sx++) {
            const i = (sy * src.width + sx) * 4;
            r += src.data[i]!;
            g += src.data[i + 1]!;
            b += src.data[i + 2]!;
            a += src.data[i + 3]!;
            n++;
          }
        }
        const o = (y * w + x) * 4;
        out.data[o] = r / n;
        out.data[o + 1] = g / n;
        out.data[o + 2] = b / n;
        out.data[o + 3] = a / n;
      }
    }
  }
  // Blank detection: sample a grid and see whether every pixel equals the first.
  let varied = false;
  const first = out.data.readUInt32BE(0);
  for (let y = 0; y < out.height && !varied; y += Math.max(1, Math.floor(out.height / 24))) {
    for (let x = 0; x < out.width; x += Math.max(1, Math.floor(out.width / 24))) {
      if (out.data.readUInt32BE((y * out.width + x) * 4) !== first) {
        varied = true;
        break;
      }
    }
  }
  return { png: PNG.sync.write(out), width: out.width, height: out.height, srcWidth: src.width, srcHeight: src.height, blank: !varied };
}
