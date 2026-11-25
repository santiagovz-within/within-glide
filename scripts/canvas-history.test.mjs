import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    name => name in dependencies ? dependencies[name] : require(name), loaded, loaded.exports,
  );
  return loaded.exports;
}

const { createCanvasHistory, getCanvasHistoryAction } = load('src/lib/canvasHistory.ts');
const node = (id, extra = {}) => ({ id, type: 'promptNode', position: { x: 0, y: 0 }, data: { prompt: id }, ...extra });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });

function harness(nodes = [node('a'), node('b')], edges = [edge('a', 'b')]) {
  const jobs = {};
  const { useFlowStore: store } = load('src/lib/stores/flowStore.ts', {
    '@/lib/stores/generationStore': { useGenerationStore: {
      getState: () => ({ jobs, removeJob: id => { delete jobs[id]; } }),
    } },
  });
  store.getState().setCurrentFlow({ id: 'flow', flow_data: { nodes, edges } });
  const history = createCanvasHistory(store);
  const dispose = history.subscribe();
  return { store, history, dispose, jobs, state: store.getState };
}

function deleteB(h) {
  h.history.record();
  h.state().setCanvas(h.state().nodes.filter(n => n.id !== 'b'), []);
}

test('redo recovers nodes added after a deletion, with exact connections and media references', () => {
  const h = harness();
  deleteB(h);
  const data = Object.freeze({ imageUrl: 'https://example.com/existing-image.png', prompt: 'new node' });
  h.state().addNode(node('c', { type: 'imageInputNode', data }));
  h.state().setEdges([edge('a', 'c')]);
  const beforeUndo = h.state();
  h.history.undo();
  assert.deepEqual(h.state().nodes.map(n => n.id), ['a', 'b']);
  assert.deepEqual(h.state().edges, [edge('a', 'b')]);
  h.history.redo();
  assert.equal(h.state().nodes, beforeUndo.nodes);
  assert.equal(h.state().edges, beforeUndo.edges);
  assert.equal(h.state().nodes[1].data, data);
  assert.equal(h.state().isDirty, true);
  // History lives outside persisted flow data and the store's serialized state.
  assert.equal(JSON.stringify(h.state()).includes('existing-image.png'), true);
  h.history.undo();
  assert.equal(JSON.stringify(h.state()).includes('existing-image.png'), false);
  h.dispose();
});

test('rapid undo/redo uses current store state and restores nodes and edges atomically', () => {
  const h = harness();
  const initial = h.state();
  deleteB(h);
  const afterFirst = h.state();
  h.history.record();
  h.state().setCanvas([], []);
  const notifications = [];
  const unsubscribe = h.store.subscribe(state => notifications.push(state));
  h.history.undo();
  h.history.undo();
  h.history.redo();
  h.history.redo();
  assert.equal(notifications.length, 4);
  assert.equal(notifications[0].nodes, afterFirst.nodes);
  assert.equal(notifications[1].nodes, initial.nodes);
  assert.equal(notifications[1].edges, initial.edges);
  assert.equal(notifications[2].nodes, afterFirst.nodes);
  assert.deepEqual(notifications[3].nodes, []);
  unsubscribe();
  h.dispose();
});

test('group children, positions, ports and downstream data survive a round trip', () => {
  const nodes = [node('group', { type: 'groupNode', style: { width: 600, height: 400 } }),
    node('child', { parentId: 'group', position: { x: 10, y: 20 } }),
    node('target', { data: { inputImageUrls: ['image.png'], imagePortCount: 2 } })];
  const edges = [{ ...edge('child', 'target'), sourceHandle: 'image', targetHandle: 'ref_0' }];
  const h = harness(nodes, edges);
  h.history.record();
  h.state().setCanvas([node('target', { data: { inputImageUrls: [], imagePortCount: 1 } })], []);
  h.history.undo();
  assert.equal(h.state().nodes, nodes);
  assert.equal(h.state().edges, edges);
  h.history.redo();
  assert.deepEqual(h.state().nodes.map(n => n.id), ['target']);
  assert.deepEqual(h.state().nodes[0].data.inputImageUrls, []);
  h.dispose();
});

const edits = {
  'add node': h => h.state().addNode(node('new')),
  'delete node': h => h.state().removeNode('a'),
  'move node': h => h.state().onNodesChange([{ id: 'a', type: 'position', position: { x: 42, y: 9 } }]),
  'edit prompt': h => h.state().updateNodeData('a', { prompt: 'edited after undo' }),
  'receive generation result': h => h.state().updateNodeData('a', { generatedImages: ['new-result.png'] }),
  'remove edge': h => h.state().onEdgesChange([{ id: 'a-b', type: 'remove' }]),
  'reorder through direct store update': h => h.store.setState({ nodes: [...h.state().nodes].reverse(), isDirty: true }),
};
for (const [label, edit] of Object.entries(edits)) {
  test(`redo cannot overwrite a new edit: ${label}`, () => {
    const h = harness();
    deleteB(h);
    h.history.undo();
    edit(h);
    const edited = h.state();
    h.history.redo();
    assert.equal(h.state(), edited);
    h.dispose();
  });
}

test('selection, measurements, equivalent data and autosave metadata preserve redo', () => {
  const h = harness();
  deleteB(h);
  h.history.undo();
  h.state().onNodesChange([{ id: 'a', type: 'select', selected: true },
    { id: 'a', type: 'dimensions', dimensions: { width: 300, height: 200 } }]);
  h.state().onEdgesChange([{ id: 'a-b', type: 'select', selected: true }]);
  h.state().updateNodeData('a', { prompt: 'a', promptHistoryOverride: undefined });
  h.state().setSaving(true);
  h.state().setLastSaved(new Date());
  h.store.setState({ nodes: JSON.parse(JSON.stringify(h.state().nodes)),
    currentFlow: { ...h.state().currentFlow, updated_at: 'new timestamp' } });
  h.state().setDirty(false);
  h.history.redo();
  assert.deepEqual(h.state().nodes.map(n => n.id), ['a']);
  assert.equal(h.state().isDirty, true);
  h.dispose();
});

test('a new deletion after undo creates a new branch of history', () => {
  const h = harness();
  deleteB(h);
  h.history.undo();
  h.history.record();
  h.state().setCanvas([h.state().nodes[1]], []);
  const afterDelete = h.state();
  h.history.redo();
  assert.equal(h.state(), afterDelete);
  h.history.undo();
  assert.deepEqual(h.state().nodes.map(n => n.id), ['a', 'b']);
  h.history.redo();
  assert.deepEqual(h.state().nodes.map(n => n.id), ['b']);
  h.dispose();
});

test('history is bounded at 30 steps, including repeated undo/redo cycles', () => {
  const h = harness([node('0')], []);
  for (let i = 1; i <= 35; i++) {
    h.history.record();
    h.state().setCanvas([node(String(i))], []);
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let i = 0; i < 40; i++) h.history.undo();
    assert.equal(h.state().nodes[0].id, '5');
    for (let i = 0; i < 40; i++) h.history.redo();
    assert.equal(h.state().nodes[0].id, '35');
  }
  h.dispose();
});

test('changing flows or unmounting releases both histories', () => {
  for (const unmount of [false, true]) {
    const h = harness();
    deleteB(h);
    h.history.undo();
    if (unmount) h.dispose();
    else h.state().setCurrentFlow({ id: 'other-flow', flow_data: { nodes: [node('other')], edges: [] } });
    const current = h.state();
    h.history.redo();
    h.history.undo();
    assert.equal(h.state(), current);
    h.dispose();
  }
});

test('empty history is a no-op and restoration retains deleted job cleanup', () => {
  const h = harness();
  const initial = h.state();
  h.history.undo();
  h.history.redo();
  assert.equal(h.state(), initial);
  deleteB(h);
  h.history.undo();
  h.jobs['flow:b'] = { id: 'flow:b', nodeId: 'b', flowId: 'flow' };
  h.history.redo();
  assert.equal(h.jobs['flow:b'], undefined);
  h.dispose();
});

test('Mac and Windows shortcuts handle uppercase Shift+Z and reject unrelated keystrokes', () => {
  const event = { key: 'z', metaKey: false, ctrlKey: false, shiftKey: false,
    altKey: false, isComposing: false, defaultPrevented: false };
  assert.equal(getCanvasHistoryAction({ ...event, metaKey: true }, true), 'undo');
  assert.equal(getCanvasHistoryAction({ ...event, key: 'Z', metaKey: true, shiftKey: true }, true), 'redo');
  assert.equal(getCanvasHistoryAction({ ...event, ctrlKey: true }, false), 'undo');
  assert.equal(getCanvasHistoryAction({ ...event, key: 'Z', ctrlKey: true, shiftKey: true }, false), 'redo');
  assert.equal(getCanvasHistoryAction({ ...event, key: 'y', ctrlKey: true }, false), 'redo');
  assert.equal(getCanvasHistoryAction({ ...event, key: 'y', metaKey: true }, true), null);
  assert.equal(getCanvasHistoryAction(event, true), null);
  for (const flag of ['altKey', 'isComposing', 'defaultPrevented']) {
    assert.equal(getCanvasHistoryAction({ ...event, metaKey: true, [flag]: true }, true), null);
  }
});

// Exercise the component's actual listener without a browser or rendering media.
// Extract the effect via the TS AST so the tested handler is production code.
function keyboardHarness(readOnly = false) {
  const source = ts.createSourceFile('FlowCanvas.tsx',
    readFileSync(new URL('../src/components/canvas/FlowCanvas.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(ast) {
    if (ts.isCallExpression(ast) && ast.expression.getText(source) === 'useEffect') {
      const callback = ast.arguments[0];
      if (callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body)
        && callback.body.statements.some(statement => ts.isFunctionDeclaration(statement)
          && statement.name?.text === 'onKeyDown')) effect = callback;
    }
    ts.forEachChild(ast, visit);
  }
  visit(source);
  assert.ok(effect, 'canvas keyboard effect exists');
  const h = harness([node('a'), node('b', { selected: true })]);
  const listeners = new Map();
  const dependencies = {
    readOnly, history: h.history, useFlowStore: h.store,
    nodesRef: { current: h.state().nodes }, edgesRef: { current: h.state().edges },
    navigator: { platform: 'MacIntel' }, getCanvasHistoryAction,
    getSourceMediaType: () => undefined,
    window: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: type => listeners.delete(type),
    },
  };
  const { outputText } = ts.transpileModule(`const setup = ${effect.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  const cleanup = new Function(...Object.keys(dependencies), `${outputText}\nreturn setup();`)(...Object.values(dependencies));
  return {
    ...h,
    press(key, overrides = {}) {
      const event = { key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false,
        isComposing: false, defaultPrevented: false, target: { tagName: 'DIV', isContentEditable: false },
        preventDefault() { this.defaultPrevented = true; }, ...overrides };
      listeners.get('keydown')?.(event);
      return event;
    },
    dispose() { cleanup?.(); h.dispose(); },
  };
}

test('actual canvas shortcuts recover newly added nodes without waiting for a render', () => {
  const h = keyboardHarness();
  assert.equal(h.press('Backspace', { metaKey: false }).defaultPrevented, true);
  assert.deepEqual(h.state().nodes.map(n => n.id), ['a']);
  h.state().addNode(node('new'));
  h.state().setEdges([edge('a', 'new')]);
  assert.equal(h.press('z').defaultPrevented, true);
  assert.deepEqual(h.state().nodes.map(n => n.id), ['a', 'b']);
  assert.equal(h.press('Z', { shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(h.state().nodes.map(n => n.id), ['a', 'new']);
  assert.deepEqual(h.state().edges, [edge('a', 'new')]);
  h.dispose();
});

test('canvas history shortcuts leave text editing and read-only flows alone', () => {
  const h = keyboardHarness();
  h.press('Delete', { metaKey: false });
  const afterDelete = h.state();
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' },
    { tagName: 'SPAN', isContentEditable: true }]) {
    assert.equal(h.press('z', { target }).defaultPrevented, false);
    assert.equal(h.press('Z', { target, shiftKey: true }).defaultPrevented, false);
    assert.equal(h.state(), afterDelete);
  }
  h.press('z');
  assert.deepEqual(h.state().nodes.map(n => n.id), ['a', 'b']);
  h.dispose();

  const viewer = keyboardHarness(true);
  const initial = viewer.state();
  viewer.press('Delete', { metaKey: false });
  viewer.press('z');
  viewer.press('Z', { shiftKey: true });
  assert.equal(viewer.state(), initial);
  viewer.dispose();
});
