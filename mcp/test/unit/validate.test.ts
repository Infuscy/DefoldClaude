// Seeded-mistake suite: each case is a realistic error an LLM makes in Defold files; all must be caught.
import { describe, expect, it } from 'vitest';
import { checkFile } from '../../src/ddf/checkfile.js';
import { encodeEmbeddedLiteral } from '../../src/ddf/codec.js';

const exists = (known: string[]) => (r: string) => known.includes(r) || r.startsWith('/builtins/');
const go = (components: string) => `name: "main"\nembedded_instances {\n  id: "go"\n  data: ${encodeEmbeddedLiteral(components, 0)}\n}\n`;

const cases: Array<{ name: string; resource: string; text: string; rule: string; severity?: string }> = [
  { name: 'misspelled field', resource: '/a.collection', text: 'name: "a"\ninstances {\n  id: "x"\n  prototype: "/x.go"\n  positon { x: 1.0 }\n}\n', rule: 'unknown-field' },
  { name: 'missing required name', resource: '/a.collection', text: 'instances {\n  id: "x"\n  prototype: "/x.go"\n}\n', rule: 'required' },
  { name: 'quoted enum', resource: '/a.sprite', text: 'default_animation: "a"\nblend_mode: "BLEND_MODE_ADD"\n', rule: 'type' },
  { name: 'invalid enum', resource: '/a.sprite', text: 'default_animation: "a"\nblend_mode: ADD\n', rule: 'enum' },
  { name: 'unquoted string', resource: '/a.sprite', text: 'default_animation: idle\n', rule: 'type' },
  { name: 'string for number', resource: '/a.collisionobject', text: 'type: COLLISION_OBJECT_TYPE_STATIC\nmass: "0"\nfriction: 0.1\nrestitution: 0.5\ngroup: "g"\n', rule: 'type' },
  { name: 'duplicate singular field', resource: '/a.sprite', text: 'default_animation: "a"\ndefault_animation: "b"\n', rule: 'duplicate-field' },
  { name: 'duplicate instance id', resource: '/a.collection', text: 'name: "a"\ninstances {\n  id: "x"\n  prototype: "/x.go"\n}\ninstances {\n  id: "x"\n  prototype: "/x.go"\n}\n', rule: 'duplicate-id' },
  { name: 'dangling child', resource: '/a.collection', text: 'name: "a"\ninstances {\n  id: "x"\n  prototype: "/x.go"\n  children: "ghost"\n}\n', rule: 'dangling-child' },
  { name: 'duplicate component id', resource: '/a.go', text: 'components {\n  id: "s"\n  component: "/a.script"\n}\ncomponents {\n  id: "s"\n  component: "/b.script"\n}\n', rule: 'duplicate-id' },
  { name: 'relative resource path', resource: '/a.go', text: 'components {\n  id: "s"\n  component: "a.script"\n}\n', rule: 'path' },
  { name: 'missing resource', resource: '/a.go', text: 'components {\n  id: "s"\n  component: "/nope.script"\n}\n', rule: 'missing-resource' },
  { name: 'GUI undeclared font', resource: '/a.gui', text: 'nodes {\n  type: TYPE_TEXT\n  id: "t"\n  font: "big"\n}\n', rule: 'gui-font' },
  { name: 'GUI undeclared texture', resource: '/a.gui', text: 'textures {\n  name: "ui"\n  texture: "/ui.atlas"\n}\nnodes {\n  type: TYPE_BOX\n  id: "b"\n  texture: "icons/star"\n}\n', rule: 'gui-texture' },
  { name: 'GUI missing parent', resource: '/a.gui', text: 'nodes {\n  type: TYPE_BOX\n  id: "b"\n  parent: "panel"\n}\n', rule: 'dangling-parent' },
  { name: 'embedded component bad enum', resource: '/main.collection', text: go('embedded_components {\n  id: "s"\n  type: "sprite"\n  data: "default_animation: \\"a\\"\\nblend_mode: BLEND_ALPHA\\n"\n}\n'), rule: 'enum' },
  { name: 'embedded component unknown field', resource: '/main.collection', text: go('embedded_components {\n  id: "s"\n  type: "sprite"\n  data: "default_animation: \\"a\\"\\ntexture: \\"/a.atlas\\"\\n"\n}\n'), rule: 'unknown-field' },
  { name: 'broken embedded escaping', resource: '/main.collection', text: 'name: "main"\nembedded_instances {\n  id: "go"\n  data: "components {\\n  id: "x"\\n}\\n"\n}\n', rule: 'syntax' },
  { name: 'syntax error', resource: '/a.collection', text: 'name: "a"\ninstances {\n  id: "x"\n', rule: 'syntax' },
  { name: 'Lua syntax error', resource: '/a.script', text: 'function init(self)\n  if x then\nend\n', rule: 'lua-syntax' },
  { name: 'Lua 5.3 integer division', resource: '/a.script', text: 'local a = 7 // 2\n', rule: 'lua-syntax' },
  { name: 'message_id compared to string', resource: '/a.script', text: 'function on_message(self, message_id)\n  if message_id == "hit" then end\nend\n', rule: 'hash-compare', severity: 'warning' },
  { name: 'action_id compared to string', resource: '/a.gui_script', text: 'function on_input(self, action_id, action)\n  if action_id == "touch" then end\nend\n', rule: 'hash-compare', severity: 'warning' },
  { name: 'misspelled lifecycle', resource: '/a.script', text: 'function on_mesage(self, message_id, message, sender)\nend\n', rule: 'lifecycle-name', severity: 'warning' },
  { name: 'camelCase lifecycle', resource: '/a.script', text: 'function onInput(self, action_id, action)\nend\n', rule: 'lifecycle-name', severity: 'warning' },
  { name: 'go.property inside a function', resource: '/a.script', text: 'function init(self)\n  go.property("speed", 1)\nend\n', rule: 'go-property-scope' },
  { name: 'gui API in game object script', resource: '/a.script', text: 'function init(self)\n  gui.set_text(gui.get_node("x"), "y")\nend\n', rule: 'wrong-script-api', severity: 'warning' },
  { name: 'go API in GUI script', resource: '/a.gui_script', text: 'function init(self)\n  go.set_position(vmath.vector3())\nend\n', rule: 'wrong-script-api', severity: 'warning' },
  { name: 'require with slashes', resource: '/a.script', text: 'local m = require("modules/util.lua")\n', rule: 'require-path', severity: 'warning' },
  { name: 'game.project bool type', resource: '/game.project', text: '[display]\nhigh_dpi = yes\n', rule: 'setting-type' },
  { name: 'game.project unknown key typo', resource: '/game.project', text: '[display]\nwidht = 960\n', rule: 'unknown-setting', severity: 'warning' },
  { name: 'game.project missing main collection', resource: '/game.project', text: '[bootstrap]\nmain_collection = /main/missing.collectionc\n', rule: 'missing-resource' },
];

describe('seeded mistakes are all caught', () => {
  it.each(cases)('$name', ({ resource, text, rule, severity }) => {
    const issues = checkFile(resource, text, { resourceExists: exists(['/a.script', '/b.script', '/x.go']) });
    const hit = issues.find((i) => i.rule === rule);
    expect(hit, JSON.stringify(issues, null, 1)).toBeDefined();
    expect(hit!.severity).toBe(severity ?? 'error');
  });

  it('accepts correct versions without findings', () => {
    const ok = [
      ['/a.collection', 'name: "a"\ninstances {\n  id: "x"\n  prototype: "/x.go"\n  position { x: 1.0 }\n}\n'],
      ['/a.sprite', 'default_animation: "a"\nblend_mode: BLEND_MODE_ADD\n'],
      ['/a.script', 'local HIT = hash("hit")\ngo.property("speed", 1)\nfunction on_message(self, message_id)\n  if message_id == HIT then end\nend\n'],
      ['/game.project', '[display]\nhigh_dpi = 1\nwidth = 960\n'],
    ];
    for (const [r, t] of ok) expect(checkFile(r!, t!, { resourceExists: exists(['/x.go']) })).toEqual([]);
  });
});
