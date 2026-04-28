-- [MODIFICATION PAR LARABI]
-- 1. Ajout de la gestion des heures de travail
-- par défaut le docteur gère 08:00 à 17:00.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS working_hours_start time default '08:00',
ADD COLUMN IF NOT EXISTS working_hours_end time default '17:00';
