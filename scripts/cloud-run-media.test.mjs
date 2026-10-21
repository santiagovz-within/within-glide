import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name === 'server-only') return {};
    return name in dependencies ? dependencies[name] : require(name);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const pathsModule = load('src/lib/mediaDerivativePaths.ts');
function harness() {
  const objects = new Map();
  let writes = 0;
  let failPath;
  const variants = load('src/lib/mediaVariants.ts', {
    '@/lib/mediaDerivativePaths': pathsModule,
    '@/lib/gcs': {
      MEDIA_CACHE_CONTROL: 'private, max-age=604800, immutable',
      getGcsBucket: () => ({ file: path => ({ exists: async () => [objects.has(path)] }) }),
      uploadToGCS: async (data, path) => {
        if (path === failPath) throw new Error('Simulated interrupted upload');
        writes++; objects.set(path, data);
      },
    },
  });
  return { ...variants, objects, writes: () => writes, fail: path => { failPath = path; } };
}

test('stored variants preserve aspect ratio and alpha, avoid upscaling, and are reused', async () => {
  const h = harness();
  const paths = pathsModule.mediaDerivativePaths('owner/image.png', 'image');
  const source = await sharp({ create: { width: 1400, height: 700, channels: 4, background: '#ff000080' } }).png().toBuffer();
  await h.createMediaVariants(source, paths);
  for (const [width, expected] of [[512, 512], [1024, 1024], [2048, 1400]]) {
    const metadata = await sharp(h.objects.get(paths.variantPaths[width])).metadata();
    assert.equal(metadata.width, expected);
    assert.equal(metadata.height, expected / 2);
    assert.equal(metadata.hasAlpha, true);
  }
  assert.equal(await h.hasMediaVariants(paths), true);
  const before = h.writes();
  await h.createMediaVariants(source, paths);
  assert.equal(h.writes(), before);
});

test('interrupted generation publishes no ready manifest and resumes without replacing completed files', async () => {
  const h = harness();
  const paths = pathsModule.mediaDerivativePaths('owner/retry.png', 'image');
  const source = await sharp({ create: { width: 160, height: 80, channels: 3, background: 'red' } }).png().toBuffer();
  h.fail(paths.variantPaths[1024]);
  await assert.rejects(h.createMediaVariants(source, paths));
  assert.equal(h.objects.has(paths.variantManifestPath), false);
  const first = h.objects.get(paths.variantPaths[512]);
  h.fail(undefined);
  await h.createMediaVariants(source, paths);
  assert.equal(h.objects.get(paths.variantPaths[512]), first);
  assert.equal(await h.hasMediaVariants(paths), true);
});

test('processing is bounded and duplicate asset requests share the same work', async () => {
  const h = harness();
  let running = 0, peak = 0, calls = 0;
  const work = async () => {
    calls++; running++; peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--; return null;
  };
  const first = h.withMediaProcessingSlot('duplicate', work);
  const duplicate = h.withMediaProcessingSlot('duplicate', work);
  assert.equal(first, duplicate);
  await Promise.all([first, duplicate, ...Array.from({ length: 6 }, (_, i) => h.withMediaProcessingSlot(`file-${i}`, work))]);
  assert.equal(calls, 7);
  assert.equal(peak, 2);
});

test('backfill never recursively processes its own derivative objects', () => {
  for (const path of ['media-derivatives/v1/thumbs/a.webp', 'media-derivatives/v2/image/a/512.webp']) {
    assert.equal(pathsModule.shouldCreateMediaDerivatives(path, 'image/webp'), false);
  }
  assert.equal(pathsModule.shouldCreateMediaDerivatives('owner/original.webp', 'image/webp'), true);
});

test('Cloud Run signing uses default credentials and coalesces concurrent requests', async () => {
  const original = process.env.GCS_CREDENTIALS_JSON;
  delete process.env.GCS_CREDENTIALS_JSON;
  let calls = 0;
  const gcs = load('src/lib/gcs.ts', {
    '@google-cloud/storage': { Storage: class {
      constructor(options) { assert.equal(options, undefined); }
      bucket() { return { file: () => ({ getSignedUrl: async options => {
        calls++;
        const remaining = options.expires.getTime() - Date.now();
        assert.ok(remaining > 6 * 60 * 60 * 1000 - 2000);
        assert.ok(remaining <= 12 * 60 * 60 * 1000);
        return ['https://storage.example/signed'];
      } }) }; }
    } },
    '@/lib/utils/mediaUtils': {},
  });
  try {
    const urls = await Promise.all(Array.from({ length: 20 }, () => gcs.getSignedReadUrl('owner/image.png')));
    assert.equal(new Set(urls).size, 1);
    assert.equal(calls, 1);
  } finally {
    if (original !== undefined) process.env.GCS_CREDENTIALS_JSON = original;
  }
});

test('authentication redirects use the public origin behind the Cloud Run proxy', async () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = 'https://glide.example.run.app';
  const clients = { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) };
  const access = load('src/lib/access-requests.ts', {
    '@/lib/supabase/server': clients,
    '@/lib/email': {},
  });
  try {
    for (const path of ['callback', 'approved']) {
      const route = load(`src/app/auth/${path}/route.ts`, {
        '@/lib/supabase/server': clients,
        '@/lib/access-requests': access,
      });
      const response = await route.GET(new Request(`https://0.0.0.0:8080/auth/${path}`));
      assert.equal(new URL(response.headers.get('location')).origin, 'https://glide.example.run.app');
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});
