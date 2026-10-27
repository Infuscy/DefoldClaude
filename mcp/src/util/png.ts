// Pure-JS PNG downscaling (box filter) so screenshots stay small on every platform, and contact sheets for bursts.
import { PNG } from 'pngjs';

export function downscalePng(data: Buffer, maxSize: number): { png: Buffer; width: number; height: number; srcWidth: number; srcHeight: number; blank: boolean } {
  const src = PNG.sync.read(data);
  const out = scaleImage(src, maxSize);
  return { png: PNG.sync.write(out), width: out.width, height: out.height, srcWidth: src.width, srcHeight: src.height, blank: isBlank(out) };
}

function scaleImage(src: PNG, maxSize: number): PNG {
  const scale = Math.min(1, maxSize / Math.max(src.width, src.height));
  if (scale === 1) return src;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new PNG({ width: w, height: h });
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
  return out;
}

/** Blank detection: sample a grid and see whether every pixel equals the first. */
function isBlank(img: PNG): boolean {
  const first = img.data.readUInt32BE(0);
  for (let y = 0; y < img.height; y += Math.max(1, Math.floor(img.height / 24))) {
    for (let x = 0; x < img.width; x += Math.max(1, Math.floor(img.width / 24))) {
      if (img.data.readUInt32BE((y * img.width + x) * 4) !== first) return false;
    }
  }
  return true;
}

export interface ContactSheet {
  png: Buffer;
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Percent of pixels that changed between frame i and i+1 (length frames - 1). */
  changes: number[];
}

const GAP = 4;

/** Lay frames out left to right, top to bottom, numbered from 1, with the longest side at most `maxSize`. */
export function contactSheet(frames: Buffer[], maxSize: number): ContactSheet {
  const images = frames.map((f) => PNG.sync.read(f));
  const cols = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / cols);
  const fw = images[0]!.width;
  const fh = images[0]!.height;
  const scale = Math.min(1, (maxSize - GAP * (cols - 1)) / (cols * fw), (maxSize - GAP * (rows - 1)) / (rows * fh));
  const cw = Math.max(1, Math.floor(fw * scale));
  const ch = Math.max(1, Math.floor(fh * scale));
  const cells = images.map((img) => scaleImage(img, Math.max(cw, ch)));

  const sheet = new PNG({ width: cols * cw + GAP * (cols - 1), height: rows * ch + GAP * (rows - 1) });
  fillRect(sheet, 0, 0, sheet.width, sheet.height, [32, 32, 32]);
  cells.forEach((cell, i) => {
    const ox = (i % cols) * (cw + GAP);
    const oy = Math.floor(i / cols) * (ch + GAP);
    PNG.bitblt(cell, sheet, 0, 0, Math.min(cell.width, cw), Math.min(cell.height, ch), ox, oy);
    drawNumber(sheet, ox + 2, oy + 2, i + 1, Math.max(2, Math.round(ch / 90)));
  });
  const changes = cells.slice(1).map((cell, i) => changedPercent(cells[i]!, cell));
  return { png: PNG.sync.write(sheet), width: sheet.width, height: sheet.height, cols, rows, changes };
}

/** Share of pixels whose largest channel difference exceeds a small threshold (ignores compression-like noise). */
export function changedPercent(a: PNG, b: PNG): number {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      const d = Math.max(Math.abs(a.data[i]! - b.data[j]!), Math.abs(a.data[i + 1]! - b.data[j + 1]!), Math.abs(a.data[i + 2]! - b.data[j + 2]!));
      if (d > 24) changed++;
    }
  }
  return Math.round((changed / (w * h)) * 1000) / 10;
}

function fillRect(img: PNG, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]): void {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
  }
}

// 3x5 digit glyphs, one row per string.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

/** White digits on a black box, `px` screen pixels per glyph pixel. */
function drawNumber(img: PNG, x: number, y: number, n: number, px: number): void {
  const text = String(n);
  fillRect(img, x, y, (text.length * 4 + 1) * px, 7 * px, [0, 0, 0]);
  [...text].forEach((c, k) => {
    const glyph = DIGITS[Number(c)]!;
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy * 3 + gx] === '1') fillRect(img, x + (1 + k * 4 + gx) * px, y + (1 + gy) * px, px, px, [255, 255, 255]);
      }
    }
  });
}
