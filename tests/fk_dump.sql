-- Prints the foreign keys and the indexes of the public schema, for
-- tests/check_fk_indexes.py:
--
--   psql "$DATABASE_URL" -At -f tests/fk_dump.sql > fks.json
--
-- Deliberately raw: the decision (does this FK have a leading index?) belongs
-- in the Python, where it can be read, argued with and tested. Two keys:
--
--   fks      one entry per FK constraint: its table, its name, its columns in
--            the order the constraint declares them
--   indexes  one entry per index: its table, its columns in index order
--
-- An FK is covered only by an index whose FIRST column is the FK's FIRST
-- column — that is the column a cascade delete, a join and an `is null` sweep
-- all probe first. An index that merely contains the column later does not
-- help, and this dump keeps the order so the checker can tell.
select json_build_object(
  'fks', (select json_agg(json_build_object(
      't', c.conrelid::regclass::text,
      'name', c.conname,
      'cols', (
        select json_agg(a.attname order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      )))
    from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace),
  'indexes', (select json_agg(json_build_object(
      't', cl.relname,
      'cols', (
        select json_agg(a.attname order by k.ord)
          from unnest(i.indkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      )))
    from pg_index i
    join pg_class cl on cl.oid = i.indrelid
   where cl.relnamespace = 'public'::regnamespace)
)::text;
