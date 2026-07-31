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
  // holdMsPerRep > 0 switches the counter into Functionality (tolerance)
  // mode: a rep only counts once the patient SUSTAINS the green band for
  // that long, instead of counting the instant they reach it. 0 (the
  // default) keeps the original Strength/plain-rep behavior.
  constructor(targetReps = 12, holdMsPerRep = 0) {
    this.targetReps = Math.max(1, Math.floor(Number(targetReps) || 12));
    this.holdMsPerRep = Math.max(0, Number(holdMsPerRep) || 0);
    this.repsCompleted = 0;
    this.state = STATE_INITIAL;
    // Cumulative green time toward the CURRENT rep (Functionality only).
    // Resets to 0 whenever the patient drops out of green before the hold
    // completes, so a rep requires one continuous hold, not scattered
    // green moments.
    this.currentHoldMs = 0;
  }

  // Updates the state machine with the active color for the current frame.
  // dtMs is the elapsed time since the previous frame — only used in
  // hold-per-rep (Functionality) mode; ignored otherwise.
  update(color, dtMs = 0) {
    if (this.repsCompleted >= this.targetReps) return this.snapshot();
    if (!color) return this.snapshot();

    const inGreen = color === COLOR_GREEN;
    const beyondYellow = color === COLOR_RED;

    if (this.holdMsPerRep > 0) {
      // ── Functionality: hold-per-rep ──────────────────────────────────
      if (this.state === STATE_INITIAL) {
        // Require the patient to start OUT of green so the first hold is a
        // deliberate move into position, not a pre-existing pose.
        if (!inGreen) this.state = STATE_WAITING_FOR_TOP;
      } else if (this.state === STATE_WAITING_FOR_TOP) {
        if (inGreen) {
          this.currentHoldMs += Math.max(0, dtMs);
          if (this.currentHoldMs >= this.holdMsPerRep) {
            this.repsCompleted += 1;
            this.currentHoldMs = 0;
            this.state = STATE_AT_TOP;
          }
        } else {
          // Dropped out of the band before completing the hold — the rep
          // must be re-earned with a fresh continuous hold.
          this.currentHoldMs = 0;
        }
      } else if (this.state === STATE_AT_TOP) {
        // Must leave the band before the next rep's hold can begin.
        if (beyondYellow) {
          this.state = STATE_WAITING_FOR_TOP;
          this.currentHoldMs = 0;
        }
      }
      return this.snapshot();
    }

    // ── Strength / plain reps: count on entering green ─────────────────
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
      // Functionality HUD: seconds held toward the current rep, and the
      // required hold. Both 0 in plain-rep mode.
      holdMsPerRep: this.holdMsPerRep,
      currentHoldMs: this.currentHoldMs,
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
// "mouth" matches hand_to_mouth (elbow-flexion arm exercise) — its display
// name "Hand to Mouth" and slug both lack any other arm keyword, so without
// this the skeleton overlay wouldn't color the affected arm for it.
export const isArmExercise = (name) =>
  /bicep|arm|reach|upper|curl|shoulder|elbow|wrist|mouth/i.test(name || '');

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
