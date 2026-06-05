// Frontend rep counter — drop-in port of backend/services/pose_service.py
// RepCounter. Lives on the client so useCamera can advance the count
// inline with each WS pose result, without round-tripping a counter
// payload through the server.
//
// The WS already returns per-frame band colors keyed by the active
// joint (bicepCurl for arm exercises, kneeFlexion for leg exercises).
// Those colors encode exactly the band info we need — no raw angles
// have to leave the server:
//   '#4CAF50' (green)  = correct form band → rep counts here
//   '#FFC107' (yellow) = transition band   → hold current state
//   '#F44336' (red)    = beyond yellow     → reset to WAITING_FOR_TOP
//
// State machine (matches backend exactly):
//   INITIAL          → patient may have started in green; the first rep
//                      can't count until they leave green at least once.
//   WAITING_FOR_TOP  → patient is outside green; entering green = +1 rep.
//   AT_TOP           → patient is at correct form; must move BEYOND
//                      yellow before another rep can count (hysteresis).
//
// Hysteresis is what prevents a patient hovering at the green/yellow
// boundary from spam-counting reps every frame.

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

  // Advance the state machine by one frame's worth of color signal.
  // `color` is the active-joint color from the WS `colors` map
  // (e.g. result.colors.bicepCurl for arm exercises). Pass null/undefined
  // when the joint isn't visible / no signal — state is preserved.
  update(color) {
    if (this.repsCompleted >= this.targetReps) return this.snapshot();
    if (!color) return this.snapshot();

    const inGreen = color === COLOR_GREEN;
    const beyondYellow = color === COLOR_RED;

    if (this.state === STATE_INITIAL) {
      // Refuse the first rep until the patient has demonstrably left
      // correct form. Without this, a patient who starts in the green
      // band racks up an instant rep on frame one.
      if (!inGreen) this.state = STATE_WAITING_FOR_TOP;
    } else if (this.state === STATE_WAITING_FOR_TOP) {
      if (inGreen) {
        this.repsCompleted += 1;
        this.state = STATE_AT_TOP;
      }
    } else if (this.state === STATE_AT_TOP) {
      // Hysteresis: the patient must travel out of the yellow band
      // entirely before the next rep can count. Inside yellow we hold
      // AT_TOP so a slight wobble at the boundary doesn't trigger
      // another rep.
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

// Override the per-frame WS hint with rep-mode-aware wording when the
// pose-service hint would be misleading for a rep set. The backend
// hint functions were designed around the old continuous-scoring
// model — their green-zone string says "Hold your arm at shoulder
// height", which contradicts the rep paradigm where the patient needs
// to RETURN to start position to count the next rep.
//
// Rules:
//   AT_TOP + green band  → "Rep N! Return to start position" (rep just
//                          counted; tell them to come back down)
//   AT_TOP + yellow band → "Keep returning to start position" (mid-
//                          descent; ignore the "raise" ascent hint)
//   INITIAL + green band → "Lower to start position before your first
//                          rep" (patient began in correct form; the
//                          state machine refuses to count until they
//                          leave green first)
// All other state/band combinations fall through to the WS hint —
// "raise your arm" during ascent is the right cue.
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
    // Wording is intentionally limb-agnostic so it works for arm
    // exercises ("lower"), leg knee_extension ("bend back down"), and
    // sit_to_stand ("stand back up") without an exercise-specific
    // branch. Universal language for the rare "started already in
    // correct form" edge case.
    return 'Move to start position before your first rep';
  }
  return fallbackHint;
}

// Pick the relevant band color out of the WS `colors` map for rep
// counting. Arm exercises track the elbow angle (returned as
// `bicepCurl`); leg exercises track the knee angle (`kneeFlexion`).
// For cross-body fallback, take whichever band is worse so the rep
// counter doesn't reward bad form on the lagging limb.
export function pickActiveColor(colors, exerciseHint) {
  if (!colors) return undefined;
  const hint = (exerciseHint || '').toLowerCase();
  const isArm = /bicep|arm|reach|upper|curl|flex|shoulder/.test(hint);
  const isLeg = /leg|knee|squat|walk|gait|ankle|lunge|step/.test(hint);

  if (isArm && !isLeg) return colors.bicepCurl;
  if (isLeg && !isArm) return colors.kneeFlexion;

  // Mixed / unknown: take the worst band of whatever's set.
  const arm = colors.bicepCurl;
  const leg = colors.kneeFlexion;
  if (arm === COLOR_RED || leg === COLOR_RED) return COLOR_RED;
  if (arm === COLOR_YELLOW || leg === COLOR_YELLOW) return COLOR_YELLOW;
  return arm || leg;
}
