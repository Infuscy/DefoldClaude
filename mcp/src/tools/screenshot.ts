import { connectEditor, editorPreview } from '../runtime/editor.js';
import { isRunning, type EngineSession } from '../runtime/engine.js';
import { pidForListeningPort } from '../runtime/processes.js';
import { captureWindow, captureWindowFrames } from '../runtime/screenshot.js';
import { bridgeHealth, bridgeScreenshot } from '../runtime/bridge.js';
import { contactSheet, downscalePng } from '../util/png.js';
import { normalizeProjectPath } from '../env/project.js';
import { requireProject } from './common.js';
import { defineTool } from './registry.js';
import { errorResult, imageResult } from './result.js';
import { currentSession } from './run.js';
import { screenshotInput } from './schemas.js';

export const screenshotTool = defineTool({
  name: 'screenshot',
  title: 'Screenshot',
  description:
    `Return a PNG image. source=game captures the running game window (Windows; uses the Automation Bridge when present); frames > 1 returns a numbered contact sheet of frames interval_ms apart plus how much changed between them, to check motion and animation. source=preview renders a scene resource such as a .collection, .go or .gui through the open Defold editor without running the game.`,
  inputSchema: screenshotInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const project = requireProject(args.project);

    if (args.source === 'preview') {
      if (!args.path) return errorResult('source=preview needs "path", e.g. /main/main.collection.');
      const conn = await connectEditor(project);
      if (!conn) return errorResult('Previews are rendered by the Defold editor; open this project in Defold first (or use source=game while the game runs).');
      const { resource } = normalizeProjectPath(project, args.path);
      const size = args.max_size;
      const png = await editorPreview(conn, resource, size, size);
      return imageResult(png.toString('base64'), `Editor preview of ${resource} (${size}x${size} max).`);
    }

    const session = await currentSession(project);
    if (!isRunning(session)) return errorResult('The game is not running. Start it with run action=start, or use source=preview.');
    if (args.frames > 1) return burst(session, args.frames, args.interval_ms, args.max_size);
    if (await bridgeHealth(session)) {
      // In-engine capture through the Automation Bridge: exact frame, works on every platform and when occluded.
      const shot = downscalePng(await bridgeScreenshot(session), args.max_size);
      const note = shot.blank ? ' WARNING: the image is a single colour — the scene may be empty or still loading.' : '';
      return imageResult(
        shot.png.toString('base64'),
        `Game frame ${shot.srcWidth}x${shot.srcHeight} (image ${shot.width}x${shot.height}, captured in-engine).${note}`,
      );
    }
    const pid = await windowPid(session);
    const shot = await captureWindow(pid, args.max_size);
    const note = shot.blank ? ' WARNING: the image looks blank (uniform color) — the scene may be empty, still loading, or the window could not be captured.' : '';
    return imageResult(
      shot.png.toString('base64'),
      `Game window ${shot.sourceWidth}x${shot.sourceHeight} (image ${shot.width}x${shot.height}).${note}`,
    );
  },
});

/** The local process whose window shows the game. */
async function windowPid(session: EngineSession): Promise<number> {
  if (session.backend === 'attached' && !isLoopback(session.serviceUrl)) {
    throw new Error('This engine runs on another machine or device, so its window cannot be captured here. Add the Automation Bridge (/defold:setup-bridge) to capture frames in-engine.');
  }
  const pid = session.pid ?? (session.serviceUrl ? await pidForListeningPort(Number(new URL(session.serviceUrl).port)) : undefined);
  if (!pid) throw new Error('Could not find the game process to capture.');
  return pid;
}

/** Several frames over time in one numbered contact sheet, with how much changed between consecutive frames. */
async function burst(session: EngineSession, frames: number, intervalMs: number, maxSize: number) {
  let shots: Array<{ png: Buffer; atMs: number; sourceWidth?: number; sourceHeight?: number }>;
  let how: string;
  if (await bridgeHealth(session)) {
    how = 'captured in-engine';
    shots = [];
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      const wait = t0 + i * intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const atMs = Date.now() - t0;
      shots.push({ png: await bridgeScreenshot(session), atMs });
    }
  } else {
    how = 'game window';
    shots = await captureWindowFrames(await windowPid(session), maxSize, frames, intervalMs);
  }
  const sheet = contactSheet(shots.map((s) => s.png), maxSize);
  // Window captures arrive downscaled and know their source size; in-engine ones are full size (PNG IHDR at bytes 16/20).
  const srcW = shots[0]!.sourceWidth ?? shots[0]!.png.readUInt32BE(16);
  const srcH = shots[0]!.sourceHeight ?? shots[0]!.png.readUInt32BE(20);
  const steps = sheet.changes.map((c, i) => `${i + 1}→${i + 2} ${c}%`).join(', ');
  const verdict = sheet.changes.every((c) => c === 0)
    ? ' Nothing changed between frames: the scene was static during the burst.'
    : '';
  return imageResult(
    sheet.png.toString('base64'),
    `${frames} frames (${how}, ${srcW}x${srcH}) about ${intervalMs} ms apart, taken at ${shots.map((s) => s.atMs).join(', ')} ms; ` +
      `numbered 1–${frames} left to right, top to bottom (${sheet.cols}x${sheet.rows} grid, image ${sheet.width}x${sheet.height}). ` +
      `Pixels changed from frame to frame: ${steps}.${verdict}`,
  );
}

function isLoopback(url: string | undefined): boolean {
  const host = url ? new URL(url).hostname : '';
  return host === 'localhost' || host === '[::1]' || /^127\./.test(host);
}
