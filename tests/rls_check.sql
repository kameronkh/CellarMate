-- CellarMate tenant isolation check. Read-only: every change is rolled back by the final RAISE.
-- Pretends an existing test profile belongs to another winery, then counts what it can see
-- and tries to write into Tystrya. Expected: visible_tables lists only that winery's own rows
-- (plus its facility and bond), writes_into_tystrya=0, storage write to Tystrya denied.
-- Change :test_profile and :other_org below before running.
do $$
declare r text := ''; t record; n int; w int := 0;
  test_profile uuid := '82fbc968-6f87-4195-854d-cd2aad6cc4bf';   -- CellarMate Admin test login
  other_org uuid := '66356b99-3132-4f14-8358-9d328d131a78';      -- Out of Necessity
  tystrya uuid := '762fc809-0341-4ee2-834f-16e707181ea7';
begin
  update cellarmate.profiles set org_id = other_org, role_key = 'owner' where id = test_profile;
  perform set_config('request.jwt.claims', json_build_object('sub', test_profile, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'cellarmate' and c.relkind = 'r' order by 1 loop
    begin execute format('select count(*) from cellarmate.%I', t.relname) into n; if n > 0 then r := r || t.relname || '=' || n || ' '; end if;
    exception when others then null; end;
  end loop;
  begin insert into cellarmate.vineyards (organization_id, name) values (tystrya, 'RLS TEST'); w := w + 1; exception when others then null; end;
  begin update cellarmate.barrels set notes = notes where organization_id = tystrya; get diagnostics n = row_count; w := w + n; exception when others then null; end;
  begin perform cellarmate.place_barrel(tystrya, 2026, 'RLS1', 'A', 1, 'A', 'L', '1'); w := w + 1; exception when others then null; end;
  begin insert into storage.objects (bucket_id, name, owner) values ('cellar-files', tystrya || '/rls.txt', auth.uid()); r := r || ' storage_write_tystrya=ALLOWED'; exception when others then r := r || ' storage_write_tystrya=denied'; end;
  raise exception 'RESULT writes_into_tystrya=% visible=%', w, r;
end $$;
