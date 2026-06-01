import { LoginForm } from '@/components/auth/LoginForm';
import { createAdminClient } from '@/lib/supabase/server';
import { getSignedReadUrl, gcsPathFromRef } from '@/lib/gcs';

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
      {bgUrl && (
        <div className="hidden lg:flex flex-1 p-3 min-h-screen">
          <div
            className="w-full h-full rounded-2xl overflow-hidden"
            style={{ position: 'relative' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={bgUrl}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
