import os from 'node:os';
import path from 'node:path';

/** Defold platform pair for the machine running the MCP server, e.g. `x86_64-win32`. */
export function hostPlatform(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  switch (process.platform) {
    case 'win32':
      return 'x86_64-win32';
    case 'darwin':
      return `${arch}-macos`;
    default:
      return `${arch}-linux`;
  }
}

export function exeSuffix(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

/** Directory where the Defold editor keeps installations.json, logs and its unpack folder. */
export function defoldSupportDirs(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return [path.join(local, 'Defold'), path.join(roaming, 'Defold')];
  }
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'Defold')];
  }
  const state = process.env.XDG_STATE_HOME ?? path.join(home, '.local', 'state');
  const data = process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  return [path.join(state, 'Defold'), path.join(data, 'Defold'), path.join(home, '.Defold')];
}

/** Common install locations, checked when installations.json does not help. */
export function commonInstallDirs(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    return [
      path.join(local, 'Programs', 'Defold'),
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Defold'),
      path.join(home, 'Defold'),
      'C:\\Defold',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Defold.app/Contents/Resources',
      path.join(home, 'Applications', 'Defold.app', 'Contents', 'Resources'),
    ];
  }
  return [path.join(home, 'Defold'), '/opt/Defold', '/usr/local/Defold'];
}

/** Plugin cache directory: explicit env, Claude's per-plugin data dir, or an OS cache dir. */
export function cacheRoot(): string {
  const explicit = process.env.DEFOLD_CACHE_DIR;
  if (explicit && !explicit.includes('${')) return explicit;
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (pluginData && !pluginData.includes('${')) return path.join(pluginData, 'cache');
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'defold-claude', 'cache');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'defold-claude');
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(home, '.cache'), 'defold-claude');
}

/** True if an env value is usable (set, non-empty, and not an unexpanded `${...}` placeholder). */
export function usableEnv(value: string | undefined): value is string {
  return !!value && value.trim() !== '' && !value.includes('${');
}
