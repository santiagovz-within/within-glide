# Cloud Run deployment

The existing Next.js application runs on Cloud Run. The public Vercel address
redirects to Cloud Run; its previous deployment remains available for rollback.
Supabase Auth, Postgres, RLS, users and old asset URLs remain in place. No schema
or original-media migration is required.

## Resources

| Setting | Value |
| --- | --- |
| Project | `within-glide` (`172589878467`) |
| Region / service | `us-central1` / `within-glide` |
| Public URL | `https://within-glide.cloud.run` |
| Original Cloud Run URL | `https://within-glide-172589878467.us-central1.run.app` |
| Per-instance resources | 2 vCPU, 4 GiB RAM |
| Scaling | Minimum 1, maximum 5, concurrency 8 |
| Billing / timeout | Request-based, startup CPU boost, 600 seconds |
| Runtime identity | `glide-serviceaccount@within-glide.iam.gserviceaccount.com` |
| Build identity | `glide-build@within-glide.iam.gserviceaccount.com` |
| Images | `us-central1-docker.pkg.dev/within-glide/glide/glide:BUILD_ID` |
| Media | Existing private `gs://within-glide` bucket, owned by `within-ai-beta` |

The runtime identity already has object access to the existing bucket. It uses
Application Default Credentials and IAM signing, with Token Creator granted on
itself. Cloud Run does not need the old `GCS_CREDENTIALS_JSON` private key.
The build identity has repository write access, source-bucket read access and
log-write access. It cannot read runtime secrets.

## Configuration and secrets

Public build substitutions are `_SUPABASE_URL`, `_SUPABASE_ANON_KEY`, `_APP_URL`
and `_REGION`. Next.js embeds `NEXT_PUBLIC_*` values when building. The public
Supabase key is expected in browser code; never substitute the service-role key.

Runtime public variables: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`,
`GCS_BUCKET_NAME=within-glide`, `GCS_IMAGE_VARIANTS=1`, `NODE_ENV=production`.

Server credentials belong in Secret Manager, referenced by explicit version:

| Environment variable | Secret name |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | `glide-supabase-service-role-key` |
| `FAL_KEY` | `glide-fal-key` |
| `FAL_ADMIN_KEY` | `glide-fal-admin-key` |
| `GOOGLE_AI_API_KEY` | `glide-google-ai-api-key` |
| `GMAIL_USER` | `glide-gmail-user` |
| `GMAIL_APP_PASSWORD` | `glide-gmail-app-password` |

All six secrets are configured, with Secret Accessor granted separately to the
runtime identity. FAL and Google credentials passed read-only provider checks;
Gmail passed SMTP authentication both locally and from Cloud Run, without
sending email. Do not populate secrets
with placeholders or revoke Vercel's existing credentials during the transition.

Store local environment/flags files under gitignored `.context/` with mode 0600.
`.gcloudignore` and `.dockerignore` exclude local secrets, Git metadata and
dependencies. Check upload contents before building. Never put server secrets
in Docker build arguments, source code, command-line values or build logs.

## Build and release

1. Run `npm ci`, `npm run typecheck`, `npm run test:cloud-run`, and the existing
   generation/canvas regression suites. Run ESLint on changed files.
2. Prepare a private `gcloud` flags file containing the public build substitutions,
   `--project=within-glide`, `--config=cloudbuild.yaml`, the build service account,
   and source staging directory
   `gs://within-glide-build-source-172589878467/source`.
3. Run `gcloud builds submit . --flags-file=.context/build-flags.json --async`.
   Wait for `SUCCESS`; keep its build ID and immutable image digest.
4. Update only the Cloud Run image; existing service settings and secret
   references are preserved:

   ```sh
   gcloud run services update within-glide \
     --project=within-glide --region=us-central1 \
     --image=us-central1-docker.pkg.dev/within-glide/glide/glide:BUILD_ID
   ```

5. Verify `/api/health`, login, dashboard authorization, existing flows, gallery,
   direct upload/download, image previews, generation and administrative views.
   Do not use email-delivery tests that notify other users without approval.

The container runs Node 22 as a non-root user and listens on port 8080. A startup
probe calls `/api/health`. Both the web server and the media job use the same
image. Its build checks that the job's storage/FAL/Sharp dependencies are present.

## Login continuity

Supabase's redirect allowlist includes both Cloud Run hostnames:

```text
https://within-glide.cloud.run/auth/callback
https://within-glide.cloud.run/auth/callback?next=**
https://within-glide-172589878467.us-central1.run.app/auth/callback
https://within-glide-172589878467.us-central1.run.app/auth/callback?next=**
```

Keep `https://within-glide.vercel.app/auth/callback`. Supabase's Site URL is now
`https://within-glide.cloud.run`. The app explicitly supplies its redirect URL.
Google OAuth continues to use
Supabase's existing provider callback, so users retain the same identities and
approvals. Browser cookies cannot move between hostnames: users sign in once on
Cloud Run. Use the public URL above consistently, not the alternate opaque
Cloud Run hostname. Auth handlers use the configured public origin because a
standalone server may see its internal listen address behind Cloud Run.

The short address uses Google's [custom URL Preview](https://docs.cloud.google.com/run/docs/custom-urls),
mapped to the same `within-glide` service in `us-central1`. It does not require
buying a domain, DNS configuration or an external load balancer. Keep the mapping
in place: deleting it releases the name for others to claim. The original
`run.app` endpoint remains enabled, and Vercel remains deployed separately.

The mapping requires a current CLI (configured with 590.0.0). Inspect it with:

```sh
gcloud beta run domain-mappings describe --domain=within-glide.cloud.run \
  --project=within-glide --region=us-central1
```

Keep `_APP_URL` in build substitutions and `NEXT_PUBLIC_APP_URL` at runtime set
to the short address. Next.js inlines public environment variables at build
time, so changing only the runtime variable is insufficient.

## Redirect from the old Vercel address

`https://within-glide.vercel.app/:path` now returns HTTP 308 to
`https://within-glide.cloud.run/:path`, preserving query parameters. This is a
[project-level CDN rule](https://vercel.com/docs/routing/project-routing-rules),
so it runs before application routes, functions and image optimization, and
survives subsequent Vercel deployments. It only matches the public hostname;
preview and immutable deployment URLs retain their existing access controls.

- Vercel project: `withinglide` (`prj_yAAIGlfYfwUCeLtl6KfrwI15V7Zp`).
- Scope: `santiagos-projects-b073a7f4`.
- Rule: `Cloud Run primary URL` (`8c09c0b1-a30a-442c-9b04-54232a71a693`).
- Published version: `c1ae3cb0-c987-4732-b873-666916f082f6`.
- [Recorded rule definition](vercel-redirect.json); this is a project-rule
  reference, not a root `vercel.json` deployment configuration.

Inspect the live rule with Vercel CLI 65 or newer:

```sh
vercel routes list --production --json \
  --project=prj_yAAIGlfYfwUCeLtl6KfrwI15V7Zp \
  --scope=santiagos-projects-b073a7f4
```

If the rule is ever removed, recreate it only after checking the existing rules:

```sh
vercel routes add 'Cloud Run primary URL' \
  --src='/:path*' --src-syntax=path-to-regexp \
  --action=redirect --dest='https://within-glide.cloud.run/:path' --status=308 \
  --has='host:eq=within-glide.vercel.app' \
  --set-response-header='Cache-Control=private, no-store, max-age=0' \
  --position=start --yes \
  --project=prj_yAAIGlfYfwUCeLtl6KfrwI15V7Zp \
  --scope=santiagos-projects-b073a7f4
vercel routes list --diff \
  --project=prj_yAAIGlfYfwUCeLtl6KfrwI15V7Zp \
  --scope=santiagos-projects-b073a7f4
vercel routes publish --yes \
  --project=prj_yAAIGlfYfwUCeLtl6KfrwI15V7Zp \
  --scope=santiagos-projects-b073a7f4
```

The destination uses `:path`, without the source's `*` modifier. Live verification
found that `:path*` in this project-rule destination appends a literal asterisk.
Do not publish unrelated staged routing changes. `Cache-Control: no-store`
prevents compliant browsers from retaining the permanent redirect across a
rollback. Keep the Vercel project and hostname active: CDN requests still depend
on Vercel's service and account limits, even though these redirected requests
do not invoke the old app or its image optimizer.

Users with an old tab open should reload and sign in on Cloud Run. Cookies and
in-progress OAuth PKCE state do not transfer across hostnames; a login started
on the old hostname may need to be restarted on the new one. Existing user
accounts, approvals and data remain the same.

## Images and media

Uploads continue to use signed browser-to-GCS URLs. Stored images have 512,
1024 and 2048 pixel WebP previews at quality 75, without upscaling. Existing
128-pixel thumbnails and video posters are reused. Original downloads, focused
original images, animations and video playback keep their existing sources.

Preview work is limited to two simultaneous operations per instance and duplicate
requests share the same work. A ready manifest is written only after all sizes
are stored. Images without ready previews use Next.js's self-hosted optimizer
on Cloud Run; this no longer consumes Vercel transformation quota. Its local
cache is ephemeral and per instance, so GCS previews are the durable cache.
Legacy Supabase images retain their original links.

Private media uses signed URLs and private browser caching. IAM signatures are
reused within six-hour windows, leaving 6–12 hours before expiry. Google's
[managed signing keys](https://docs.cloud.google.com/storage/docs/authentication/creating-signatures)
are guaranteed for only 12 hours, so the app must not advertise seven-day URLs
when signing without a private key. Clients refresh expired references. Do not
make the bucket public or add a public CDN cache in front of private media.

The optional `within-glide-media-backfill` Cloud Run Job runs
`node media-variants-job.mjs` with `GCS_IMAGE_VARIANTS=1` and
`GCS_BUCKET_NAME=within-glide`. Use one task, 2 vCPU/4 GiB, a 3600-second timeout,
and bounded `BACKFILL_MAX_FILES`. It saves a private checkpoint under
`migration-state/`, retries failed objects on later executions, and never
replaces originals or starts paid video-frame extraction. It is separate from
interactive web requests. A completed checkpoint is not a periodic scanner for
future files uploaded by the old Vercel deployment.

The initial batch is bounded to 1,000 source objects per task attempt, with one
automatic retry. Historical preview conversion is still in progress at handoff;
failed objects remain in the checkpoint for retry and keep their original-image
fallback. Check that no execution is running before starting another batch,
because the checkpoint has a single writer:

```sh
gcloud run jobs executions list --job=within-glide-media-backfill \
  --project=within-glide --region=us-central1
```

## Verified rollout (2026-10-21 UTC)

The initial migration revision was `within-glide-00004-n2n`.
Its build was `0327b7a0-cb6c-4deb-a328-4f31b9b5b451`, image digest
`sha256:8b26980657eb3761ab4f9f89c798f96681c8d0bf07863049880560338f6b7d9b`.
Vercel's deployed code was retained. Its public hostname now has the CDN redirect
described above.

The short-domain rollout now serves 100% of traffic from
`within-glide-00005-7jq`, build `29cbd966-d4f9-4c71-abc3-b4ada28b09a6`, digest
`sha256:e25a26ee7d6ceb02ddad766dafd6d68f2272df51ebab5b56440fec90dc91a690`.
The `within-glide.cloud.run` mapping reports Ready and DomainRoutable. HTTPS,
health, protected-route redirects, image optimization and real Google sign-in
to the dashboard passed on the new hostname. Both auth handlers redirect to
the short hostname. Supabase has five allowed callback URLs and the short
hostname as its Site URL. CPU, memory, scaling and all six secret references
are unchanged. The original Cloud Run login page still returns 200. The old
Vercel login URL returns 308 to the equivalent page on the short hostname.

The Vercel redirect passed eight live HTTP checks covering root, login,
dashboard, nested paths, repeated and encoded query parameters, auth callback,
API and image routes. Following the old root reached the Cloud Run login page
with HTTP 200; following its health URL reached Cloud Run's healthy endpoint.

- Real Google sign-in with an existing approved account reached the dashboard.
  Existing saved flows, canvas images and the gallery rendered in Zen.
- Health, public login, protected-route authorization and self-hosted image
  optimization passed HTTP checks. The public admin bootstrap now returns 410.
- A Cloud Run validation job passed keyless signed reads, signed uploads, Sharp
  processing and a read-only Supabase query. It used two small synthetic images
  under `cache-probes/cloud-run-migration-2026-10-21/`; originals were untouched.
- FAL and Google API credentials passed read-only provider checks. A separate
  Cloud Run SMTP check authenticated successfully (235); it sent no messages.
- Linux container build, TypeScript, 6 migration tests, 153 existing regression
  tests and targeted ESLint passed. Full-repository ESLint still reports six
  pre-existing errors in unrelated canvas/admin components.
- A repeated login-page burst with 32 concurrent clients completed 64/64
  requests, with about 1.1 seconds at p95. Initial scale-out was slower. This is
  a login-page check, not proof of full canvas/AI capacity for 30 active users.

No live paid generation, end-to-end access-request email delivery or full user
workload test was run. Those normal workflows remain to be verified after the
approved redirect cutover. The historical preview job can continue independently;
it is not required for original media or the fallback optimizer to work.

## Logs, costs and rollback

Default log retention is 30 days. The `glide-routine-requests` exclusion removes
successful health/static/image request noise. Application errors and failed HTTP
requests remain available. Generation logs omit prompt bodies and signed image
URLs. Preview-job logs contain progress counts rather than asset paths.

The five-instance limit limits scaling, not total spending. A warm 2 vCPU/4 GiB
instance costs about $39 per 30-day month while idle, before account-level free
allowances. Active compute, jobs, builds, image storage, requests and network
traffic add to this. Supabase and AI-provider charges continue separately. Use
Google Cloud's [current pricing](https://cloud.google.com/run/pricing) and actual
billed instance time; Vercel's active-CPU total is not a Cloud Run cost estimate.

The original Vercel deployment is retained as
`dpl_ByhHemjXt1Xyo3q5QPMQ8rpUW2QU`
(`withinglide-8mtcm55ee-santiagos-projects-b073a7f4.vercel.app`). Its deployment
URL remains subject to Vercel access protection. To restore the public old
address, disable the redirect, review the staged diff, and publish:

```sh
vercel routes disable 8c09c0b1-a30a-442c-9b04-54232a71a693 \
  --project=prj_yAAIGlfYfwUCeLtl6KfrwI15V7Zp \
  --scope=santiagos-projects-b073a7f4
vercel routes list --diff \
  --project=prj_yAAIGlfYfwUCeLtl6KfrwI15V7Zp \
  --scope=santiagos-projects-b073a7f4
vercel routes publish --yes \
  --project=prj_yAAIGlfYfwUCeLtl6KfrwI15V7Zp \
  --scope=santiagos-projects-b073a7f4
```

Do not restore the first redirect version: it used the incorrect `:path*`
destination. If later Git pushes have replaced Vercel's production deployment,
restore the recorded deployment as well. Both apps use the same database and
original media; no data restore is needed merely to switch hosts. Keep the old
Supabase callback allowed and avoid simultaneous edits of a flow in both apps.

For a Cloud Run application rollback, list revisions and direct traffic to a
previous known-good revision:

```sh
gcloud run revisions list --service=within-glide --project=within-glide --region=us-central1
gcloud run services update-traffic within-glide --project=within-glide \
  --region=us-central1 --to-revisions=PREVIOUS_REVISION=100
```

Do not delete Supabase data, GCS originals, the Vercel deployment or previous
working image revisions as part of this rollout.
