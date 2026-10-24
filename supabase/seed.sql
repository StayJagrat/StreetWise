-- Public demo fixture locations only. Hours/haven/light assertions are unverified.
-- Even the teammate-operated cafe role is not a verified real business.
insert into public.place_catalog(id, name, kind, longitude, latitude, simulated, source, evidence)
values
  ('cafe-mia', 'Café Mia', 'cafe', -122.40322, 37.78541, true, 'demo-route.json', '{"fixture":true,"operator":"teammate demo role"}'),
  ('corner-market', 'Corner market', 'market', -122.40448, 37.78465, true, 'demo-route.json', '{"fixture":true}'),
  ('pharmacy-4th', 'Pharmacy', 'pharmacy', -122.40346, 37.78394, true, 'demo-route.json', '{"fixture":true}'),
  ('hotel-lobby', 'Hotel lobby', 'hotel', -122.40118, 37.78806, true, 'demo-route.json', '{"fixture":true}')
on conflict (id) do nothing;
