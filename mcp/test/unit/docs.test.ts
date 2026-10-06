import { describe, expect, it } from 'vitest';
import { clean, findExact, searchApi, signature, type ApiElement } from '../../src/docs/apiIndex.js';
import { extractSection, findDoc, parseDocs, searchDocs } from '../../src/docs/manuals.js';

const el = (name: string, brief: string, extra: Partial<ApiElement> = {}): ApiElement => ({
  name,
  type: 'FUNCTION',
  namespace: name.split('.')[0]!,
  brief,
  description: '',
  params: [],
  returns: [],
  examples: '',
  members: [],
  environment: 'runtime',
  source: 'test',
  ...extra,
});

describe('API index', () => {
  const elements = [
    el('go.animate', 'animates a named property', {
      params: [
        { name: 'url', types: ['url'], doc: '', optional: false },
        { name: 'delay', types: ['number'], doc: '', optional: true },
      ],
    }),
    el('go.set_position', 'sets the position of the game object instance'),
    el('factory.create', 'make a factory create a new game object'),
    el('timer.delay', 'create a timer'),
    el('editor.transact', 'change the editor state', { environment: 'editor' }),
  ];

  it('builds signatures with optional params in brackets', () => {
    expect(signature(elements[0]!)).toBe('go.animate(url, [delay])');
  });

  it('finds exact names, short names and respects environment', () => {
    expect(findExact(elements, 'go.animate')[0]!.name).toBe('go.animate');
    expect(findExact(elements, 'animate')[0]!.name).toBe('go.animate');
    expect(searchApi(elements, 'transact', { environment: 'runtime' })).toHaveLength(0);
    expect(searchApi(elements, 'transact', { environment: 'editor' })[0]!.name).toBe('editor.transact');
  });

  it('maps other-engine vocabulary to Defold APIs', () => {
    expect(searchApi(elements, 'spawn enemy')[0]!.name).toBe('factory.create');
    expect(searchApi(elements, 'wait 2 seconds')[0]!.name).toBe('timer.delay');
    expect(searchApi(elements, 'move to target').map((e) => e.name)).toContain('go.animate');
  });

  it('cleans doc markup', () => {
    expect(clean('see [ref:go.get_position] of [type:vector3] <a href="/x">guide</a> <code>x</code>')).toBe('see `go.get_position` of vector3 guide `x`');
  });
});

describe('llms docs parsing', () => {
  const text = [
    '# Defold Documentation',
    '',
    '## Manuals',
    '',
    '### Core Concepts',
    '',
    '- [Addressing](#manuals:addressing)',
    '- [Message passing](#manuals:message-passing)',
    '',
    '# Addressing {#manuals:addressing}',
    '',
    'Every object has an address.',
    '',
    '## Shorthands',
    '',
    'Use `.` and `#`.',
    '',
    '## URLs',
    '',
    'Full form.',
    '',
    '# Message passing {#manuals:message-passing}',
    '',
    'Use msg.post to send messages between components.',
  ].join('\n');
  const set = parseDocs('manuals', text);

  it('splits manuals and reads categories', () => {
    expect(set.entries.map((e) => e.id)).toEqual(['addressing', 'message-passing']);
    expect(set.categories).toEqual([{ name: 'Core Concepts', ids: ['addressing', 'message-passing'] }]);
    expect(set.entries[0]!.category).toBe('Core Concepts');
  });

  it('finds documents and sections', () => {
    expect(findDoc([set], 'Message Passing')!.id).toBe('message-passing');
    expect(extractSection(findDoc([set], 'addressing')!.text, 'shorthand')).toBe('## Shorthands\n\nUse `.` and `#`.');
    expect(searchDocs([set], 'send messages')[0]!.entry.id).toBe('message-passing');
  });
});
