-- 0016 — read the role where Supabase Auth puts it.
--
-- A login's JWT carries Jack's claim as app_metadata.twinos_role, not as a
-- top-level twinos_role (that shape only exists in the smoke tests and
-- service tokens). twinos_role() read only the top level, so every RLS policy
-- saw NULL for a real login and the dashboard could read nothing. The Edge
-- Functions were unaffected (_shared/auth.ts reads app_metadata and uses the
-- service client). app_metadata is writable only with the service role, never
-- by the user, so it is safe to trust here; user_metadata is not read.
--
-- A login with no claim still gets no role here (it reads nothing). Giving it
-- `dashboard`, as _shared/auth.ts does for the functions, is Jack's call.

create or replace function public.twinos_role()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.twinos_claims() ->> 'twinos_role',
    public.twinos_claims() -> 'app_metadata' ->> 'twinos_role',
    case when public.twinos_claims() ->> 'role' = 'service_role' then 'service_role' end
  );
$$;

create or replace function public.twinos_actor()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.twinos_role(),
    public.twinos_claims() ->> 'role',
    'system'
  );
$$;
