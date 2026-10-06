import { describe, expect, it } from 'vitest';
import { breakEmbeddedNewlines, escapeJavaTextFormat, parseTextFormat, TextFormatError, toPlain, type MessageValue } from '../../src/ddf/textformat.js';

describe('parseTextFormat', () => {
  it('parses fields, nested messages, enums and numbers with positions', () => {
    const text = 'name: "main"\nscale_along_z: 0\nembedded_instances {\n  id: "go"\n  position {\n    x: 320.0\n    y: -1.5E-4\n  }\n}\n';
    const { root } = parseTextFormat(text);
    expect(root.fields.map((f) => f.name)).toEqual(['name', 'scale_along_z', 'embedded_instances']);
    const inst = root.fields[2]!;
    expect(inst.line).toBe(3);
    const pos = (inst.value as MessageValue).fields[1]!;
    expect(toPlain(pos.value as MessageValue)).toEqual({ x: 320, y: -1.5e-4 });
    expect(text.slice(inst.start, inst.end)).toBe('embedded_instances {\n  id: "go"\n  position {\n    x: 320.0\n    y: -1.5E-4\n  }\n}');
  });

  it('concatenates adjacent strings and decodes escapes and octal UTF-8', () => {
    const { root } = parseTextFormat('data: "line one\\n"\n  "say \\"hi\\" \\303\\245"\n  ""\n');
    const v = root.fields[0]!.value;
    expect(v.kind === 'scalar' && v.text).toBe('line one\nsay "hi" å');
  });

  it('decodes doubly escaped embedded data', () => {
    const inner = 'components {\n  id: "main"\n  component: "/main/main.script"\n}\n';
    const outer = `data: "${escapeJavaTextFormat(inner)}"\n`;
    const v = parseTextFormat(outer).root.fields[0]!.value;
    expect(v.kind === 'scalar' && v.text).toBe(inner);
    const nested = parseTextFormat((v as { text: string }).text).root;
    expect(toPlain(nested)).toEqual({ components: { id: 'main', component: '/main/main.script' } });
  });

  it('reports syntax errors with line and column', () => {
    try {
      parseTextFormat('a {\n  b: "x"\n');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TextFormatError);
      expect((e as TextFormatError).line).toBe(1);
    }
    expect(() => parseTextFormat('a: "unterminated\n')).toThrow(/Unterminated/);
    expect(() => parseTextFormat('a b\n')).toThrow(/Expected ':' or '\{'/);
  });

  it('accepts list syntax, comments, single quotes and angle brackets', () => {
    const { root } = parseTextFormat("# comment\nvalues: [1, 2, 3]\nname: 'x'\nm < a: 1 >\n");
    expect(toPlain(root)).toEqual({ values: [1, 2, 3], name: 'x', m: { a: 1 } });
  });
});

describe('escaping like the Defold editor', () => {
  it('escapes quotes, backslashes, single quotes, control and non-ASCII bytes', () => {
    expect(escapeJavaTextFormat('a"b\\c\'d\ne\tf')).toBe('a\\"b\\\\c\\\'d\\ne\\tf');
    expect(escapeJavaTextFormat('åäö')).toBe('\\303\\245\\303\\244\\303\\266');
  });

  it('splits after escaped newlines with a two-space continuation indent', () => {
    const printed = `data: "${escapeJavaTextFormat('a: 1\nb: 2\n')}"`;
    expect(breakEmbeddedNewlines(printed)).toBe('data: "a: 1\\n"\n  "b: 2\\n"\n  ""');
  });
});
