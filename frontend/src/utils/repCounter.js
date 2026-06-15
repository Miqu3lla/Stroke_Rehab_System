// State machine for counting exercise repetitions based on color feedback.
//
// States:
//   initial: Wait for user to leave correct form (green) once before counting.
//   waiting_for_top: User is out of correct form; entering green counts a rep.
//   at_top: User is in correct form; must return to/beyond yellow before counting again.

export const COLOR_GREEN = '#4CAF50';
export const COLOR_YELLOW = '#FFC107';
export const COLOR_RED = '#F44336';

const STATE_INITIAL = 'initial';
const STATE_WAITING_FOR_TOP = 'waiting_for_top';
const STATE_AT_TOP = 'at_top';

export default class RepCounter {
  constructor(targetReps = 12) {
    this.targetReps = Math.max(1, Math.floor(Number(targetReps) || 12));
    this.repsCompleted = 0;
    this.state = STATE_INITIAL;
  }

  // Updates the state machine with the active color signal for the current frame.
  update(color) {
    if (this.repsCompleted >= this.targetReps) return this.snapshot();
    if (!color) return this.snapshot();

    const inGreen = color === COLOR_GREEN;
    const beyondYellow = color === COLOR_RED;

    if (this.state === STATE_INITIAL) {
      // Transition to waiting when user first leaves the correct form band
      if (!inGreen) this.state = STATE_WAITING_FOR_TOP;
    } else if (this.state === STATE_WAITING_FOR_TOP) {
      // Count a rep and move to top state when entering the green band
      if (inGreen) {
        this.repsCompleted += 1;
        this.state = STATE_AT_TOP;
      }
    } else if (this.state === STATE_AT_TOP) {
      // Hysteresis: user must move past yellow before counting the next rep
      if (beyondYellow) this.state = STATE_WAITING_FOR_TOP;
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      repsCompleted: this.repsCompleted,
      targetReps: this.targetReps,
      setComplete: this.repsCompleted >= this.targetReps,
      state: this.state,
    };
  }
}

// Returns a customized feedback hint during repetition exercises, overriding static cues.
export function repAwareHint(snapshot, activeColor, fallbackHint) {
  if (!snapshot) return fallbackHint;
  const { state, repsCompleted } = snapshot;
  if (state === 'at_top') {
    if (activeColor === COLOR_GREEN) {
      return `Rep ${repsCompleted}! Return to start position`;
    }
    if (activeColor === COLOR_YELLOW) {
      return 'Keep returning to start position';
    }
  }
  if (state === 'initial' && activeColor === COLOR_GREEN) {
    return 'Move to start position before your first rep';
  }
  return fallbackHint;
}

// Checks if the exercise name targets arms.
export const isArmExercise = (name) =>
  /bicep|arm|reach|upper|curl|shoulder|elbow|wrist/i.test(name || '');

// Checks if the exercise name targets legs.
export const isLegExercise = (name) =>
  /leg|knee|squat|walk|gait|ankle|lunge|step|hip|sit_to_stand/i.test(name || '');

// Returns the relevant band color (bicepCurl for arms, kneeFlexion for legs).
// Takes the worst color if multiple limbs are tracked to prevent rewarding poor form.
export function pickActiveColor(colors, exerciseHint) {
  if (!colors) return undefined;
  const hint = (exerciseHint || '').toLowerCase();
  const isArm = isArmExercise(hint);
  const isLeg = isLegExercise(hint);

  if (isArm && !isLeg) return colors.bicepCurl;
  if (isLeg && !isArm) return colors.kneeFlexion;

  // Unknown or both: use the worst color of the two
  const arm = colors.bicepCurl;
  const leg = colors.kneeFlexion;
  if (arm === COLOR_RED || leg === COLOR_RED) return COLOR_RED;
  if (arm === COLOR_YELLOW || leg === COLOR_YELLOW) return COLOR_YELLOW;
  return arm || leg;
}
