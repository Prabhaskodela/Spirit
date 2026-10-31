-- SpiritHUB update 008: evaluate auth.uid() once per statement in row policies.
-- Existing access rules are preserved; this changes no user data.

do $$
declare
  p record;
  command_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where (
      (schemaname = 'public' and tablename like 'hub_%')
      or (schemaname = 'storage' and tablename = 'objects' and policyname like 'hub:%')
    )
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%auth.uid()%'
  loop
    command_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then
      command_sql := command_sql || format(' using (%s)', replace(p.qual, 'auth.uid()', '(SELECT auth.uid())'));
    end if;
    if p.with_check is not null then
      command_sql := command_sql || format(' with check (%s)', replace(p.with_check, 'auth.uid()', '(SELECT auth.uid())'));
    end if;
    execute command_sql;
  end loop;
end
$$;
