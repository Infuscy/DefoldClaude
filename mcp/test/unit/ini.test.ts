import { describe, expect, it } from 'vitest';
import { indexedValues, interpolateIni, parseIni } from '../../src/util/ini.js';

describe('parseIni', () => {
  it('reads sections, keys and line numbers', () => {
    const doc = parseIni('[project]\ntitle = My Game\n\n[display]\nwidth = 640\nheight=1136\n');
    expect(doc.get('project', 'title')).toBe('My Game');
    expect(doc.get('display', 'height')).toBe('1136');
    expect(doc.entries.find((e) => e.key === 'width')?.line).toBe(5);
  });

  it('collects indexed dependency keys in order', () => {
    const doc = parseIni('[project]\ndependencies#1 = https://b.zip\ndependencies#0 = https://a.zip\n');
    expect(indexedValues(doc, 'project', 'dependencies')).toEqual(['https://a.zip', 'https://b.zip']);
  });

  it('interpolates ${section.key} references like the editor config file', () => {
    const doc = parseIni(
      '[bootstrap]\nresourcespath = \n[build]\neditor_sha1 = abc\n[launcher]\njdk = ${bootstrap.resourcespath}/packages/jdk-25+36\njava = ${launcher.jdk}/bin/java\njar = ${bootstrap.resourcespath}/packages/defold-${build.editor_sha1}.jar\n',
    );
    const get = interpolateIni(doc, { 'bootstrap.resourcespath': 'C:/Defold' });
    expect(get('launcher', 'java')).toBe('C:/Defold/packages/jdk-25+36/bin/java');
    expect(get('launcher', 'jar')).toBe('C:/Defold/packages/defold-abc.jar');
  });
});
