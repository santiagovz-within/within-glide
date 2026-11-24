import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => name in dependencies ? dependencies[name] : require(name), loaded, loaded.exports);
  return loaded.exports;
}

function preparation({ resolved = 'https://example.com/fresh.png', compressedSize = 1000 } = {}) {
  const compression = [], uploads = [];
  const api = load('src/lib/utils/backgroundRemoval.ts', {
    'browser-image-compression': { __esModule: true, default: async (file, options) => {
      compression.push({ file, options }); return new Blob([new Uint8Array(compressedSize)], { type: 'image/webp' });
    } },
    './mediaUtils': { isGcsRef: url => url.startsWith('gcs:'), resolveMediaUrl: async () => resolved },
    './uploadImage': { uploadImageToStorage: async file => { uploads.push(file); return 'https://example.com/prepared.webp'; } },
  });
  return { ...api, compression, uploads };
}

test('under-limit and exact-limit originals are reused after resolving their URL', async () => {
  const previousFetch = globalThis.fetch;
  try {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const p = preparation(); const requested = [];
      for (const size of [100, p.BACKGROUND_REMOVAL_MAX_BYTES]) {
        globalThis.fetch = async url => { requested.push(url); return new Response(new Blob([new Uint8Array(size)], { type })); };
        assert.equal(await p.prepareBackgroundRemovalImage('gcs:owner/source.png'), 'https://example.com/fresh.png');
      }
      assert.deepEqual(requested, ['https://example.com/fresh.png', 'https://example.com/fresh.png']);
      assert.equal(p.compression.length, 0); assert.equal(p.uploads.length, 0);
    }
  } finally { globalThis.fetch = previousFetch; }
});

test('oversized images become a separate alpha-capable WebP input with no requested resize', async () => {
  const previousFetch = globalThis.fetch;
  try {
    const p = preparation();
    globalThis.fetch = async () => new Response(new Blob([new Uint8Array(p.BACKGROUND_REMOVAL_MAX_BYTES + 1)], { type: 'image/png' }));
    assert.equal(await p.prepareBackgroundRemovalImage('original.png'), 'https://example.com/prepared.webp');
    assert.equal(p.compression.length, 1); assert.equal(p.uploads.length, 1);
    assert.equal(p.compression[0].options.fileType, 'image/webp');
    assert.equal(p.compression[0].options.alwaysKeepResolution, true);
    assert.equal(p.compression[0].options.maxWidthOrHeight, undefined);
    assert.ok(p.compression[0].options.maxSizeMB < 10);
    assert.equal(p.uploads[0].type, 'image/webp');
    assert.equal(p.uploads[0].name, 'background-removal-source.webp');
  } finally { globalThis.fetch = previousFetch; }
});

test('unreadable, unsupported, empty, and still-oversized images never get uploaded', async () => {
  const previousFetch = globalThis.fetch;
  try {
    const p = preparation({ compressedSize: 10 * 1024 * 1024 + 1 });
    for (const [response, message] of [
      [new Response('', { status: 403 }), /Could not load/],
      [new Response(new Blob(['gif'], { type: 'image/gif' })), /JPEG, PNG and WebP/],
      [new Response(new Blob([], { type: 'image/png' })), /empty/],
      [new Response(new Blob([new Uint8Array(p.BACKGROUND_REMOVAL_MAX_BYTES + 1)], { type: 'image/png' })), /still over/],
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(p.prepareBackgroundRemovalImage('source.png'), message);
    }
    assert.equal(p.uploads.length, 0);
    globalThis.fetch = () => { throw new Error('must not fetch unresolved references'); };
    await assert.rejects(preparation({ resolved: 'gcs:owner/source.png' }).prepareBackgroundRemovalImage('source.png'), /Could not load/);
  } finally { globalThis.fetch = previousFetch; }
});

function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children), ...elements(tree.props?.footer)];
}

test('node supports Upscale Media and indexed image outputs, prevents duplicate clicks, and preserves originals', async () => {
  const previousFetch = globalThis.fetch, previousDocument = globalThis.document;
  const changes = [], requests = [];
  globalThis.document = { dispatchEvent: event => changes.push(event) };
  globalThis.fetch = async (_url, request) => { requests.push(JSON.parse(request.body)); return Response.json({ mediaUrls: ['result.png'] }); };
  try {
    const media = load('src/components/canvas/mediaOutputs.ts', { './nodes/TypedHandle': { PORT_TYPE_MAP: {} } });
    for (const source of [
      { type: 'upscaleMediaNode', data: { outputImageUrl: 'original-upscaled.png' }, handle: 'image' },
      { type: 'imageGenNode', data: { generatedImages: ['first.png', 'second.png'] }, handle: 'image_1' },
    ]) {
      const store = { nodes: [{ id: 'source', ...source }], edges: [{ source: 'source', target: 'remove', targetHandle: 'image', sourceHandle: source.handle }], currentFlow: { id: 'flow' }, consumeGcsOnlyEligibility() {} };
      const hook = select => select(store); hook.getState = () => store;
      let finishPreparation, preparedSource;
      const dependencies = {
        react: { useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }) },
        '@xyflow/react': { Position: { Left: 'left', Right: 'right' } },
        '@/lib/stores/flowStore': { useFlowStore: hook }, '../mediaOutputs': media,
        '@/lib/utils/backgroundRemoval': { prepareBackgroundRemovalImage: url => { preparedSource = url; return new Promise(resolve => { finishPreparation = resolve; }); } },
        '@/lib/utils/download': {}, '@/lib/utils/sound': { playSuccessSound() {} },
        '@/components/canvas/CanvasMedia': { CanvasImage: 'img' }, '@/lib/utils/cn': { cn: () => '' },
        './ImageGenerationGlass.module.css': {}, '@/lib/api/models': { FAL_MODELS: { 'ideogram-remove-bg': { endpoint: 'test' } } },
        './FalCostEstimate': { __esModule: true, default: 'Cost' },
        './TypedHandle': { TypedHandle: 'Handle', PORT_COLORS: { image: '#fff' } },
      };
      for (const name of ['GenerationPreview', 'SendToFigmaButton', 'NodeWrapper']) dependencies[`./${name}`] = { [name]: name };
      const { RemoveBgNode } = load('src/components/canvas/nodes/RemoveBgNode.tsx', dependencies);
      const node = RemoveBgNode({ data: { status: 'idle' }, id: 'remove' });
      const button = elements(node).find(e => e.type === 'button' && elements(e).some(child => child.type === 'Cost'));
      assert.equal(button.props.disabled, false);
      const before = requests.length;
      const operation = button.props.onClick();
      await button.props.onClick();
      assert.equal(requests.length, before, 'Wait for preparation; ignore double-clicks.');
      assert.equal(preparedSource, source.type === 'imageGenNode' ? 'second.png' : 'original-upscaled.png');
      finishPreparation('prepared.webp'); await operation;
      assert.equal(requests.length, before + 1);
      assert.equal(requests.at(-1).imageUrl, 'prepared.webp');
      assert.ok(changes.some(event => event.detail.data?.status === 'completed'));
      assert.equal(store.nodes[0].data, source.data, 'Source data is not replaced.');
    }
  } finally { globalThis.fetch = previousFetch; globalThis.document = previousDocument; }
});
