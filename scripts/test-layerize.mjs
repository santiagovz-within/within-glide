// Run with Node 22.6+: node --experimental-strip-types --test scripts/test-layerize.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeOriginal, createEditableLayers, layerCanvasSize, sameLayerizeSource } from '../src/lib/layerize.ts';

test('positions cropped layers in the base coordinate system and sorts back to front', () => {
  const result = createEditableLayers([
    { image: { url: 'foreground.png', width: 200, height: 100 }, z_index: 4, name: 'Subject', description: 'Foreground subject', bounding_box: { absolute: [120, 60, 320, 160] } },
    { image: { url: 'base.png' }, z_index: 0 },
  ], 1024, 512);
  assert.equal(result[0].name, 'Background');
  assert.equal(result[1].name, 'Subject');
  assert.equal(result[1].description, 'Foreground subject');
  assert.deepEqual(result[1].bounds, { x: 120, y: 60, width: 200, height: 100 });
  assert.deepEqual(layerCanvasSize(result), { width: 1024, height: 512 });
});

test('normalized bounds use 0..1000, with independent width and height scaling', () => {
  const [layer] = createEditableLayers([{ image: { url: 'layer.png' }, z_index: 1, bounding_box: { normalized: [100, 200, 600, 800] } }], 2000, 1000);
  assert.deepEqual(layer.bounds, { x: 200, y: 200, width: 1000, height: 600 });
});

test('Arrange Original restores order, visibility, position and scale while retaining replacements', () => {
  const initial = createEditableLayers([
    { image: { url: 'base.png' }, z_index: 0 },
    { image: { url: 'subject.png' }, z_index: 1, bounding_box: { absolute: [10, 20, 60, 80] } },
  ], 512, 512);
  const edited = [
    { ...initial[1], visible: false, imageUrl: 'replacement.png', bounds: { x: -40, y: 95, width: 150, height: 180 } },
    initial[0],
  ];
  const restored = arrangeOriginal(edited);
  assert.deepEqual(restored.map(layer => layer.originalOrder), [0, 1]);
  assert.deepEqual(restored[1].bounds, initial[1].bounds);
  assert.equal(restored[1].visible, true);
  assert.equal(restored[1].imageUrl, 'replacement.png');
  assert.equal(edited[0].bounds.x, -40);
  assert.equal(layerCanvasSize(edited).width, 512);
});

test('rejects malformed geometry instead of rendering an invalid composition', () => {
  for (const absolute of [[0, 0, 0, 20], [10, 10, 5, 5], [0, 0, NaN, 20], [1, 2]]) {
    assert.throws(() => createEditableLayers([{ image: { url: 'image.png' }, z_index: 1, bounding_box: { absolute } }], 512, 512));
  }
  assert.throws(() => createEditableLayers([], 0, 512));
});

test('refreshing a signed storage URL does not mark the source as changed', () => {
  assert.equal(sameLayerizeSource('https://storage.googleapis.com/bucket/image.png?X-Goog-Date=old', 'https://storage.googleapis.com/bucket/image.png?X-Goog-Date=new'), true);
  assert.equal(sameLayerizeSource('https://images.example/image?id=1', 'https://images.example/image?id=2'), false);
  assert.equal(sameLayerizeSource('a.png', 'b.png'), false);
});
