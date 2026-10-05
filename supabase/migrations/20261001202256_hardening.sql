-- 0012_hardening.sql — close the gaps the Supabase security advisor reported
-- against 0001–0011. Idempotent.

-- twinos_approved_for() is SECURITY DEFINER and was callable by anon through
-- /rest/v1/rpc. Only the approval trigger and signed-in roles need it.
revoke execute on function public.twinos_approved_for(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.twinos_approved_for(uuid, uuid, text, timestamptz) to authenticated, service_role;

-- Pin search_path on every public function that does not set one itself, so a
-- caller cannot shadow the tables and functions they use. Bodies already
-- qualify what they touch as public.*; pg_catalog is always searched first.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and p.proconfig is null
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;
