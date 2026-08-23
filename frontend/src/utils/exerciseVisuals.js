import { Activity, Hand, Footprints, ArrowUpDown, Dumbbell } from 'lucide-react-native';
import { palette } from '../constants/palette';

// Icon + tint per exercise, matched by name substring (recommendation/history
// rows only carry a display name, not the LSTM slug). Keeps the icon chips on
// the activity cards (Home) and recommendation cards (Sessions) consistent.
const VISUALS = [
  { test: /shoulder|flexion/i, icon: Activity, color: palette.sage, soft: palette.sageSoft },
  { test: /hand|mouth/i, icon: Hand, color: palette.coral, soft: palette.coralSoft },
  { test: /knee|extension/i, icon: Footprints, color: palette.amber, soft: palette.amberSoft },
  { test: /sit.?to.?stand|squat/i, icon: ArrowUpDown, color: palette.primary, soft: palette.primarySoft },
];

const DEFAULT_VISUAL = { icon: Dumbbell, color: palette.primary, soft: palette.primarySoft };

export const getExerciseVisual = (name) => {
  const match = VISUALS.find((v) => v.test.test(name || ''));
  return match || DEFAULT_VISUAL;
};
