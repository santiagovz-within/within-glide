import { Storage } from '@google-cloud/storage';

const BUCKET_NAME = process.env.GCS_BUCKET_NAME ?? 'within-glide';
const raw = process.env.GCS_CREDENTIALS_JSON;

if (!raw) {
  console.error('Error: GCS_CREDENTIALS_JSON environment variable is not set.');
  console.error('Run with: node --env-file=.env.local scripts/setup-gcs-cors.mjs');
  process.exit(1);
}

let credentials;
try {
  credentials = JSON.parse(raw);
} catch {
  console.error('Error: GCS_CREDENTIALS_JSON is not valid JSON.');
  process.exit(1);
}

// Unescape newlines in private key (common issue with env var storage)
if (credentials.private_key) {
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
}

const storage = new Storage({ credentials });
const bucket = storage.bucket(BUCKET_NAME);

const corsConfig = [
  {
    origin: ['*'],
    method: ['GET', 'PUT', 'HEAD', 'OPTIONS'],
    responseHeader: ['Content-Type', 'Access-Control-Allow-Origin'],
    maxAgeSeconds: 3600,
  },
];

try {
  await bucket.setMetadata({ cors: corsConfig });
  console.log(`✓ CORS policy applied to bucket: ${BUCKET_NAME}`);
  console.log('  Allowed origins: *');
  console.log('  Allowed methods: GET, PUT, HEAD, OPTIONS');
  console.log('  Allowed headers: Content-Type');
} catch (err) {
  console.error('Failed to set CORS policy:', err.message);
  process.exit(1);
}
