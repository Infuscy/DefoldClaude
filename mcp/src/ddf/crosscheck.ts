// Checks that need a second file: animation names against the atlas or tile source they are played from,
// input actions against the game's input binding, and message names against the built-in ones and the rest of
// the project's Lua. Most of these mistakes build fine and then do nothing at runtime.
//
// The per-file pass feeds a CrossChecker through the taps it hands to checkFile; finish() then reads the
// referenced files (once each) and reports. Whatever cannot be read or parsed is skipped, never guessed.
import gameProjectJson from './gameproject.generated.json' with { type: 'json' };
import type { Issue } from '../runtime/issues.js';
import type { Node } from '../lua/check.js';
import { luaNames, parseLuaNames, type LuaNames, type MessageRole } from '../lua/names.js';
import type { IniDocument } from '../util/ini.js';
import { LUA_EXTENSIONS, type CheckOptions } from './checkfile.js';
import { closest } from './codec.js';
import { settingSourcePath, type SettingsSchema } from './gameproject.js';
import { parseTextFormat, type FieldNode, type MessageValue } from './textformat.js';
import type { DdfMessageVisit } from './validate.js';

export interface CrossSources {
  /** Text of a resource in the project, a fetched library or the builtins; undefined when it cannot be read. */
  readText(resource: string): Promise<string | undefined>;
  /** Source path of the input binding the game runs with (see inputBindingPath). */
  inputBinding: string;
  /** Resource paths of every Lua file in the project, for message names used across files. */
  luaFiles(): Promise<string[]>;
}

/** The input binding named by [input] game_binding, as a source path (/input/game.input_binding). */
export function inputBindingPath(ini: IniDocument): string {
  const schema = (gameProjectJson as unknown as { sections: SettingsSchema }).sections.input?.game_binding ?? {};
  const value = ini.get('input', 'game_binding') || schema.default || '/input/game.input_bindingc';
  return settingSourcePath(value, { default: '/input/game.input_bindingc', ...schema });
}

interface AnimationUse {
  resource: string;
  line: number;
  where: string;
  /** The atlas or tile source the animation must be in. */
  source: string;
  animation: string;
  rule: string;
  /** The finding, given the source's path. */
  message: (source: string) => string;
}

const str = (msg: MessageValue, name: string): FieldNode | undefined => msg.fields.find((f) => f.name === name && f.value.kind === 'scalar' && f.value.type === 'string');
const text = (f: FieldNode | undefined): string => (f && f.value.kind === 'scalar' ? f.value.text : '');
const children = (msg: MessageValue, name: string): MessageValue[] => msg.fields.filter((f) => f.name === name && f.value.kind === 'message').map((f) => f.value as MessageValue);

/** Animation ids of an atlas or tile source: flipbook animations, plus one per standalone atlas image. */
export function animationIds(resource: string, source: string): Set<string> | undefined {
  const atlas = /\.atlas$/i.test(resource);
  if (!atlas && !/\.(tilesource|tileset)$/i.test(resource)) return undefined; // extension formats (.tpatlas, …)
  let root: MessageValue;
  try {
    root = parseTextFormat(source).root;
  } catch {
    return undefined;
  }
  const ids = new Set<string>();
  for (const a of children(root, 'animations')) ids.add(text(str(a, 'id')));
  if (atlas) {
    // rename_patterns ("_big=,hero=player") rewrite the names of standalone images; accept the name either way.
    const patterns = text(str(root, 'rename_patterns'))
      .split(',')
      .map((p) => p.split('='))
      .filter((p) => p.length === 2 && p[0]);
    for (const image of children(root, 'images')) {
      const base = text(str(image, 'image')).replace(/^.*\//, '').replace(/\.[^.]*$/, '');
      if (!base) continue;
      ids.add(base);
      ids.add(patterns.reduce((name, [from, to]) => name.split(from!).join(to!), base));
    }
  }
  ids.delete('');
  return ids;
}

/** Actions an input binding can produce. */
export function boundActions(source: string): Set<string> | undefined {
  let root: MessageValue;
  try {
    root = parseTextFormat(source).root;
  } catch {
    return undefined;
  }
  const actions = new Set<string>();
  for (const f of root.fields) {
    if (!f.name.endsWith('_trigger') || f.value.kind !== 'message') continue;
    const action = text(str(f.value, 'action'));
    if (action) actions.add(action);
  }
  return actions;
}

function listed(names: Iterable<string>, wanted: string, what: string): string {
  const all = [...names].sort();
  const near = closest(wanted, all);
  if (near) return ` — did you mean "${near}"?`;
  if (!all.length) return ` (it has no ${what})`;
  return ` (${what}: ${all.slice(0, 8).join(', ')}${all.length > 8 ? ', …' : ''})`;
}

export class CrossChecker {
  private readonly animations: AnimationUse[] = [];
  /** Lua files of this run by resource; undefined for one that did not parse. */
  private readonly lua = new Map<string, LuaNames | undefined>();
  private readonly idCache = new Map<string, Promise<Set<string> | undefined>>();

  constructor(private readonly sources: CrossSources) {}

  /** checkFile options that record what `resource` needs checked against other files. */
  taps(resource: string): Pick<CheckOptions, 'onDdfMessage' | 'onLuaAst'> {
    if (LUA_EXTENSIONS.test(resource)) {
      this.lua.set(resource, undefined);
      return { onLuaAst: (ast: Node) => void this.lua.set(resource, luaNames(ast)) };
    }
    return { onDdfMessage: (visit) => this.collect(resource, visit) };
  }

  private collect(resource: string, { type, msg, fileLine, where }: DdfMessageVisit): void {
    const use = (field: FieldNode, source: string, animation: string, rule: string, message: AnimationUse['message']): void => {
      if (source.startsWith('/') && animation) this.animations.push({ resource, line: fileLine(field.line), where, source, animation, rule, message });
    };
    if (type === 'dmGameSystemDDF.SpriteDesc') {
      // The engine looks animations up in the first texture; tile_set is the older single-texture field.
      const anim = str(msg, 'default_animation');
      const source = text(children(msg, 'textures').map((t) => str(t, 'texture'))[0]) || text(str(msg, 'tile_set'));
      if (anim) use(anim, source, text(anim), 'sprite-animation', (s) => `default_animation "${text(anim)}" is not an animation in ${s}`);
    } else if (type === 'dmParticleDDF.Emitter') {
      const anim = str(msg, 'animation');
      const id = text(str(msg, 'id'));
      if (anim) use(anim, text(str(msg, 'tile_source')), text(anim), 'particlefx-animation', (s) => `Emitter${id ? ` "${id}"` : ''} plays animation "${text(anim)}", which is not in ${s}`);
    } else if (type === 'dmGuiDDF.SceneDesc') {
      const textures = new Map(children(msg, 'textures').map((t) => [text(str(t, 'name')), text(str(t, 'texture'))]));
      const nodes = [...children(msg, 'nodes'), ...children(msg, 'layouts').flatMap((l) => children(l, 'nodes'))];
      for (const node of nodes) {
        const field = str(node, 'texture');
        const value = text(field);
        const slash = value.indexOf('/');
        // Nodes that come from a template scene use that scene's textures.
        if (!field || slash < 0 || node.fields.some((f) => f.name === 'template_node_child' && f.value.kind === 'scalar' && f.value.text === 'true')) continue;
        const source = textures.get(value.slice(0, slash));
        const anim = value.slice(slash + 1);
        if (source) use(field, source, anim, 'gui-animation', (s) => `Node "${text(str(node, 'id'))}" uses "${value}", but ${s} has no animation "${anim}"`);
      }
    }
  }

  private ids(resource: string): Promise<Set<string> | undefined> {
    let ids = this.idCache.get(resource);
    if (!ids) {
      ids = this.sources.readText(resource).then((source) => (source === undefined ? undefined : animationIds(resource, source)));
      this.idCache.set(resource, ids);
    }
    return ids;
  }

  /** Everything collected so far, checked against the files it refers to. */
  async finish(): Promise<Issue[]> {
    const issues: Issue[] = [];

    for (const u of this.animations) {
      const ids = await this.ids(u.source);
      if (!ids || ids.has(u.animation)) continue;
      const message = u.message(u.source) + listed(ids, u.animation, 'animations');
      issues.push({ severity: 'error', resource: u.resource, line: u.line, message: u.where ? `${message} (in ${u.where})` : message, rule: u.rule });
    }

    const parsed = [...this.lua].filter((e): e is [string, LuaNames] => !!e[1]);
    if (parsed.some(([, names]) => names.actions.length)) {
      const binding = this.sources.inputBinding;
      const source = await this.sources.readText(binding);
      const bound = source === undefined ? undefined : boundActions(source);
      if (bound) {
        for (const [resource, names] of parsed) {
          const seen = new Set<string>();
          for (const a of names.actions) {
            if (bound.has(a.name) || seen.has(a.name)) continue;
            seen.add(a.name);
            issues.push({
              severity: 'warning',
              resource,
              line: a.line,
              column: a.column,
              message: `action_id is compared with hash("${a.name}"), but ${binding} binds nothing to "${a.name}", so this never matches${listed(bound, a.name, 'actions')}`,
              rule: 'input-action',
            });
          }
        }
      }
    }

    // A name close to a built-in message is a misspelling unless the project uses it as a message of its own,
    // which shows as a second role somewhere: posted and handled, or kept in a table of message ids.
    if (parsed.some(([, names]) => names.messages.some((m) => m.role !== 'other'))) {
      const roles = new Map<string, Set<MessageRole>>();
      const note = (names: LuaNames | undefined): void => {
        for (const m of names?.messages ?? []) roles.set(m.name, (roles.get(m.name) ?? new Set<MessageRole>()).add(m.role));
      };
      for (const [, names] of parsed) note(names);
      for (const file of await this.sources.luaFiles()) {
        if (this.lua.has(file)) continue;
        const source = await this.sources.readText(file);
        if (source !== undefined) note(parseLuaNames(source, file));
      }
      for (const [resource, names] of parsed) {
        for (const m of names.messages) {
          if (m.role === 'other' || roles.get(m.name)!.size > 1) continue;
          const why = m.role === 'received' ? 'nothing in the project posts it' : 'nothing in the project handles it';
          issues.push({
            severity: 'warning',
            resource,
            line: m.line,
            column: m.column,
            message: `"${m.name}" is not a built-in message and ${why} — did you mean "${m.builtin}"?`,
            rule: 'message-name',
          });
        }
      }
    }
    return issues;
  }
}
