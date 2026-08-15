-- Two fixed, deterministic test users for the RLS pgTAP suite
-- (supabase/tests/database/categories_rls.test.sql). Fixed UUIDs so the
-- suite never has to look anything up — matching config.toml's
-- already-enabled [db.seed] block, so this runs on every `supabase db reset`.
--
-- auth.identities rows are seeded alongside auth.users so these accounts also
-- work for a manual email/password sign-in sanity check, not only for the
-- pgTAP role/JWT-claim impersonation trick (see plan's Critical Implementation
-- Details) which doesn't touch auth.identities at all.
--
-- confirmation_token / recovery_token / email_change_token_new / email_change
-- have no column default (unlike the other GoTrue token columns) and GoTrue's
-- Go driver can't scan NULL into them — a real password sign-in 500s with
-- "converting NULL to string is unsupported" unless they're set to '' here.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    'rls-test-user-a@example.com',
    crypt('rls-test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    'rls-test-user-b@example.com',
    crypt('rls-test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '', '', '', ''
  );

insert into auth.identities (
  provider_id, user_id, identity_data, provider, created_at, updated_at
) values
  (
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    '{"sub":"11111111-1111-1111-1111-111111111111","email":"rls-test-user-a@example.com"}',
    'email',
    now(),
    now()
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    '{"sub":"22222222-2222-2222-2222-222222222222","email":"rls-test-user-b@example.com"}',
    'email',
    now(),
    now()
  );
