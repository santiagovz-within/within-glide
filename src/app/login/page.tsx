import { LoginForm } from '@/components/auth/LoginForm';
import { LoginCoverImage } from '@/components/auth/LoginCoverImage';
import { createAdminClient } from '@/lib/supabase/server';
import { getSignedReadUrl, gcsPathFromRef } from '@/lib/gcs';

export const dynamic = 'force-dynamic';

async function getLoginBgUrl(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('site_settings')
      .select('value')
      .eq('key', 'login_bg_gcs_ref')
      .maybeSingle();
    if (!data?.value) return null;
    return await getSignedReadUrl(gcsPathFromRef(data.value));
  } catch {
    return null;
  }
}

export default async function LoginPage() {
  const bgUrl = await getLoginBgUrl();

  return (
    <div
      className="min-h-screen flex"
      style={{ background: 'var(--color-bg-darkest)' }}
    >
      {/* ── Left: form ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col justify-center flex-1 px-12 py-12 lg:px-16 xl:px-24">
        <LoginForm />
      </div>

      {/* ── Right: background image ─────────────────────────────────────────── */}
      {bgUrl && <LoginCoverImage src={bgUrl} />}
    </div>
  );
}
