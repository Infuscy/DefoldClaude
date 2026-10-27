// Validation of Defold protobuf-text resources against the engine schema, plus semantic checks
// (unique ids, valid parent/child links, GUI names, resource references).
import type { Issue, Severity } from '../runtime/issues.js';
import { closest, embeddedTypeFor, isEmbeddedDataField } from './codec.js';
import { enumSchema, fieldSchema, messageForEmbeddedType, messageForResource, messageSchema, type FieldSchema } from './schema.js';
import { parseTextFormat, TextFormatError, type FieldNode, type MessageValue, type Value } from './textformat.js';

export interface DdfContext {
  /** true/false = exists/missing, undefined = cannot tell (e.g. unfetched library). */
  resourceExists?: (resourcePath: string) => boolean | undefined;
  missingRefSeverity?: Severity;
  /** The installed Defold version differs from the schema's; unknown fields become warnings. */
  schemaMismatch?: boolean;
  /** Called for every string in a resource-path field, including those inside embedded documents. */
  onReference?: (ref: DdfReference) => void;
}

export interface DdfReference {
  path: string;
  field: string;
  line: number;
  /** id of the message holding the field, e.g. the component or instance id. */
  owner?: string;
  /** Embedded document the field sits in, e.g. "embedded component 'sprite' in game object 'go'". */
  where?: string;
}

interface Walk {
  resource: string;
  issues: Issue[];
  ctx: DdfContext;
  /** Maps a line inside the current (possibly embedded) document to a line in the file. */
  mapLine: (line: number) => number;
  where: string; // human context, e.g. "embedded component 'sprite' in game object 'go'"
  /** Whether the file's top-level literal was split per line (editor format); inherited by deeper levels. */
  split?: boolean;
}

export function validateDdf(text: string, resource: string, ctx: DdfContext = {}): Issue[] {
  const type = messageForResource(resource);
  if (!type) return [];
  const issues: Issue[] = [];
  let root: MessageValue;
  try {
    root = parseTextFormat(text).root;
  } catch (e) {
    if (e instanceof TextFormatError) {
      return [{ severity: 'error', resource, line: e.line, column: e.column, message: `Syntax error: ${e.message.replace(/^\d+:\d+: /, '')}`, rule: 'syntax' }];
    }
    throw e;
  }
  walkMessage(root, type, text, { resource, issues, ctx, mapLine: (l) => l, where: '' });
  return issues;
}

function push(w: Walk, severity: Severity, line: number, message: string, rule: string): void {
  w.issues.push({ severity, resource: w.resource, line: w.mapLine(line), message: w.where ? `${message} (in ${w.where})` : message, rule });
}

function walkMessage(msg: MessageValue, type: string | undefined, text: string, w: Walk): void {
  const schema = type ? messageSchema(type) : undefined;
  const counts = new Map<string, number>();
  for (const f of msg.fields) {
    counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
    const fs = type ? fieldSchema(type, f.name) : undefined;
    if (schema && !fs) {
      const suggestion = closest(f.name, schema.fields.map((x) => x.name));
      push(w, w.ctx.schemaMismatch ? 'warning' : 'error', f.line, `Unknown field "${f.name}" in ${short(type!)}${suggestion ? ` — did you mean "${suggestion}"?` : ''}`, 'unknown-field');
      continue;
    }
    if (!fs) continue;
    if (fs.runtimeOnly) push(w, 'info', f.line, `"${f.name}" is filled in at build time; the editor drops it on save`, 'runtime-only');
    checkValue(f, fs, type!, msg, text, w);
  }
  if (schema) {
    for (const fs of schema.fields) {
      const n = counts.get(fs.name) ?? 0;
      if (fs.label !== 'repeated' && n > 1) {
        const second = msg.fields.filter((f) => f.name === fs.name)[1]!;
        push(w, 'error', second.line, `"${fs.name}" is not repeated but appears ${n} times`, 'duplicate-field');
      }
      if (fs.label === 'required' && n === 0 && !fs.runtimeOnly) {
        push(w, 'error', lineOfMessage(msg, text), `Missing required field "${fs.name}" in ${short(type!)}`, 'required');
      }
    }
    semanticChecks(msg, type!, text, w);
  }
}

function checkValue(f: FieldNode, fs: FieldSchema, parentType: string, parent: MessageValue, text: string, w: Walk): void {
  const v = f.value;
  if (fs.kind === 'message') {
    if (v.kind !== 'message') return push(w, 'error', f.line, `"${f.name}" must be a message { … } (${short(fs.type)})`, 'type');
    walkMessage(v, fs.type, text, w);
    return;
  }
  if (v.kind === 'message') return push(w, 'error', f.line, `"${f.name}" is a ${fs.kind === 'enum' ? 'enum' : fs.type}, not a message`, 'type');
  const scalars = v.kind === 'list' ? v.items : [v];
  if (v.kind === 'list' && fs.label !== 'repeated') push(w, 'error', f.line, `"${f.name}" is not repeated; [list] syntax not allowed`, 'type');
  for (const s of scalars) {
    if (fs.kind === 'enum') {
      const e = enumSchema(fs.type);
      if (s.type !== 'ident' && s.type !== 'number') {
        push(w, 'error', f.line, `"${f.name}" expects an enum value without quotes (${enumList(fs)})`, 'type');
      } else if (e && s.type === 'ident' && !e.values.some((x) => x.name === s.text)) {
        const suggestion = closest(s.text, e.values.map((x) => x.name));
        push(w, 'error', f.line, `Invalid value ${s.text} for "${f.name}"${suggestion ? ` — did you mean ${suggestion}?` : ''} Allowed: ${enumList(fs)}`, 'enum');
      }
      continue;
    }
    switch (fs.type) {
      case 'string':
      case 'bytes':
        if (s.type !== 'string') push(w, 'error', f.line, `"${f.name}" expects a quoted string`, 'type');
        break;
      case 'bool':
        if (!(s.type === 'ident' && /^(true|false|t|f|True|False)$/.test(s.text)) && !(s.type === 'number' && /^[01]$/.test(s.text))) {
          push(w, 'error', f.line, `"${f.name}" expects true or false`, 'type');
        }
        break;
      case 'float':
      case 'double':
        if (s.type !== 'number' && !(s.type === 'ident' && /^-?(inf|infinity|nan)$/i.test(s.text))) push(w, 'error', f.line, `"${f.name}" expects a number`, 'type');
        break;
      default:
        if (s.type !== 'number' || !/^-?(\d+|0x[0-9a-f]+)$/i.test(s.text)) push(w, 'error', f.line, `"${f.name}" expects an integer`, 'type');
        else if (/^u|fixed/.test(fs.type) && s.text.startsWith('-')) push(w, 'error', f.line, `"${f.name}" must not be negative`, 'type');
    }
  }
  // Embedded documents.
  if (isEmbeddedDataField(parentType, f.name) && v.kind === 'scalar' && v.type === 'string') {
    const innerType = embeddedTypeFor(parentType, f.name, parent);
    const label = describeEmbedded(parentType, parent);
    if (!innerType) {
      const t = parent.fields.find((x) => x.name === 'type');
      const tv = t && t.value.kind === 'scalar' ? t.value.text : '';
      if (parentType === 'dmGameObjectDDF.EmbeddedComponentDesc' && tv && !messageForEmbeddedType(tv)) {
        push(w, 'warning', f.line, `Unknown embedded component type "${tv}" (only valid if a native extension provides it)`, 'component-type');
      }
      return;
    }
    let inner: MessageValue;
    try {
      inner = parseTextFormat(v.text).root;
    } catch (e) {
      if (e instanceof TextFormatError) {
        push(w, 'error', f.line, `Syntax error inside embedded data of ${label}: ${e.message}`, 'syntax');
        return;
      }
      throw e;
    }
    // In editor-saved files the top-level literal is split after every escaped newline — including the newlines of
    // deeper embedded levels — so each inner line sits on its own file line. Otherwise point at the data field.
    const literalLines = text.slice(v.start, v.end).split('\n').length;
    const innerLines = v.text.split('\n').length;
    const splitHere = literalLines > 1 && literalLines >= innerLines - 1;
    const split = w.split === undefined ? splitHere : w.split;
    const base = f.line;
    const parentMap = w.mapLine;
    const valueLine = text.slice(0, v.start).split('\n').length;
    const mapLine = split ? (l: number) => parentMap(valueLine + l - 1) : () => parentMap(base);
    walkMessage(inner, innerType, v.text, { ...w, mapLine, split, where: w.where ? `${label} in ${w.where}` : label });
    return;
  }
  // Resource references.
  if (fs.resource && w.ctx.onReference) {
    const owner = parent.fields.find((x) => x.name === 'id');
    for (const s of scalars) {
      if (s.type !== 'string' || !s.text) continue;
      w.ctx.onReference({
        path: s.text,
        field: f.name,
        line: w.mapLine(f.line),
        owner: owner && owner.value.kind === 'scalar' ? owner.value.text : undefined,
        where: w.where || undefined,
      });
    }
  }
  if (fs.resource && w.ctx.resourceExists) {
    for (const s of scalars) {
      if (s.type !== 'string' || !s.text) continue;
      if (!s.text.startsWith('/')) {
        push(w, 'error', f.line, `"${f.name}" must be an absolute resource path starting with "/" (got "${s.text}")`, 'path');
        continue;
      }
      const exists = w.ctx.resourceExists(s.text);
      if (exists === false) push(w, w.ctx.missingRefSeverity ?? 'error', f.line, `"${f.name}" references ${s.text}, which does not exist`, 'missing-resource');
    }
  }
}

function describeEmbedded(parentType: string, parent: MessageValue): string {
  const id = parent.fields.find((x) => x.name === 'id');
  const idText = id && id.value.kind === 'scalar' ? id.value.text : '?';
  return parentType === 'dmGameObjectDDF.EmbeddedInstanceDesc' ? `game object '${idText}'` : `embedded component '${idText}'`;
}

// ---------------------------------------------------------------------------------------------
// Semantic checks per message type

function semanticChecks(msg: MessageValue, type: string, text: string, w: Walk): void {
  switch (type) {
    case 'dmGameObjectDDF.CollectionDesc':
      return checkCollection(msg, w);
    case 'dmGameObjectDDF.PrototypeDesc':
      checkUnique(msg, ['components', 'embedded_components'], 'id', 'component id', w);
      return;
    case 'dmGuiDDF.SceneDesc':
      return checkGui(msg, w);
    case 'dmGameSystemDDF.Atlas':
      checkUnique(msg, ['animations'], 'id', 'animation id', w);
      return;
    case 'dmGameSystemDDF.TileSet':
      checkUnique(msg, ['animations'], 'id', 'animation id', w);
      return;
    default:
      void text;
  }
}

function strField(m: Value, name: string): string | undefined {
  if (m.kind !== 'message') return undefined;
  const f = m.fields.find((x) => x.name === name);
  return f && f.value.kind === 'scalar' ? f.value.text : undefined;
}

function checkUnique(msg: MessageValue, fields: string[], key: string, what: string, w: Walk): Map<string, FieldNode> {
  const seen = new Map<string, FieldNode>();
  for (const f of msg.fields) {
    if (!fields.includes(f.name)) continue;
    const id = strField(f.value, key);
    if (id === undefined) continue;
    if (seen.has(id)) push(w, 'error', f.line, `Duplicate ${what} "${id}"`, 'duplicate-id');
    else seen.set(id, f);
  }
  return seen;
}

function checkCollection(msg: MessageValue, w: Walk): void {
  const ids = checkUnique(msg, ['instances', 'embedded_instances', 'collection_instances'], 'id', 'instance id', w);
  const parentOf = new Map<string, string>();
  for (const f of msg.fields) {
    if (f.name !== 'instances' && f.name !== 'embedded_instances') continue;
    if (f.value.kind !== 'message') continue;
    const parentId = strField(f.value, 'id') ?? '?';
    for (const c of f.value.fields) {
      if (c.name !== 'children' || c.value.kind !== 'scalar') continue;
      const child = c.value.text;
      const target = ids.get(child);
      if (!target || target.name === 'collection_instances') {
        push(w, 'error', c.line, `Child "${child}" of "${parentId}" is not a game object in this collection`, 'dangling-child');
      } else if (child === parentId) {
        push(w, 'error', c.line, `"${parentId}" lists itself as a child`, 'dangling-child');
      } else if (parentOf.has(child)) {
        push(w, 'error', c.line, `"${child}" has two parents ("${parentOf.get(child)}" and "${parentId}")`, 'dangling-child');
      } else parentOf.set(child, parentId);
    }
  }
}

function checkGui(msg: MessageValue, w: Walk): void {
  const names = (field: string) => {
    const set = new Set<string>();
    for (const f of msg.fields) if (f.name === field) {
      const n = strField(f.value, 'name');
      if (n !== undefined) set.add(n);
    }
    return set;
  };
  checkUnique(msg, ['fonts'], 'name', 'font name', w);
  checkUnique(msg, ['textures'], 'name', 'texture name', w);
  checkUnique(msg, ['layers'], 'name', 'layer name', w);
  const fonts = names('fonts');
  const textures = names('textures');
  const layers = names('layers');
  const materials = names('materials');
  const particlefxs = names('particlefxs');
  const nodeIds = checkUnique(msg, ['nodes'], 'id', 'node id', w);
  for (const f of msg.fields) {
    if (f.name !== 'nodes' || f.value.kind !== 'message') continue;
    const id = strField(f.value, 'id') ?? '?';
    const templateChild = strField(f.value, 'template_node_child') === 'true';
    const parent = strField(f.value, 'parent');
    if (parent && !nodeIds.has(parent)) push(w, 'error', f.line, `Node "${id}" has parent "${parent}", which is not a node in this scene`, 'dangling-parent');
    if (templateChild) continue; // values come from the template scene
    const texture = strField(f.value, 'texture');
    if (texture) {
      const texName = texture.includes('/') ? texture.slice(0, texture.indexOf('/')) : texture;
      if (!textures.has(texName)) push(w, 'error', f.line, `Node "${id}" uses texture "${texName}", which is not declared in textures {…}`, 'gui-texture');
    }
    const font = strField(f.value, 'font');
    if (font && !fonts.has(font)) push(w, 'error', f.line, `Node "${id}" uses font "${font}", which is not declared in fonts {…}`, 'gui-font');
    const layer = strField(f.value, 'layer');
    if (layer && !layers.has(layer)) push(w, 'error', f.line, `Node "${id}" uses layer "${layer}", which is not declared in layers {…}`, 'gui-layer');
    const material = strField(f.value, 'material');
    if (material && !materials.has(material)) push(w, 'warning', f.line, `Node "${id}" uses material "${material}", which is not declared in materials {…}`, 'gui-material');
    const pfx = strField(f.value, 'particlefx');
    if (pfx && !particlefxs.has(pfx)) push(w, 'error', f.line, `Node "${id}" uses particlefx "${pfx}", which is not declared in particlefxs {…}`, 'gui-particlefx');
  }
}

// ---------------------------------------------------------------------------------------------

function enumList(fs: FieldSchema): string {
  const e = enumSchema(fs.type);
  if (!e) return '';
  const names = e.values.map((x) => x.name);
  return names.length > 12 ? `${names.slice(0, 12).join(', ')}, …` : names.join(', ');
}

function short(type: string): string {
  return type.split('.').pop()!;
}

function lineOfMessage(msg: MessageValue, text: string): number {
  if (msg.start === 0) return 1;
  return text.slice(0, msg.start).split('\n').length;
}
