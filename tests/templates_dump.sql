-- JSON for tests/check_templates.ts:  psql "$DATABASE_URL" -At -f tests/templates_dump.sql > templates.json
select json_build_object(
  'templates', (select json_agg(json_build_object('key', key, 'body', body, 'fields_list', fields_list, 'required_lines', required_lines)) from public.templates),
  'brand_facts', (select json_agg(json_build_object('key', key, 'body', body)) from public.brand_facts)
)::text;
