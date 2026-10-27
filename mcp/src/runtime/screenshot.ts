// OS-level capture of the game window (Windows). Uses PrintWindow(PW_RENDERFULLCONTENT) so the window
// does not need focus; the result is cropped to the client area and downscaled.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { cacheRoot } from '../env/platform.js';

const pexecFile = promisify(execFile);

const CAPTURE_PS1 = String.raw`param([int]$ProcessId, [string]$OutFile, [int]$MaxSize = 1024, [int]$Frames = 1, [int]$IntervalMs = 0)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class DefoldCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  public static void Init() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {} }
  public static string Capture(IntPtr hwnd, string outFile, int maxSize) {
    if (IsIconic(hwnd)) return "error minimized";
    RECT wr; GetWindowRect(hwnd, out wr);
    int ww = wr.Right - wr.Left, wh = wr.Bottom - wr.Top;
    RECT cr; GetClientRect(hwnd, out cr);
    POINT p = new POINT(); ClientToScreen(hwnd, ref p);
    int cx = p.X - wr.Left, cy = p.Y - wr.Top, cw = cr.Right - cr.Left, ch = cr.Bottom - cr.Top;
    if (ww <= 0 || wh <= 0 || cw <= 0 || ch <= 0) return "error empty-window";
    using (var full = new Bitmap(ww, wh, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(full)) {
        IntPtr hdc = g.GetHdc();
        bool ok = PrintWindow(hwnd, hdc, 2);
        g.ReleaseHdc(hdc);
        if (!ok) return "error printwindow-failed";
      }
      using (var client = full.Clone(new Rectangle(cx, cy, Math.Min(cw, ww - cx), Math.Min(ch, wh - cy)), PixelFormat.Format32bppArgb)) {
        double scale = Math.Min(1.0, (double)maxSize / Math.Max(client.Width, client.Height));
        int ow = Math.Max(1, (int)Math.Round(client.Width * scale)), oh = Math.Max(1, (int)Math.Round(client.Height * scale));
        using (var outBmp = new Bitmap(ow, oh, PixelFormat.Format24bppRgb)) {
          using (var g2 = Graphics.FromImage(outBmp)) {
            g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g2.DrawImage(client, 0, 0, ow, oh);
          }
          int varied = 0; int first = outBmp.GetPixel(0, 0).ToArgb();
          int sy = Math.Max(1, oh / 24), sx = Math.Max(1, ow / 24);
          for (int y = 0; y < oh; y += sy) for (int x = 0; x < ow; x += sx) if (outBmp.GetPixel(x, y).ToArgb() != first) varied++;
          outBmp.Save(outFile, ImageFormat.Png);
          return String.Format("ok {0} {1} {2} {3} {4}", ow, oh, client.Width, client.Height, varied);
        }
      }
    }
  }
}
"@
[DefoldCapture]::Init()
$proc = Get-Process -Id $ProcessId
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "error no-window"; exit 0 }
# One process for a whole burst: compiling the helper above takes about a second, one capture a few dozen ms.
$clock = [System.Diagnostics.Stopwatch]::StartNew()
for ($i = 0; $i -lt $Frames; $i++) {
  $wait = $i * $IntervalMs - $clock.ElapsedMilliseconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
  $at = $clock.ElapsedMilliseconds
  $file = $OutFile -replace '\.png$', "-$i.png"
  Write-Output ("{0} {1}" -f [DefoldCapture]::Capture($hwnd, $file, $MaxSize), $at)
}
`;

export interface Capture {
  png: Buffer;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  /** True when the sampled pixels were all identical (black or blank frame). */
  blank: boolean;
  /** Milliseconds after the first frame of a burst. */
  atMs: number;
}

export async function captureWindow(pid: number, maxSize: number): Promise<Capture> {
  return (await captureWindowFrames(pid, maxSize, 1, 0))[0]!;
}

/** Capture `frames` images of the window, `intervalMs` apart, in one PowerShell run. */
export async function captureWindowFrames(pid: number, maxSize: number, frames: number, intervalMs: number): Promise<Capture[]> {
  if (process.platform !== 'win32') {
    throw new Error(
      'Game window capture is only implemented on Windows. Use screenshot source=preview (editor) or add the Defold Automation Bridge extension for in-engine screenshots.',
    );
  }
  const scriptDir = path.join(cacheRoot(), 'scripts');
  const script = path.join(scriptDir, 'capture-v2.ps1');
  if (!fs.existsSync(script)) {
    await fsp.mkdir(scriptDir, { recursive: true });
    await fsp.writeFile(script, CAPTURE_PS1, 'utf8');
  }
  const out = path.join(os.tmpdir(), `defold-shot-${process.pid}-${Date.now()}.png`);
  const files = Array.from({ length: frames }, (_, i) => out.replace(/\.png$/, `-${i}.png`));
  try {
    const { stdout } = await pexecFile(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-ProcessId', String(pid), '-OutFile', out, '-MaxSize', String(maxSize), '-Frames', String(frames), '-IntervalMs', String(intervalMs),
      ],
      { windowsHide: true, timeout: 30_000 + frames * intervalMs },
    );
    if (/^error no-window/m.test(stdout)) throw new Error('The game process has no visible window yet.');
    const lines = stdout.trim().split(/\r?\n/).filter((l) => /^(ok|error) /.test(l));
    const shots: Capture[] = [];
    for (let i = 0; i < frames; i++) {
      const line = lines[i] ?? 'error missing-frame';
      if (!line.startsWith('ok ')) {
        const reason = line.split(' ')[1] ?? 'unknown';
        throw new Error(reason === 'minimized' ? 'The game window is minimized; restore it and try again.' : `Window capture failed (${reason}).`);
      }
      const [, w, h, sw, sh, varied, at] = line.split(' ');
      const png = await fsp.readFile(files[i]!);
      shots.push({ png, width: Number(w), height: Number(h), sourceWidth: Number(sw), sourceHeight: Number(sh), blank: Number(varied) === 0, atMs: Number(at) });
    }
    return shots;
  } finally {
    await Promise.all(files.map((f) => fsp.rm(f, { force: true })));
  }
}
