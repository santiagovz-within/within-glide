import { getGcsBucket } from '@/lib/gcs';
import { ensureMediaDerivatives } from '@/lib/mediaDerivatives';
import { mediaDerivativePaths, shouldCreateMediaDerivatives } from '@/lib/mediaDerivativePaths';

// Run as a separate Cloud Run Job, so historical image processing never
// competes for the web service's request slots. Originals are never modified.
async function main() {
  const bucket = getGcsBucket();
  const checkpoint = bucket.file('migration-state/cloud-run-image-variants-v2.json');
  const maximum = Number(process.env.BACKFILL_MAX_FILES ?? '10000');
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100000) throw new Error('Invalid backfill limit');
  const [exists] = await checkpoint.exists();
  const state: { startOffset: string; processed: number; skipped: number; failed: number; failedPaths?: string[]; done: boolean } = exists
    ? JSON.parse((await checkpoint.download())[0].toString())
    : { startOffset: '', processed: 0, skipped: 0, failed: 0, done: false };
  const failedPaths = new Set(state.failedPaths ?? []);
  const summary = () => ({ processed: state.processed, skipped: state.skipped, failed: failedPaths.size, done: state.done });
  const save = () => checkpoint.save(JSON.stringify({ ...state, failed: failedPaths.size, failedPaths: [...failedPaths] }),
    { resumable: false, metadata: { contentType: 'application/json', cacheControl: 'no-store' } });
  const processObject = async (path: string, contentType: string) => {
    if (!shouldCreateMediaDerivatives(path, contentType)) return false;
    const paths = mediaDerivativePaths(path, contentType.startsWith('video/') ? 'video' : 'image');
    // Never initiate paid frame extraction, including when retrying a failure.
    if (paths.posterPath && !(await bucket.file(paths.posterPath).exists())[0]) return false;
    await ensureMediaDerivatives(path, contentType);
    return true;
  };
  let attempted = 0;
  // Retry interrupted/failed objects on the next execution, including when the
  // listing previously reached its end. The private checkpoint retains paths;
  // routine logs contain counts only.
  for (const path of failedPaths) {
    if (attempted >= maximum) break;
    attempted++;
    try {
      const [metadata] = await bucket.file(path).getMetadata();
      if (await processObject(path, metadata.contentType ?? '')) state.processed++;
      else state.skipped++;
      failedPaths.delete(path);
    } catch {
      // Keep it for a later retry without blocking the remaining media.
    }
  }
  await save();
  if (state.done) {
    console.log(JSON.stringify({ severity: 'INFO', event: 'media_backfill_already_scanned', ...summary() }));
    if (failedPaths.size) process.exitCode = 1;
    return;
  }
  while (attempted < maximum) {
    const [files] = await bucket.getFiles({ autoPaginate: false, maxResults: 100, startOffset: state.startOffset });
    if (!files.length) { state.done = true; break; }
    for (const file of files) {
      const contentType = file.metadata.contentType ?? '';
      try {
        if (!shouldCreateMediaDerivatives(file.name, contentType)) {
          state.skipped++;
        } else {
          attempted++;
          if (await processObject(file.name, contentType)) state.processed++;
          else state.skipped++;
        }
      } catch (error) {
        failedPaths.add(file.name);
        console.error(JSON.stringify({ severity: 'ERROR', event: 'media_backfill_failed',
          type: error instanceof Error ? error.name : 'UnknownError' }));
      }
      state.startOffset = `${file.name}\0`;
      if (attempted >= maximum) break;
    }
    await save();
    console.log(JSON.stringify({ severity: 'INFO', event: 'media_backfill_progress', ...summary() }));
  }
  await save();
  console.log(JSON.stringify({ severity: 'INFO', event: 'media_backfill_finished', ...summary() }));
  if (failedPaths.size) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({ severity: 'ERROR', event: 'media_backfill_stopped', type: error instanceof Error ? error.name : 'UnknownError' }));
  process.exitCode = 1;
});
