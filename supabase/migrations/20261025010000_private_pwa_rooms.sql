-- The FastAPI gateway verifies role-scoped, expiring capabilities before commands.
-- Direct browser reads/writes are forbidden. No service key is sent to the PWA.
create table public.pwa_rooms (
  id text primary key,
  sequence bigint not null default 0,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  payload jsonb not null
);
alter table public.pwa_rooms enable row level security;
revoke all on public.pwa_rooms from anon, authenticated;
grant all on public.pwa_rooms to service_role;
create index pwa_rooms_expiry on public.pwa_rooms(expires_at);

create function public.save_pwa_room(p_room jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if jsonb_typeof(p_room) <> 'object' or length(p_room->>'id') not between 16 and 100
     or jsonb_typeof(p_room->'capabilities') <> 'object' then
    raise exception 'Invalid room snapshot';
  end if;
  insert into public.pwa_rooms(id, sequence, expires_at, payload)
  values (p_room->>'id', (p_room->>'sequence')::bigint,
          to_timestamp((p_room->>'expires')::double precision), p_room)
  on conflict(id) do update set sequence=excluded.sequence, expires_at=excluded.expires_at,
    payload=excluded.payload, updated_at=now()
  where excluded.sequence >= pwa_rooms.sequence;
  delete from public.pwa_rooms where expires_at < now();
end;
$$;
revoke all on function public.save_pwa_room(jsonb) from public, anon, authenticated;
grant execute on function public.save_pwa_room(jsonb) to service_role;
