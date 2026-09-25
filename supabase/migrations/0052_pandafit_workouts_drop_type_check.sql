-- O tipo de treino deixou de ser uma lista fixa (Musculação/Jiu
-- Jitsu/Corrida) e virou um catálogo por usuário (pandafit_workout_types,
-- ver migração anterior) — então essa constraint travaria qualquer
-- modalidade nova que alguém cadastre em Configurações.
alter table public.pandafit_workouts drop constraint pandafit_workouts_type_check;
