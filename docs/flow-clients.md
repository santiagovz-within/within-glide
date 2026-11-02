# Flow client tagging

Apply `supabase/migrations/016_flow_clients.sql` and `017_fix_flow_client_source_types.sql` to the Supabase database before deploying this application version. Migration 017 fixes the text generation source ID / UUID flow ID comparison on databases that already applied 016. It creates and seeds the client directory with the 36 supplied clients, adds client foreign keys to flows and generations, and installs database enforcement and attribution triggers. Deploy the migration and application together: older application versions cannot create untagged flows after the migration.

Existing flows are deliberately left unassigned. Owners choose a client only when reopening an unassigned flow (including drafts and templates). The dashboard and other flows remain accessible, and the prompt can be canceled to return to the flow list. Users choose a client before creating a blank flow, using a template, or forking a shared flow. The generation APIs verify the owned flow has a client before calling a paid provider.

Assigning a client backfills all retained generation records linked to that workflow. Changing the client from the editor moves that workflow's retained historical costs as well as future costs. Both changes occur atomically in the database. A generation's client cannot be edited directly, and its attribution is preserved if its flow is deleted. New copies get their own client; the source workflow's historical charges stay with the source.

Admins can add and rename clients at **Admin → Clients**. Client IDs remain stable when names change. Both the API and database policies restrict client changes to administrators; there is no client deletion action.

**Admin → All Usage → By client** uses the existing UTC date/period filters. It shows recorded USD, completed generation counts, distinct workflows, and missing-price counts per client. Chat, realtime, and still-unassigned historical usage appear under **Unassigned / outside flows**. Missing prices are reported as unpriced rather than estimated; reports include retained generation records only. Legacy records without a workflow reference cannot be automatically attributed.

Run `npm run test:clients` for attribution/authorization tests and the spending tests. The migration test executes against an isolated in-memory Postgres database using PGlite; it needs no Supabase credentials and never touches production.
