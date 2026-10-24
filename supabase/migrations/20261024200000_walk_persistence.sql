-- JP foundation: service-only operational storage. The browser still uses /ws.
-- No anon/authenticated policies: location and incident data are private by default.
begin;

create table public.walk_sessions (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  mode text not null default 'demo' check (mode in ('demo', 'live')),
  generation integer not null default 0 check (generation >= 0),
  status text not null default 'preview'
    check (status in ('preview', 'walking', 'checkin', 'escalated', 'ended')),
  route_id text,
  thresholds jsonb not null default '{}'::jsonb,
  last_position jsonb,
  last_position_at timestamptz,
  last_sequence bigint not null default 0,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create table public.walk_events (
  event_id text primary key check (length(event_id) between 1 and 128),
  walk_id text not null references public.walk_sessions(id) on delete cascade,
  generation integer not null,
  sequence bigint not null,
  sender text not null check (sender in ('walker', 'guardian', 'shop', 'room', 'engine', 'gateway')),
  message_type text not null,
  client_at timestamptz not null,
  received_at timestamptz not null default now(),
  envelope jsonb not null check (jsonb_typeof(envelope) = 'object'),
  unique (walk_id, sequence)
);
create index walk_events_walk_generation on public.walk_events(walk_id, generation, sequence);
create index walk_sessions_expiry on public.walk_sessions(expires_at) where mode = 'demo';

create table public.place_catalog (
  id text primary key,
  name text not null,
  kind text not null,
  longitude double precision not null check (longitude between -180 and 180),
  latitude double precision not null check (latitude between -90 and 90),
  simulated boolean not null default true,
  source text not null,
  evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.walk_place_status (
  walk_id text not null references public.walk_sessions(id) on delete cascade,
  place_id text not null,
  open_until text not null,
  safe_haven boolean not null,
  front_light boolean,
  source text not null default 'demo_shop_command',
  updated_at timestamptz not null default now(),
  primary key (walk_id, place_id)
);

create table public.walk_incidents (
  id uuid primary key default gen_random_uuid(),
  walk_id text not null references public.walk_sessions(id) on delete cascade,
  generation integer not null,
  status text not null check (status in ('pending', 'alerted', 'acknowledged', 'resolved')),
  reason text not null,
  reply_deadline timestamptz,
  position jsonb,
  guardian_ack_by text,
  guardian_ack_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_open_incident_per_walk on public.walk_incidents(walk_id, generation)
  where status <> 'resolved';

create table public.report_drafts (
  id uuid primary key default gen_random_uuid(),
  walk_id text not null references public.walk_sessions(id) on delete cascade,
  generation integer not null,
  source_event_id text not null unique references public.walk_events(event_id) on delete cascade,
  kind text not null check (kind in ('walk_summary', '311')),
  status text not null default 'draft' check (status = 'draft'),
  body text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- One transaction serializes events per walk, assigns sequence numbers,
-- projects useful state, and preserves the existing PWA history wire format.
create function public.record_walk_event(p_envelope jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_walk text := p_envelope->>'walkId';
  v_id text := p_envelope->>'id';
  v_msg jsonb := p_envelope->'msg';
  v_type text := p_envelope->'msg'->>'type';
  v_row public.walk_sessions%rowtype;
  v_existing jsonb;
  v_history jsonb;
  v_generation integer;
  v_sequence bigint;
  v_client_at timestamptz;
begin
  if p_envelope is null or jsonb_typeof(p_envelope) <> 'object'
     or v_walk is null or v_walk !~ '^[A-Za-z0-9_-]{1,80}$'
     or v_id is null or length(v_id) not between 1 and 128
     or jsonb_typeof(v_msg) is distinct from 'object'
     or jsonb_typeof(p_envelope->'ts') is distinct from 'number'
     or coalesce(p_envelope->>'from', '') not in ('walker', 'guardian', 'shop', 'room', 'engine', 'gateway')
     or coalesce(v_type, '') not in (
       'walk.reset', 'walk.plan', 'walk.accept', 'walk.start', 'walk.position',
       'voice.say', 'checkin.ask', 'checkin.reply', 'escalate', 'guardian.alert',
       'guardian.join', 'guardian.ack', 'place.update', 'agent.log', 'walk.end',
       'audit.run', 'audit.result') then
    raise exception 'Invalid walk envelope' using errcode = '22023';
  end if;
  if v_type in ('walk.start', 'walk.position') and v_msg->'replay' is distinct from 'true'::jsonb then
    raise exception 'This demo persistence path does not accept live GPS' using errcode = '22023';
  end if;
  v_client_at := to_timestamp((p_envelope->>'ts')::double precision / 1000);
  insert into public.walk_sessions(id) values (v_walk) on conflict (id) do nothing;
  select * into v_row from public.walk_sessions where id = v_walk for update;

  select envelope into v_existing from public.walk_events where event_id = v_id;
  if found then
    if v_existing <> p_envelope then
      raise exception 'Event ID collision' using errcode = '22023';
    end if;
    return jsonb_build_object('inserted', false, 'sequence', v_row.last_sequence);
  end if;
  if v_row.status = 'ended' and v_type in ('walk.start', 'walk.position', 'checkin.ask', 'escalate', 'guardian.alert') then
    raise exception 'Walk ended; reset before starting another demo' using errcode = '22023';
  end if;

  v_generation := v_row.generation + case when v_type = 'walk.reset' then 1 else 0 end;
  v_sequence := v_row.last_sequence + 1;
  v_history := v_row.history;
  if v_type = 'walk.reset' then
    select coalesce(jsonb_agg(e order by n), '[]'::jsonb) into v_history
      from jsonb_array_elements(v_history) with ordinality as h(e, n)
      where e->'msg'->>'type' in ('place.update', 'guardian.join');
  elsif v_type = 'walk.start' then
    select coalesce(jsonb_agg(e order by n), '[]'::jsonb) into v_history
      from jsonb_array_elements(v_history) with ordinality as h(e, n)
      where e->'msg'->>'type' in ('agent.log', 'walk.plan', 'walk.accept', 'place.update', 'guardian.join');
  elsif v_type = 'walk.position' then
    select coalesce(jsonb_agg(e order by n), '[]'::jsonb) into v_history
      from jsonb_array_elements(v_history) with ordinality as h(e, n)
      where e->'msg'->>'type' <> 'walk.position';
  elsif v_type = 'walk.end' then
    -- Ended walks never restore a location or alert packet to a late joiner.
    select coalesce(jsonb_agg(e order by n), '[]'::jsonb) into v_history
      from jsonb_array_elements(v_history) with ordinality as h(e, n)
      where e->'msg'->>'type' not in ('walk.position', 'guardian.alert', 'escalate', 'checkin.ask');
  end if;
  v_history := v_history || jsonb_build_array(p_envelope);
  select coalesce(jsonb_agg(e order by n), '[]'::jsonb) into v_history
    from jsonb_array_elements(v_history) with ordinality as h(e, n)
    where n > jsonb_array_length(v_history) - 400;

  insert into public.walk_events(event_id, walk_id, generation, sequence, sender, message_type, client_at, envelope)
    values (v_id, v_walk, v_generation, v_sequence, p_envelope->>'from', v_type, v_client_at, p_envelope);

  update public.walk_sessions set
    generation = v_generation, last_sequence = v_sequence, history = v_history, updated_at = now(),
    expires_at = case when v_type = 'walk.reset' then now() + interval '24 hours' else expires_at end,
    status = case v_type when 'walk.reset' then 'preview' when 'walk.start' then 'walking'
      when 'checkin.ask' then 'checkin' when 'escalate' then 'escalated'
      when 'guardian.alert' then 'escalated' when 'walk.end' then 'ended'
      when 'checkin.reply' then case when v_msg->>'reply' = 'fine' and status in ('checkin', 'escalated') then 'walking' else status end
      else status end,
    route_id = case when v_type = 'walk.plan' then v_msg->'plan'->>'routeId' else route_id end,
    thresholds = case when v_type = 'walk.plan' then v_msg->'plan'->'thresholds' else thresholds end,
    last_position = case when v_type in ('walk.reset', 'walk.end') then null
      when v_type = 'walk.position' then v_msg else last_position end,
    last_position_at = case when v_type in ('walk.reset', 'walk.end') then null
      when v_type = 'walk.position' then v_client_at else last_position_at end,
    started_at = case when v_type = 'walk.reset' then null when v_type = 'walk.start' then v_client_at else started_at end,
    ended_at = case when v_type = 'walk.end' then v_client_at when v_type = 'walk.reset' then null else ended_at end
    where id = v_walk;

  if v_type = 'place.update' then
    insert into public.walk_place_status(walk_id, place_id, open_until, safe_haven, front_light)
      values (v_walk, v_msg->'place'->>'id', v_msg->'place'->>'openUntil',
        (v_msg->'place'->>'safeHaven')::boolean, (v_msg->'place'->>'frontLight')::boolean)
      on conflict (walk_id, place_id) do update set open_until = excluded.open_until,
        safe_haven = excluded.safe_haven, front_light = excluded.front_light, updated_at = now();
  elsif v_type = 'checkin.ask' then
    insert into public.walk_incidents(walk_id, generation, status, reason, reply_deadline, position)
      values (v_walk, v_generation, 'pending', v_msg->>'reason',
        to_timestamp((v_msg->>'deadline')::double precision / 1000), v_row.last_position)
      on conflict (walk_id, generation) where status <> 'resolved' do nothing;
  elsif v_type = 'guardian.alert' then
    insert into public.walk_incidents(walk_id, generation, status, reason, position)
      values (v_walk, v_generation, 'alerted', v_msg->>'reason', v_msg->'lngLat')
      on conflict (walk_id, generation) where status <> 'resolved' do update
        set status = 'alerted', reason = excluded.reason, position = excluded.position;
  elsif v_type = 'guardian.ack' then
    update public.walk_incidents set status = 'acknowledged', guardian_ack_by = v_msg->>'by', guardian_ack_at = now()
      where walk_id = v_walk and generation = v_generation and status in ('alerted', 'acknowledged');
  elsif v_type = 'checkin.reply' and v_msg->>'reply' = 'fine' then
    update public.walk_incidents set status = 'resolved', resolved_at = now()
      where walk_id = v_walk and generation = v_generation and status <> 'resolved';
  elsif v_type in ('walk.end', 'audit.result') then
    insert into public.report_drafts(walk_id, generation, source_event_id, kind, body, evidence)
      values (v_walk, v_generation, v_id,
        case when v_type = 'audit.result' then '311' else 'walk_summary' end,
        coalesce(v_msg->>'draft311', v_msg->>'summary'),
        jsonb_build_object('mode', 'demo', 'source', 'demo_envelope', 'message', v_msg));
  end if;
  return jsonb_build_object('inserted', true, 'sequence', v_sequence, 'generation', v_generation);
end;
$$;

create function public.purge_expired_demo_walks()
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare v_count integer;
begin
  delete from public.walk_sessions where mode = 'demo' and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.walk_sessions enable row level security;
alter table public.walk_events enable row level security;
alter table public.place_catalog enable row level security;
alter table public.walk_place_status enable row level security;
alter table public.walk_incidents enable row level security;
alter table public.report_drafts enable row level security;

revoke all on public.walk_sessions, public.walk_events, public.place_catalog,
  public.walk_place_status, public.walk_incidents, public.report_drafts from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.walk_sessions, public.walk_events, public.place_catalog,
  public.walk_place_status, public.walk_incidents, public.report_drafts to service_role;
revoke all on function public.record_walk_event(jsonb) from public, anon, authenticated;
revoke all on function public.purge_expired_demo_walks() from public, anon, authenticated;
grant execute on function public.record_walk_event(jsonb), public.purge_expired_demo_walks() to service_role;

comment on table public.walk_sessions is 'JP prototype operational state. Browser access denied; use an authenticated gateway before live walks.';
comment on table public.report_drafts is 'Drafts only. No city submission or emergency call is performed.';
commit;
