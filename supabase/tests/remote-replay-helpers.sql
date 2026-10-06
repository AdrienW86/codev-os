create temporary table remote_replay(passed bigint not null);
insert into remote_replay values(0);
create temporary table remote_observations(label text primary key,result text not null);
grant select,update on remote_replay to anon,authenticated,service_role;
create function pg_temp.replay_assert(condition boolean,label text) returns void language plpgsql as $$
begin
 if condition is distinct from true then raise exception 'Remote replay assertion failed: %',label; end if;
 update pg_temp.remote_replay set passed=passed+1;
end $$;
create function pg_temp.replay_failure(statement text,expected_state text,label text) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
 begin execute statement;
 exception when others then
  rejected:=true;
  if sqlstate<>expected_state then raise exception 'Replay %: expected %, got %: %',label,expected_state,sqlstate,sqlerrm; end if;
 end;
 perform pg_temp.replay_assert(rejected,label);
end $$;
-- Successful destructive operations are always undone in a subtransaction.
create function pg_temp.replay_success_rollback(statement text,check_statement text,label text) returns void language plpgsql as $$
declare valid boolean;
begin
 begin
  execute statement;
  execute check_statement into valid;
  if valid is distinct from true then raise exception 'Replay destructive postcondition failed: %',label; end if;
  raise exception 'Undo successful destructive test' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 perform pg_temp.replay_assert(true,label);
end $$;
-- Capture interactions whose ordering depends on the preexisting FK triggers.
-- Every outcome is undone; specific expected outcomes are asserted separately.
create function pg_temp.replay_observe(statement text,label text) returns void language plpgsql as $$
declare outcome text:='success';
begin
 begin
  execute statement;
  raise exception 'Undo successful observation' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 when others then outcome:=sqlstate;
 end;
 insert into pg_temp.remote_observations values(label,outcome);
end $$;
do $$ begin
 execute format('grant usage on schema %I to anon,authenticated,service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));
 execute format('grant execute on all functions in schema %I to anon,authenticated,service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));
end $$;
