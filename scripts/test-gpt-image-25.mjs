// Run with Node 22.6+: node --experimental-strip-types --test scripts/test-gpt-image-25.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGptImage25Size } from '../src/lib/gptImage25.ts';

test('all offered aspect ratios and resolution tiers fit the Fal image size limits', () => {
  for (const aspectRatio of ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']) {
    for (const resolution of ['1K', '2K', '4K']) {
      const { width, height } = getGptImage25Size(aspectRatio, resolution);
      const [w, h] = aspectRatio.split(':').map(Number);
      assert.equal(width % 16, 0);
      assert.equal(height % 16, 0);
      assert.ok(Math.max(width, height) <= 3840);
      assert.ok(width * height >= 655_360);
      assert.ok(width * height <= 8_294_400);
      assert.ok(Math.abs(width / height - w / h) / (w / h) < 0.025);
    }
  }
});

test('scales small widescreen and large square requests into the accepted pixel range', () => {
  const small = getGptImage25Size('16:9', '1K');
  assert.ok(small.width > 1024);
  const large = getGptImage25Size('1:1', '4K');
  assert.equal(large.width, large.height);
  assert.ok(large.width < 3840);
  assert.deepEqual(getGptImage25Size('16:9', '4K'), { width: 3840, height: 2160 });
  assert.deepEqual(getGptImage25Size('1:1', '1K'), { width: 1024, height: 1024 });
});

test('rejects invalid dimensions and unsupported resolution tiers', () => {
  for (const ratio of ['0:1', '-1:1', 'NaN:1', 'Infinity:1', '1', '1:1:1', '4:1', '1:4']) {
    assert.equal(getGptImage25Size(ratio, '1K'), null);
  }
  assert.equal(getGptImage25Size('1:1', '8K'), null);
});

test('rounding at the maximum aspect ratio stays within 3:1', () => {
  for (const ratio of ['3:1', '1:3']) {
    for (const resolution of ['1K', '2K', '4K']) {
      const { width, height } = getGptImage25Size(ratio, resolution);
      assert.ok(Math.max(width, height) / Math.min(width, height) <= 3);
      assert.ok(width * height >= 655_360 && width * height <= 8_294_400);
    }
  }
});
