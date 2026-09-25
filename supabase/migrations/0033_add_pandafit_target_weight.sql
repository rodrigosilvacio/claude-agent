-- Meta de peso opcional (aba Meta). Nula = sem meta definida.
alter table public.pandafit_settings
  add column target_weight_kg numeric(5,2) check (target_weight_kg is null or (target_weight_kg > 0 and target_weight_kg < 500));
