-- Prints one JSON document describing the public schema, for
-- tests/check_schema_usage.py:  psql "$DATABASE_URL" -At -f tests/schema_dump.sql > schema.json
select json_build_object(
  'tables', (select json_object_agg(t, cols) from (
      select table_name as t, json_object_agg(column_name, true) as cols
        from information_schema.columns where table_schema = 'public' group by table_name) x),
  -- Columns Postgres fills itself: a generated column, or an identity. Writing
  -- one is error 428C9/42809 at runtime, which no type check can see.
  'generated', (select json_object_agg(t, cols) from (
      select table_name as t, json_agg(column_name) as cols
        from information_schema.columns
        where table_schema = 'public' and (is_generated = 'ALWAYS' or is_identity = 'YES')
        group by table_name) x),
  'fns', (select json_agg(proname) from pg_proc where pronamespace = 'public'::regnamespace),
  'unique', (select json_agg(json_build_object('t', c.relname, 'cols', (
        select json_agg(a.attname order by array_position(i.indkey::int2[], a.attnum))
          from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any (i.indkey))))
      from pg_index i join pg_class c on c.oid = i.indrelid
     where i.indisunique and i.indpred is null and c.relnamespace = 'public'::regnamespace)
)::text;
