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
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    name => name in dependencies ? dependencies[name] : require(name), loadedModule, loadedModule.exports,
  );
  return loadedModule.exports;
}
const tags = load('src/lib/promptTags.ts');
const media = load('src/components/canvas/mediaOutputs.ts', { './nodes/TypedHandle': { PORT_TYPE_MAP: {} } });
const references = load('src/components/canvas/referenceVideoInputs.ts', { './mediaOutputs': media, '@/lib/promptTags': tags });
const { reorderInputConnections: reorder } = load('src/components/canvas/reorderInputConnections.ts', {
  '@/lib/promptTags': tags, './referenceVideoInputs': references,
});
const results = load('src/lib/imageGenerationResults.ts');
const referenceConfig = load('src/lib/api/referenceVideo.ts');
const imageSource = (id) => ({ id, type: 'imageInputNode', data: { imageUrl: `${id}.png` } });
const edge = (id, targetHandle, target = 'target') => ({ id, source: id, target, targetHandle, sourceHandle: 'image' });
const tag = (id, portIndex, kind = 'image') => ({ edgeId: id, sourceNodeId: id, portIndex, label: `${kind}${portIndex + 1}` });

test('Generated image connections resolve individual slots and preserve legacy batch outputs', () => {
  const source = { id: 'batch', type: 'imageGenNode', data: { status: 'completed', generatedImages: ['a.png', 'b.png', 'c.png'] } };
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image_0'), ['a.png']);
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image_2'), ['c.png']);
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image'), ['a.png', 'b.png', 'c.png']);
  assert.equal(media.getSourceMediaType(source, 'image_2'), 'image');
  assert.equal(media.getActiveMediaSourceHandle(source, 'image', [source], []), 'image_0');
  assert.equal(media.getSourceMediaType(imageSource('input'), 'image_2'), null);

  // History navigation and reload use the same saved handle, never another slot.
  source.data.generatedImages = ['older-a.png', 'older-b.png', 'older-c.png'];
  const edges = [0, 2].map(index => ({ id: `edge-${index}`, source: 'batch', sourceHandle: `image_${index}`,
    target: 'video', targetHandle: 'reference_images' }));
  const saved = JSON.parse(JSON.stringify({ nodes: [source], edges }));
  assert.deepEqual(references.getReferenceVideoInputs('video', saved.nodes, saved.edges).images.map(input => input.url),
    ['older-a.png', 'older-c.png']);
  source.data.generatedImages = ['only-one.png'];
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image_2'), []);
});

test('Pending and failed image slots never resolve a different successful image', () => {
  const source = { id: 'batch', type: 'imageGenNode', data: { status: 'processing',
    generationSlots: [null, 'second.png', null], generatedImages: ['second.png'] } };
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image_0'), []);
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image_1'), ['second.png']);
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image_2'), []);
  source.data.status = 'error';
  source.data.generationSlots[2] = 'third.png';
  source.data.generatedImages.push('third.png');
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image_0'), []);
  assert.deepEqual(media.getNodeMediaUrls(source, 'image', 'image_2'), ['third.png']);
});

test('Image reorder preserves sparse slots, edge identity, source nodes and semantic prompt tags', () => {
  const sourceNodes = ['a', 'b', 'c'].map(imageSource);
  const nodes = [...sourceNodes, { id: 'target', type: 'imageGenNode', data: {
    inputImageUrls: ['a.png', '', 'b.png', 'c.png'], imagePortCount: 5,
    prompt: 'Use @image1 with @image3 and @image4', promptTags: [tag('a', 0), tag('b', 2), tag('c', 3)],
  } }];
  const edges = [edge('a', 'ref_0'), edge('other', 'ref_0', 'another-node'), edge('b', 'ref_2'), edge('c', 'ref_3')];
  const next = reorder(nodes, edges, 'target', 'c', 'a');
  const data = next.nodes.at(-1).data;
  assert.deepEqual(data.inputImageUrls, ['c.png', '', 'a.png', 'b.png']);
  assert.equal(data.imagePortCount, 5);
  assert.deepEqual(next.edges.map(e => [e.id, e.targetHandle]), [['a', 'ref_2'], ['other', 'ref_0'], ['b', 'ref_3'], ['c', 'ref_0']]);
  assert.equal(next.edges[1], edges[1]);
  assert.deepEqual(next.nodes.slice(0, 3), sourceNodes);
  assert.equal(data.prompt, 'Use @image3 with @image4 and @image1');
  assert.equal(tags.reconcilePromptTags('target', data.prompt, data.promptTags, next.edges), null);
  assert.equal(tags.compilePromptForModel(data.prompt, data.promptTags, data.inputImageUrls).prompt,
    'Use the second image attached with the third image attached and the first image attached');
  assert.deepEqual(nodes.at(-1).data.inputImageUrls, ['a.png', '', 'b.png', 'c.png']);
});

test('Reference image and video order survives save/reload and reaches the generation payload', () => {
  const nodes = [imageSource('a'), imageSource('b'),
    { id: 'v1', type: 'videoInputNode', data: { videoUrl: 'https://example.com/1.mp4' } },
    { id: 'v2', type: 'videoInputNode', data: { videoUrl: 'https://example.com/2.mp4' } },
    { id: 'target', type: 'referenceVideoNode', data: {
      prompt: 'Animate @image1 like @video1', promptTags: [tag('a', 0), tag('v1', 0, 'video')],
    } }];
  nodes[0].data.imageUrl = 'https://example.com/a.png';
  nodes[1].data.imageUrl = 'https://example.com/b.png';
  const edges = [edge('a', 'reference_images'), edge('v1', 'reference_videos'),
    edge('unrelated', 'prompt', 'another-node'), edge('b', 'reference_images'), edge('v2', 'reference_videos')];
  let next = reorder(nodes, edges, 'target', 'b', 'a');
  next = reorder(next.nodes, next.edges, 'target', 'v2', 'v1');
  const restored = JSON.parse(JSON.stringify(next));
  const ordered = references.getReferenceVideoInputs('target', restored.nodes, restored.edges);
  const data = restored.nodes.at(-1).data;
  assert.deepEqual(ordered.images.map(r => r.sourceNodeId), ['b', 'a']);
  assert.deepEqual(ordered.videos.map(r => r.sourceNodeId), ['v2', 'v1']);
  assert.equal(next.edges[2], edges[2]);
  assert.equal(data.prompt, 'Animate @image2 like @video2');
  const { input } = referenceConfig.buildReferenceVideoInput({ model: 'seedance-2', prompt: data.prompt,
    referenceImageUrls: ordered.images.map(r => r.url), referenceVideoUrls: ordered.videos.map(r => r.url) });
  assert.deepEqual(input.image_urls, ['https://example.com/b.png', 'https://example.com/a.png']);
  assert.deepEqual(input.video_urls, ['https://example.com/2.mp4', 'https://example.com/1.mp4']);
  assert.equal(reorder(nodes, edges, 'target', 'a', 'v1'), null);
  assert.equal(reorder(nodes, edges, 'target', 'a', 'unrelated'), null);
  assert.equal(reorder(nodes, edges, 'target', 'a', 'missing'), null);
});

test('Frame reorder swaps both input roles and cached generation URLs without changing sources', () => {
  const nodes = [imageSource('a'), imageSource('b'), { id: 'target', type: 'videoGenNode', data: {
    startFrameUrl: 'a.png', endFrameUrl: 'b.png',
  } }];
  const edges = [edge('a', 'start_frame'), edge('b', 'end_frame')];
  const next = reorder(nodes, edges, 'target', 'b', 'a');
  assert.deepEqual(next.nodes.at(-1).data, { startFrameUrl: 'b.png', endFrameUrl: 'a.png' });
  assert.deepEqual(next.edges.map(e => [e.source, e.targetHandle]), [['a', 'end_frame'], ['b', 'start_frame']]);
  assert.equal(next.nodes[0], nodes[0]);
  assert.equal(next.nodes[1], nodes[1]);
});

test('External prompt tags remain positional when image inputs move', () => {
  const nodes = [{ id: 'target', type: 'imageGenNode', data: {
    promptConnected: true, prompt: '@image1', promptTags: [{ label: 'image1', portIndex: 0 }], inputImageUrls: ['a', 'b'],
  } }];
  const next = reorder(nodes, [edge('a', 'ref_0'), edge('b', 'ref_1')], 'target', 'a', 'b');
  assert.equal(next.nodes[0].data.prompt, '@image1');
  assert.deepEqual(next.nodes[0].data.promptTags, nodes[0].data.promptTags);
  assert.deepEqual(next.nodes[0].data.inputImageUrls, ['b', 'a']);
});

test('Failure acknowledgement archives legacy partial batches once and clears only failures', () => {
  const data = { status: 'error', generatedImages: ['a.png', 'b.png'], generationSlots: ['a.png', null, 'b.png'],
    generationErrors: [null, { message: 'Rejected' }, null], errorMessage: 'Rejected', generationHistory: [['older.png']] };
  const next = results.acknowledgeImageFailure(data);
  assert.deepEqual(next.generatedImages, ['a.png', 'b.png']);
  assert.deepEqual(next.generationHistory, [['older.png'], ['a.png', 'b.png']]);
  assert.equal(next.status, 'completed');
  for (const key of ['generationSlots', 'generationErrors', 'errorMessage']) assert.equal(next[key], undefined);
  assert.deepEqual(results.acknowledgeImageFailure({ ...data, ...next }).generationHistory, next.generationHistory);
  const allFailed = results.acknowledgeImageFailure({ ...data, generatedImages: [], generationSlots: [null, null] });
  assert.deepEqual(allFailed.generationHistory, [['older.png']]);
  assert.equal(allFailed.status, 'idle');
});

test('Background partial completion saves a history version before acknowledgement and propagates its first success', async () => {
  let nodeData = { generationHistory: [['older.png']] };
  let saved;
  const events = [];
  const job = { id: 'job', flowId: 'flow', nodeId: 'node', kind: 'image-generation', phase: 'processing',
    submissionsComplete: true, slotCount: 3, slots: ['a.png', null, 'b.png'], failedSlots: [1],
    startedAt: Date.now(), imageHistory: [['older.png']], requests: [{ requestId: 'failed', slotIndex: 1, status: 'failed', errorMessage: 'Rejected' }] };
  const generationState = { jobs: { job }, patchJob: (id, updates) => { generationState.jobs[id] = { ...generationState.jobs[id], ...updates }; },
    removeJob: id => { delete generationState.jobs[id]; } };
  const tracker = load('src/lib/generationTracker.ts', {
    '@/lib/stores/flowStore': { useFlowStore: { getState: () => ({ currentFlow: { id: 'flow' }, nodes: [{ id: 'node', data: nodeData }],
      updateNodeData: (_id, updates) => { nodeData = { ...nodeData, ...updates }; } }) } },
    '@/lib/stores/generationStore': { useGenerationStore: { getState: () => generationState } },
    '@/lib/utils/sound': { playSuccessSound: () => assert.fail('Partial failures should not play the all-success sound') },
    '@/lib/generationReconciliation': load('src/lib/generationReconciliation.ts'),
    '@/lib/imageGenerationResults': results,
  });
  const oldFetch = globalThis.fetch;
  const oldDocument = globalThis.document;
  globalThis.fetch = async (_url, options) => { saved = JSON.parse(options.body); return Response.json({ ok: true }); };
  globalThis.document = { dispatchEvent: event => events.push(event) };
  try { await tracker.progressBackgroundGenerations(); }
  finally { globalThis.fetch = oldFetch; globalThis.document = oldDocument; }
  assert.deepEqual(saved.data.generationHistory, [['older.png'], ['a.png', 'b.png']]);
  assert.deepEqual(nodeData.generationSlots, ['a.png', null, 'b.png']);
  assert.equal(nodeData.status, 'error');
  assert.equal(events[0].detail.imageUrl, 'a.png');
  assert.deepEqual(results.acknowledgeImageFailure(nodeData).generationHistory, saved.data.generationHistory);
  assert.deepEqual(generationState.jobs, {});
});

const { imageReferencePortCount } = load('src/components/canvas/imageReferenceInputs.ts');
test('Uploading references reserve image ports immediately, including sparse ports and model limits', () => {
  const edges = [edge('uploading', 'ref_0')];
  assert.equal(imageReferencePortCount('target', edges, 14), 2);
  assert.equal(tags.getTaggableInputs('target', edges, [])[0].url, '');
  assert.equal(imageReferencePortCount('target', [...edges, edge('second-upload', 'ref_1')], 14), 3);
  assert.equal(imageReferencePortCount('target', [edge('sparse-upload', 'ref_3')], 14), 5);
  assert.equal(imageReferencePortCount('target', [edge('last-upload', 'ref_13')], 14), 14);
  assert.equal(imageReferencePortCount('target', [], 14), 1);
});

test('Disconnected image tags retain their text and identity; only the missing binding is flagged', () => {
  const prompt = 'Combine @image1 with @image2';
  const live = [tag('a', 0), tag('b', 1)];
  const remaining = [edge('b', 'ref_1')];
  assert.equal(tags.reconcilePromptTags('target', prompt, live, remaining), null);
  assert.deepEqual(tags.findBrokenTags('target', live, remaining, ['', 'b.png']).map(t => t.label), ['image1']);
  const replaced = [edge('other', 'ref_0'), ...remaining];
  assert.deepEqual(tags.findBrokenTags('target', live, replaced, ['other.png', 'b.png']).map(t => t.label), ['image1']);
  const reconnected = [{ ...edge('new-a', 'ref_0'), source: 'a' }, ...remaining];
  const fixed = tags.reconcilePromptTags('target', prompt, live, reconnected);
  assert.equal(fixed.prompt, prompt);
  assert.equal(fixed.tags[0].edgeId, 'new-a');
  assert.deepEqual(tags.findBrokenTags('target', fixed.tags, reconnected, ['a.png', 'b.png']), []);
});

test('Reference labels survive list compaction and still compile to the right provider input positions', () => {
  const prompt = 'Use @image2 like @video1';
  const live = [tag('b', 1), tag('v', 0, 'video')];
  const nodes = [imageSource('b'), { id: 'v', type: 'videoInputNode', data: { videoUrl: 'v.mp4' } },
    { id: 'target', type: 'referenceVideoNode', data: { prompt, promptTags: live } }];
  const edges = [edge('b', 'reference_images'), edge('v', 'reference_videos')];
  const inputs = references.getReferenceVideoTaggableInputs('target', nodes, edges);
  assert.deepEqual(inputs.map(i => [i.label, i.portIndex]), [['image2', 0], ['video1', 0]]);
  const fixed = tags.reconcileMediaPromptTags(prompt, live, inputs);
  assert.equal(fixed.prompt, prompt);
  assert.equal(tags.compileMediaPromptTags(prompt, fixed.tags, inputs), 'Use @image1 like @video1');
  assert.deepEqual(tags.missingPromptTags(fixed.tags, inputs), []);
});

test('Missing reference labels cannot be reused by new inputs or duplicated during reorder', () => {
  const live = [tag('a', 0), tag('missing', 1), tag('c', 2)];
  const inputs = [
    { ...tag('c', 0), url: 'c.png' }, { ...tag('a', 1), url: 'a.png' }, { ...tag('new', 2), url: 'new.png' },
  ];
  const labeled = tags.labelInputsForTags(inputs, live);
  assert.deepEqual(labeled.map(i => i.label), ['image3', 'image1', 'image4']);
  const fixed = tags.reconcileMediaPromptTags('@image1 @image2 @image3', live, inputs, true);
  assert.equal(fixed.prompt, '@image1 @image2 @image3');
  assert.equal(new Set(fixed.tags.map(t => t.label)).size, 3);
  assert.deepEqual(tags.missingPromptTags(fixed.tags, inputs).map(t => t.label), ['image2']);
});

test('Copied tags remap internal and upstream connections while preserving missing associations', () => {
  const live = [tag('internal', 0), tag('upstream', 1), tag('missing', 2)];
  const copied = tags.remapCopiedPromptTags(live, new Map([['internal', 'copied-source']]),
    new Map([['internal', 'copied-internal'], ['upstream', 'copied-upstream']]));
  assert.deepEqual(copied, [
    { ...live[0], edgeId: 'copied-internal', sourceNodeId: 'copied-source' },
    { ...live[1], edgeId: 'copied-upstream' }, live[2],
  ]);
  const inputs = copied.slice(0, 2).map(t => ({ ...t, url: 'media.png' }));
  assert.deepEqual(tags.missingPromptTags(copied, inputs).map(t => t.label), ['image3']);
  assert.equal(live[0].edgeId, 'internal');
});

test('Typed or pasted tags remain chips without references; video frame tags retain their roles', () => {
  const typed = tags.syncTagsWithText('@image1 @video2', [], []);
  assert.deepEqual(typed.map(t => t.label), ['image1', 'video2']);
  assert.equal(tags.segmentPrompt('@image1 @video2', typed).filter(s => s.kind === 'tag').length, 2);
  assert.equal(tags.missingPromptTags(typed, []).length, 2);
  const inputs = tags.getVideoFrameTaggableInputs('target', [edge('a', 'start_frame'), edge('b', 'end_frame')],
    { startFrameUrl: 'a.png', endFrameUrl: 'b.png' });
  const live = tags.syncTagsWithText('Move from @image1 to @image2', [], inputs);
  assert.equal(tags.compileMediaPromptTags('Move from @image1 to @image2', live, inputs, true), 'Move from the start frame to the end frame');
  assert.deepEqual(tags.missingPromptTags(live, inputs.slice(1)).map(t => t.label), ['image1']);
});
