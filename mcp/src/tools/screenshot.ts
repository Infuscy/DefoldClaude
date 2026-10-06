import { connectEditor, editorPreview } from '../runtime/editor.js';
import { isRunning } from '../runtime/engine.js';
import { pidForListeningPort } from '../runtime/processes.js';
import { captureWindow } from '../runtime/screenshot.js';
import { bridgeHealth, bridgeScreenshot } from '../runtime/bridge.js';
import { downscalePng } from '../util/png.js';
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
    `Return a PNG image. source=game captures the running game window (Windows; uses the Automation Bridge when present). source=preview renders a scene resource such as a .collection, .go or .gui through the open Defold editor without running the game.`,
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
      return imageResult(png.toString('base64'), `Editor preview of ${resource} (${size}x${size} max).`, { source: 'preview', resource });
    }

    const session = await currentSession(project);
    if (!isRunning(session)) return errorResult('The game is not running. Start it with run action=start, or use source=preview.');
    if (await bridgeHealth(session)) {
      // In-engine capture through the Automation Bridge: exact frame, works on every platform and when occluded.
      const shot = downscalePng(await bridgeScreenshot(session), args.max_size);
      const note = shot.blank ? ' WARNING: the image is a single colour — the scene may be empty or still loading.' : '';
      return imageResult(
        shot.png.toString('base64'),
        `Game frame ${shot.srcWidth}x${shot.srcHeight} (image ${shot.width}x${shot.height}, captured in-engine).${note}`,
        { source: 'game', width: shot.width, height: shot.height, window_width: shot.srcWidth, window_height: shot.srcHeight, blank: shot.blank },
      );
    }
    let pid = session.pid;
    if (!pid && session.serviceUrl) pid = await pidForListeningPort(Number(new URL(session.serviceUrl).port));
    if (!pid) return errorResult('Could not find the game process to capture.');
    const shot = await captureWindow(pid, args.max_size);
    const note = shot.blank ? ' WARNING: the image looks blank (uniform color) — the scene may be empty, still loading, or the window could not be captured.' : '';
    return imageResult(
      shot.png.toString('base64'),
      `Game window ${shot.sourceWidth}x${shot.sourceHeight} (image ${shot.width}x${shot.height}).${note}`,
      { source: 'game', width: shot.width, height: shot.height, window_width: shot.sourceWidth, window_height: shot.sourceHeight, blank: shot.blank },
    );
  },
});
