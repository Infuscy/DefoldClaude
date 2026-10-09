import {
  bridgeHealth,
  bridgeScreenshot,
  BridgeError,
  inputClick,
  inputDrag,
  inputKey,
  inputWheel,
  resolveTarget,
  waitForInput,
  windowSize,
  type InputReceipt,
} from '../runtime/bridge.js';
import { isRunning, sleep, syncEditorConsole } from '../runtime/engine.js';
import { formatLuaError } from '../runtime/logs.js';
import { downscalePng } from '../util/png.js';
import { requireProject } from './common.js';
import { defineTool } from './registry.js';
import { errorResult, imageResult, textResult } from './result.js';
import { currentSession } from './run.js';
import { inputInput } from './schemas.js';

export const NO_BRIDGE =
  "The running game does not include Defold's Automation Bridge extension, so input cannot be simulated. " +
  'Run /defold:setup-bridge (adds the debug-only dependency after the user agrees), then restart the game. ' +
  'Screenshots, logs and inspect still work without it.';

export const inputTool = defineTool({
  name: 'input',
  title: 'Send input to the game',
  description:
    `Play the running game: click/tap an element by its text or name (e.g. "Play") or at window coordinates, drag, press keys, type text or scroll. Returns the log output the action caused (and optionally a screenshot). Needs Defold's Automation Bridge extension in the project (debug builds only; /defold:setup-bridge adds it).`,
  inputSchema: inputInput,
  annotations: { readOnlyHint: false },
  async handler(args) {
    const project = requireProject(args.project);
    const session = await currentSession(project);
    if (!isRunning(session)) return errorResult('The game is not running. Start it with run action=start.');
    const health = await bridgeHealth(session);
    if (!health) return errorResult(NO_BRIDGE);

    const scale = args.normalized ? await windowSize(session) : { width: 1, height: 1 };
    const point = async (target?: string, x?: number, y?: number) => {
      if (target) {
        const el = await resolveTarget(session, target);
        return { id: el.id, label: el.text ?? el.name ?? el.id };
      }
      if (x === undefined || y === undefined) throw new BridgeError('Give a target or both x and y.');
      return { x: Math.round(x * scale.width), y: Math.round(y * scale.height), label: `(${Math.round(x * scale.width)}, ${Math.round(y * scale.height)})` };
    };

    const cursor = session.logs.cursor;
    let receipt: InputReceipt;
    let what: string;
    try {
      switch (args.action) {
        case 'click': {
          const p = await point(args.target, args.x, args.y);
          receipt = await inputClick(session, p);
          what = `click on ${p.label}`;
          break;
        }
        case 'drag': {
          const from = await point(args.target, args.x, args.y);
          const to = await point(args.to_target, args.to_x, args.to_y);
          receipt = await inputDrag(session, from, to, args.duration);
          what = `drag from ${from.label} to ${to.label}`;
          break;
        }
        case 'key':
          if (!args.keys?.length) return errorResult('action=key needs keys, e.g. ["KEY_SPACE"].');
          receipt = await inputKey(session, { keys: args.keys, hold: args.hold });
          what = `keys ${args.keys.join(' ')}${args.hold ? ` held ${args.hold}s` : ''}`;
          break;
        case 'text':
          if (!args.text) return errorResult('action=text needs text.');
          receipt = await inputKey(session, { text: args.text });
          what = `text "${args.text}"`;
          break;
        case 'wheel': {
          if (!args.steps) return errorResult('action=wheel needs steps (+up, -down).');
          const p = await point(args.target, args.x ?? 0.5, args.y ?? 0.5);
          receipt = await inputWheel(session, p, args.steps);
          what = `wheel ${args.steps} at ${p.label}`;
          break;
        }
      }
    } catch (e) {
      if (e instanceof BridgeError) return errorResult(`Input not sent: ${e.message}`);
      throw e;
    }

    const final = await waitForInput(session, receipt.input_id, 5000 + (args.hold ?? 0) * 1000 + args.duration * 1000);
    await sleep(args.wait_ms);
    if (session.backend === 'editor') await syncEditorConsole(session).catch(() => {});
    const { lines } = session.logs.query({ after: cursor, max: 60 });
    const errors = session.logs.luaErrors(cursor);
    const text = [
      `Sent ${what}: ${final.state}${final.reason ? ` (${final.reason})` : ''}.`,
      errors.length ? `Lua errors:\n${errors.map((e) => `- ${formatLuaError(e)}`).join('\n')}` : '',
      lines.length ? `Log since the input:\n${lines.map((l) => l.text).join('\n')}` : 'No new log output.',
      `Log cursor: ${session.logs.cursor}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    if (args.screenshot) {
      const shot = downscalePng(await bridgeScreenshot(session), 768);
      return imageResult(shot.png.toString('base64'), `${text}\n\nScreenshot after the input (${shot.srcWidth}x${shot.srcHeight} window).`);
    }
    return textResult(text);
  },
});
