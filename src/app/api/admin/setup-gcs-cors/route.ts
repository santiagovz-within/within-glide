import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { Storage } from '@google-cloud/storage';

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  return profile?.is_admin ? user : null;
}

// POST /api/admin/setup-gcs-cors
// One-time endpoint: applies CORS policy to the GCS bucket so browsers can
// PUT signed upload URLs and fetch signed read URLs directly.
export async function POST() {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = process.env.GCS_CREDENTIALS_JSON;
  const bucketName = process.env.GCS_BUCKET_NAME ?? 'within-glide';

  if (!raw) {
    return NextResponse.json({ error: 'GCS_CREDENTIALS_JSON not configured' }, { status: 500 });
  }

  let credentials: Record<string, string>;
  try {
    credentials = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'GCS_CREDENTIALS_JSON is not valid JSON' }, { status: 500 });
  }

  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }

  const storage = new Storage({ credentials });

  await storage.bucket(bucketName).setMetadata({
    cors: [
      {
        origin: ['*'],
        method: ['GET', 'PUT', 'HEAD', 'OPTIONS'],
        responseHeader: ['Content-Type', 'Access-Control-Allow-Origin'],
        maxAgeSeconds: 3600,
      },
    ],
  });

  return NextResponse.json({ success: true, bucket: bucketName });
}
