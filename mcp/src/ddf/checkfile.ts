// One entry point that validates any Defold source file by type (shared by the validate tool and the hook).
import gameProjectJson from './gameproject.generated.json' with { type: 'json' };
import type { Issue, Severity } from '../runtime/issues.js';
import { checkLua, type Node } from '../lua/check.js';
import { validateGameProject, type SettingsSchema } from './gameproject.js';
import { messageForResource, SCHEMA_DEFOLD_VERSION } from './schema.js';
import { validateDdf, type DdfMessageVisit } from './validate.js';

export const LUA_EXTENSIONS = /\.(script|gui_script|render_script|editor_script|lua)$/;

export interface CheckOptions {
  resourceExists?: (resource: string) => boolean | undefined;
  missingRefSeverity?: Severity;
  installedVersion?: string;
  thorough?: boolean;
  settingsSchema?: SettingsSchema;
  /** Taps for cross-file checks (crosscheck.ts): every typed message of a scene file, the AST of a Lua file. */
  onDdfMessage?: (visit: DdfMessageVisit) => void;
  onLuaAst?: (ast: Node) => void;
}

export function isCheckable(resource: string): boolean {
  return LUA_EXTENSIONS.test(resource) || resource === '/game.project' || !!messageForResource(resource);
}

export function checkFile(resource: string, text: string, opts: CheckOptions = {}): Issue[] {
  if (LUA_EXTENSIONS.test(resource)) return checkLua(text, resource, { thorough: opts.thorough, onAst: opts.onLuaAst });
  if (resource === '/game.project') {
    return validateGameProject(text, {
      schema: opts.settingsSchema ?? (gameProjectJson as unknown as { sections: SettingsSchema }).sections,
      resourceExists: opts.resourceExists,
      missingRefSeverity: opts.missingRefSeverity,
    });
  }
  if (messageForResource(resource)) {
    return validateDdf(text, resource, {
      resourceExists: opts.resourceExists,
      missingRefSeverity: opts.missingRefSeverity,
      schemaMismatch: !!opts.installedVersion && opts.installedVersion !== SCHEMA_DEFOLD_VERSION,
      onMessage: opts.onDdfMessage,
    });
  }
  return [];
}
