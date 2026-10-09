import { isRunning, sceneGraph } from '../runtime/engine.js';
import { bridgeHealth, findElements } from '../runtime/bridge.js';
import { NO_BRIDGE } from './input.js';
import { requireProject } from './common.js';
import { defineTool } from './registry.js';
import { errorResult, textResult } from './result.js';
import { currentSession } from './run.js';
import { inspectInput } from './schemas.js';

interface SceneNode {
  id?: string;
  type?: string;
  resource?: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
  world_position?: number[];
  children?: SceneNode[];
  [key: string]: unknown;
}

export const inspectTool = defineTool({
  name: 'inspect',
  title: 'Inspect running game',
  description:
    `Return the live scene graph of the running game: collections, game objects (ids, world positions, scale, rotation) and components (type, resource). Use it to check that objects were spawned, where they are, and which components they have.`,
  inputSchema: inspectInput,
  annotations: { readOnlyHint: true },
  async handler(args) {
    const project = requireProject(args.project);
    const session = await currentSession(project);
    if (!isRunning(session)) return errorResult('The game is not running. Start it with run action=start.');
    if (args.elements) {
      if (!(await bridgeHealth(session))) return errorResult(NO_BRIDGE);
      const q = args.filter ?? '';
      const [byText, byName] = await Promise.all([
        q ? findElements(session, { text: q, visible: true, limit: args.max_nodes }) : findElements(session, { visible: true, limit: args.max_nodes }),
        q ? findElements(session, { name: q, visible: true, limit: args.max_nodes }) : Promise.resolve({ elements: [], matched: 0, total: 0 }),
      ]);
      const seen = new Set<string>();
      const rows: string[] = [];
      for (const e of [...byText.elements, ...byName.elements]) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const b = e.bounds?.screen;
        rows.push(
          `${e.id} ${e.kind ?? ''} ${e.type ?? ''} "${e.name ?? ''}"${e.text ? ` text="${e.text}"` : ''}${b ? ` screen=(${b.x}, ${b.y}, ${b.w}x${b.h})` : ''}${e.enabled === false ? ' disabled' : ''}`,
        );
      }
      return textResult(
        `${rows.length} visible element(s)${q ? ` matching "${q}"` : ''} (screen coordinates: pixels from the top-left of the window; pass the id or text as input target):\n${rows.join('\n')}`,
      );
    }
    const root = (await sceneGraph(session)) as SceneNode;
    const filter = args.filter?.toLowerCase();
    const lines: string[] = [];
    let count = 0;
    let matched = 0;
    const fmt = (v?: number[]) => (v ? `(${v.slice(0, 3).map((n) => round(n)).join(', ')})` : '');
    const visit = (node: SceneNode, depth: number, ancestorsMatch: boolean): void => {
      count++;
      const text = `${node.id ?? ''} ${node.type ?? ''} ${node.resource ?? ''}`.toLowerCase();
      const isMatch = !filter || text.includes(filter);
      const show = ancestorsMatch || isMatch;
      if (show && lines.length < args.max_nodes && depth <= args.max_depth) {
        matched++;
        const indent = '  '.repeat(depth);
        let line = `${indent}${node.id ?? '?'} [${node.type ?? '?'}]`;
        if (node.resource && !String(node.resource).includes('_generated_')) line += ` ${node.resource}`;
        if (args.transforms && node.world_position) {
          line += ` world=${fmt(node.world_position)}`;
          if (node.scale && node.scale.some((s) => Math.abs(s - 1) > 1e-4)) line += ` scale=${fmt(node.scale)}`;
          if (node.rotation && Math.abs((node.rotation[3] ?? 1) - 1) > 1e-4) line += ` rot=${fmt(node.rotation)}`;
        }
        lines.push(line);
      }
      for (const child of node.children ?? []) visit(child, depth + 1, show && !!filter && isMatch ? true : ancestorsMatch);
    };
    visit(root, 0, false);
    const header = `Scene graph (${count} nodes${filter ? `, ${matched} shown for "${args.filter}"` : ''}${lines.length >= args.max_nodes ? `, truncated at ${args.max_nodes}` : ''}):`;
    return textResult([header, ...lines].join('\n'), );
  },
});

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}
