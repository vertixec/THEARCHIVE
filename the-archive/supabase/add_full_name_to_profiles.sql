-- ============================================================
-- MIGRACIÓN: Agregar full_name a profiles + trigger de signup
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- 1. Agregar columna full_name a la tabla profiles (si no existe)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT;

-- 2. Constraint: status solo puede ser 'active' o 'inactive'
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('active', 'inactive'));

-- 3. Función que crea el perfil al crear un usuario en auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, status, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    'active',
    'member'
  )
  ON CONFLICT (id) DO UPDATE
    SET
      email     = EXCLUDED.email,
      full_name = EXCLUDED.full_name
    WHERE profiles.full_name IS NULL;

  RETURN NEW;
END;
$$;

-- 4. Trigger que dispara la función en cada nuevo usuario
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
