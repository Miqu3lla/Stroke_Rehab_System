-- Create patients table
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stroke_type TEXT NOT NULL CHECK (stroke_type = 'ischemic'),
  months_in_recovery INTEGER NOT NULL,
  affected_area TEXT NOT NULL CHECK (affected_area IN ('arms', 'legs', 'both')),
  affected_side TEXT NOT NULL CHECK (affected_side IN ('left', 'right', 'both')),
  source_app TEXT DEFAULT 'frontend',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create recommendation_logs table  
CREATE TABLE IF NOT EXISTS recommendation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  stroke_type TEXT NOT NULL,
  months_in_recovery INTEGER NOT NULL,
  latest_form_score FLOAT NOT NULL,
  affected_area TEXT NOT NULL,
  affected_side TEXT NOT NULL,
  recommendation JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create form_predictions table
CREATE TABLE IF NOT EXISTS form_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  exercise_type TEXT NOT NULL,
  label TEXT,
  confidence FLOAT,
  frame_count INTEGER,
  device TEXT,
  prediction JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create video_predictions table
CREATE TABLE IF NOT EXISTS video_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  exercise_type TEXT NOT NULL,
  num_frames INTEGER,
  fps FLOAT,
  width INTEGER,
  height INTEGER,
  prediction JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create exercises table
CREATE TABLE IF NOT EXISTS exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_type TEXT NOT NULL UNIQUE,
  body_area TEXT NOT NULL,
  description TEXT,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_patients_created_at ON patients(created_at DESC);
CREATE INDEX idx_patients_name ON patients(name);
CREATE INDEX idx_recommendation_logs_patient_id ON recommendation_logs(patient_id);
CREATE INDEX idx_recommendation_logs_created_at ON recommendation_logs(created_at DESC);
CREATE INDEX idx_form_predictions_patient_id ON form_predictions(patient_id);
CREATE INDEX idx_video_predictions_patient_id ON video_predictions(patient_id);

-- Create trigger function for updated_at.
-- pg_catalog comes first in search_path so an attacker who can create
-- objects in public can't shadow NOW()/timestamp resolution. We also
-- use CURRENT_TIMESTAMP (a reserved keyword, not subject to
-- search_path at all) as a second layer of defense.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Create triggers for updated_at
CREATE TRIGGER trg_patients_updated_at
BEFORE UPDATE ON patients
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_recommendation_logs_updated_at
BEFORE UPDATE ON recommendation_logs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_form_predictions_updated_at
BEFORE UPDATE ON form_predictions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_video_predictions_updated_at
BEFORE UPDATE ON video_predictions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Insert sample exercises
INSERT INTO exercises (exercise_type, body_area, display_name) VALUES
  ('arm_circle', 'upper_limb', 'Arm Circles'),
  ('finger_flex', 'upper_limb', 'Finger Flexion'),
  ('wrist_rotation', 'upper_limb', 'Wrist Rotation'),
  ('walking', 'lower_limb', 'Walking'),
  ('leg_lift', 'lower_limb', 'Leg Lift'),
  ('balance_walk', 'lower_limb', 'Balance Walk')
ON CONFLICT DO NOTHING;

-- Enable RLS (if needed)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

-- Create policies for service role (unrestricted access)
CREATE POLICY "Service role unrestricted access" ON patients
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role unrestricted access" ON recommendation_logs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role unrestricted access" ON form_predictions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role unrestricted access" ON video_predictions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role unrestricted access" ON exercises
  FOR ALL USING (true) WITH CHECK (true);
