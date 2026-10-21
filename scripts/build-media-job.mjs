import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/media-variants-job.ts'],
  outfile: '.next/standalone/media-variants-job.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  plugins: [{
    name: 'server-only-job',
    setup(bundler) {
      bundler.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'server-job' }));
      bundler.onLoad({ filter: /.*/, namespace: 'server-job' }, () => ({ contents: 'export {};', loader: 'js' }));
    },
  }],
});
