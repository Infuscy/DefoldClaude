// Random-access zip reading (the editor jar is ~300 MB, so never load it whole).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';

export interface ZipEntryInfo {
  name: string;
  size: number;
  compressedSize: number;
}

export class ZipFile {
  private constructor(
    private readonly zip: yauzl.ZipFile,
    readonly entries: Map<string, yauzl.Entry>,
  ) {}

  static async open(file: string): Promise<ZipFile> {
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: true }, (err, z) => (err || !z ? reject(err) : resolve(z)));
    });
    const entries = new Map<string, yauzl.Entry>();
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', (entry: yauzl.Entry) => {
        entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on('end', () => resolve());
      zip.on('error', reject);
      zip.readEntry();
    });
    return new ZipFile(zip, entries);
  }

  list(prefix = ''): ZipEntryInfo[] {
    const out: ZipEntryInfo[] = [];
    for (const [name, e] of this.entries) {
      if (name.startsWith(prefix) && !name.endsWith('/')) out.push({ name, size: e.uncompressedSize, compressedSize: e.compressedSize });
    }
    return out;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async read(name: string): Promise<Buffer> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Zip entry not found: ${name}`);
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
      this.zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s)));
    });
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async readText(name: string): Promise<string> {
    return (await this.read(name)).toString('utf8');
  }

  async extract(name: string, dest: string, mode?: number): Promise<void> {
    const data = await this.read(name);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, data, mode !== undefined ? { mode } : undefined);
    await fsp.rename(tmp, dest);
  }

  close(): void {
    this.zip.close();
  }
}

/** Open, run `fn`, always close. */
export async function withZip<T>(file: string, fn: (zip: ZipFile) => Promise<T>): Promise<T> {
  const zip = await ZipFile.open(file);
  try {
    return await fn(zip);
  } finally {
    zip.close();
  }
}

export function fileExists(p: string): boolean {
  return fs.existsSync(p);
}
