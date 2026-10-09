import { describe, expect, it } from 'vitest';
import { applyEdits, parseSelector, selectJson } from '../../src/ddf/edit.js';
import { checkFile } from '../../src/ddf/checkfile.js';

const COLLECTION_TYPE = 'dmGameObjectDDF.CollectionDesc';

// The Mobile Game template's main.collection, exactly as saved by the Defold editor.
const MAIN = `name: "main"
scale_along_z: 0
embedded_instances {
  id: "go"
  data: "components {\\n"
  "  id: \\"main\\"\\n"
  "  component: \\"/main/main.script\\"\\n"
  "}\\n"
  "embedded_components {\\n"
  "  id: \\"logo\\"\\n"
  "  type: \\"sprite\\"\\n"
  "  data: \\"default_animation: \\\\\\"icon_180\\\\\\"\\\\n"
  "material: \\\\\\"/builtins/materials/sprite.material\\\\\\"\\\\n"
  "textures {\\\\n"
  "  sampler: \\\\\\"texture_sampler\\\\\\"\\\\n"
  "  texture: \\\\\\"/main/main.atlas\\\\\\"\\\\n"
  "}\\\\n"
  "\\"\\n"
  "}\\n"
  ""
  position {
    x: 320.0
    y: 568.0
  }
}
`;

const valid = (resource: string, text: string) => checkFile(resource, text).filter((i) => i.severity === 'error');

describe('selectors', () => {
  it('parses filters, indexes and wildcards', () => {
    expect(parseSelector('/embedded_instances[id=go]/data/embedded_components[0]/data/textures[*]')).toEqual([
      { name: 'embedded_instances', filter: { key: 'id', value: 'go' } },
      { name: 'data' },
      { name: 'embedded_components', filter: { index: 0 } },
      { name: 'data' },
      { name: 'textures', filter: { all: true } },
    ]);
    expect(parseSelector('nodes[score]')).toEqual([{ name: 'nodes', filter: { value: 'score' } }]);
  });

  it('reads through embedded data', () => {
    expect(selectJson(MAIN, COLLECTION_TYPE, '/embedded_instances[id=go]/data/embedded_components[id=logo]/data/default_animation')).toBe('icon_180');
  });
});

describe('applyEdits', () => {
  it('changes a value two embedding levels deep and keeps every other byte', () => {
    const out = applyEdits(MAIN, COLLECTION_TYPE, [
      { op: 'set', path: '/embedded_instances[id=go]/data/embedded_components[id=logo]/data/default_animation', value: 'background' },
    ]);
    expect(out).toBe(MAIN.replace('icon_180', 'background'));
    expect(valid('/main/main.collection', out)).toEqual([]);
  });

  it('adds an embedded sprite to an embedded game object', () => {
    const out = applyEdits(MAIN, COLLECTION_TYPE, [
      {
        op: 'insert',
        path: '/embedded_instances[id=go]/data/embedded_components',
        value: {
          id: 'enemy',
          type: 'sprite',
          data: { default_animation: 'icon_180', material: '/builtins/materials/sprite.material', textures: [{ sampler: 'texture_sampler', texture: '/main/main.atlas' }] },
          position: { x: 100, y: 50 },
        },
      },
    ]);
    expect(valid('/main/main.collection', out)).toEqual([]);
    expect(selectJson(out, COLLECTION_TYPE, '/embedded_instances[id=go]/data/embedded_components[id=enemy]')).toEqual({
      id: 'enemy',
      type: 'sprite',
      data: { default_animation: 'icon_180', material: '/builtins/materials/sprite.material', textures: [{ sampler: 'texture_sampler', texture: '/main/main.atlas' }] },
      position: { x: 100, y: 50 },
    });
    // The original lines are untouched: the new component is inserted before the closing "}\n" of the data.
    expect(out.startsWith(MAIN.slice(0, MAIN.indexOf('  "}\\n"\n  ""')))).toBe(true);
    expect(out).toContain('  "embedded_components {\\n"\n  "  id: \\"enemy\\"\\n"');
  });

  it('inserts a new game object with a script and sets its position', () => {
    const out = applyEdits(MAIN, COLLECTION_TYPE, [
      { op: 'insert', path: '/embedded_instances', value: { id: 'player', data: { components: [{ id: 'player', component: '/main/player.script' }] }, position: { x: 10, y: 20 } } },
      { op: 'set', path: '/embedded_instances[id=player]/position/x', value: 42.5 },
    ]);
    expect(out.startsWith(MAIN)).toBe(true);
    expect(out.slice(MAIN.length)).toBe(
      'embedded_instances {\n  id: "player"\n  data: "components {\\n"\n  "  id: \\"player\\"\\n"\n  "  component: \\"/main/player.script\\"\\n"\n  "}\\n"\n  ""\n  position {\n    x: 42.5\n    y: 20.0\n  }\n}\n',
    );
  });

  it('creates missing embedded data and messages along a path, so nested values can be added in small steps', () => {
    const sprite = {
      id: 'sprite',
      type: 'sprite',
      data: { default_animation: 'icon_180', material: '/builtins/materials/sprite.material', textures: [{ sampler: 'texture_sampler', texture: '/main/main.atlas' }] },
    };
    const nested = applyEdits(MAIN, COLLECTION_TYPE, [
      { op: 'insert', path: '/embedded_instances', value: { id: 'enemy', data: { embedded_components: [sprite] }, position: { x: 100, y: 200 } } },
    ]);
    const stepwise = applyEdits(MAIN, COLLECTION_TYPE, [
      { op: 'insert', path: '/embedded_instances', value: { id: 'enemy' } },
      { op: 'insert', path: '/embedded_instances[id=enemy]/data/embedded_components', value: sprite },
      { op: 'set', path: '/embedded_instances[id=enemy]/position/x', value: 100 },
      { op: 'set', path: '/embedded_instances[id=enemy]/position/y', value: 200 },
    ]);
    expect(stepwise).toBe(nested);
    expect(valid('/main/main.collection', stepwise)).toEqual([]);
    expect(() => applyEdits(MAIN, COLLECTION_TYPE, [{ op: 'remove', path: '/embedded_instances[id=go]/rotation/x' }])).toThrow(/Nothing matches "rotation"/);
  });

  it('sets a script property override on a referenced instance', () => {
    const text = 'name: "level"\ninstances {\n  id: "enemy"\n  prototype: "/main/enemy.go"\n}\n';
    const out = applyEdits(text, COLLECTION_TYPE, [
      { op: 'insert', path: '/instances[id=enemy]/component_properties', value: { id: 'enemy', properties: [{ id: 'speed', value: '80.0', type: 'PROPERTY_TYPE_NUMBER' }] } },
    ]);
    expect(out).toBe(
      'name: "level"\ninstances {\n  id: "enemy"\n  prototype: "/main/enemy.go"\n  component_properties {\n    id: "enemy"\n    properties {\n      id: "speed"\n      value: "80.0"\n      type: PROPERTY_TYPE_NUMBER\n    }\n  }\n}\n',
    );
  });

  it('deletes a GUI node without touching neighbours', () => {
    const gui = 'script: "/gui/hud.gui_script"\nnodes {\n  type: TYPE_TEXT\n  id: "score"\n}\nnodes {\n  type: TYPE_TEXT\n  id: "lives"\n}\nmaterial: "/builtins/materials/gui.material"\n';
    const out = applyEdits(gui, 'dmGuiDDF.SceneDesc', [{ op: 'remove', path: '/nodes[id=score]' }]);
    expect(out).toBe('script: "/gui/hud.gui_script"\nnodes {\n  type: TYPE_TEXT\n  id: "lives"\n}\nmaterial: "/builtins/materials/gui.material"\n');
  });

  it('adds a field in the editor field order and edits inline messages', () => {
    const sprite = 'default_animation: "a"\ntextures {\n  sampler: "texture_sampler"\n  texture: "/a.atlas"\n}\n';
    const out = applyEdits(sprite, 'dmGameSystemDDF.SpriteDesc', [{ op: 'set', path: '/blend_mode', value: 'BLEND_MODE_ADD' }]);
    expect(out).toBe('default_animation: "a"\nblend_mode: BLEND_MODE_ADD\ntextures {\n  sampler: "texture_sampler"\n  texture: "/a.atlas"\n}\n');
    const inline = 'instances {\n  id: "x"\n  prototype: "/x.go"\n  position { x: 1.0 y: 2.0 }\n}\nname: "c"\n';
    const out2 = applyEdits(inline, COLLECTION_TYPE, [{ op: 'set', path: '/instances[id=x]/position/y', value: 5 }]);
    expect(out2).toBe('instances {\n  id: "x"\n  prototype: "/x.go"\n  position {\n    x: 1.0\n    y: 5.0\n  }\n}\nname: "c"\n');
  });

  it('accepts enum display names and rejects bad values with suggestions', () => {
    const out = applyEdits('default_animation: "a"\n', 'dmGameSystemDDF.SpriteDesc', [{ op: 'set', path: '/blend_mode', value: 'Multiply' }]);
    expect(out).toContain('blend_mode: BLEND_MODE_MULT');
    expect(() => applyEdits('default_animation: "a"\n', 'dmGameSystemDDF.SpriteDesc', [{ op: 'set', path: '/blend_mode', value: 'ADDITIVE' }])).toThrow(/Allowed: BLEND_MODE_ALPHA/);
    expect(() => applyEdits(MAIN, COLLECTION_TYPE, [{ op: 'set', path: '/embedded_instances[id=nope]/position/x', value: 1 }])).toThrow(/Existing: go/);
    expect(() => applyEdits(MAIN, COLLECTION_TYPE, [{ op: 'set', path: '/embedded_instance[id=go]/position/x', value: 1 }])).toThrow(/did you mean "embedded_instances"/);
  });

  it('creates a document from an object', () => {
    const out = applyEdits('', 'dmGameObjectDDF.PrototypeDesc', [
      { op: 'set', path: '/', value: { components: [{ id: 'enemy', component: '/main/enemy.script' }], embedded_components: [{ id: 'factory', type: 'factory', data: { prototype: '/main/bullet.go' } }] } },
    ]);
    expect(out).toBe(
      'components {\n  id: "enemy"\n  component: "/main/enemy.script"\n}\nembedded_components {\n  id: "factory"\n  type: "factory"\n  data: "prototype: \\"/main/bullet.go\\"\\n"\n  ""\n}\n',
    );
  });
});
