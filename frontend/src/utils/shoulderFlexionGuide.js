import { COLOR_GREEN, COLOR_YELLOW, COLOR_RED } from './repCounter';

// Two-checkpoint guided rep machine for shoulder flexion.
//
// The movement the app coaches, per rep:
//   CP1 START — elbow BENT, hand up by the shoulder/face   → GREEN "now reach up"
//   CP2 TOP   — arm reached STRAIGHT up overhead            → GREEN, hold N s → rep++
//
// Between them the patient reaches up (extending the elbow + raising the arm);
// after each rep they return to the bent-elbow start. Driven by BOTH the raw
// shoulder angle (hip-shoulder-elbow = arm elevation) and the elbow angle
// (shoulder-elbow-wrist = extension), which the backend sends in result.angles
// — the shoulder angle alone can't tell a bent elbow from a straight one.

const PHASE_NEED_START = 'need_start'; // get into the bent-elbow start pose
const PHASE_READY = 'ready';           // bent elbow at the shoulder — START (green)
const PHASE_RAISING = 'raising';       // reaching up toward straight overhead
const PHASE_HOLDING = 'holding';       // straight overhead — TOP (green), holding

// Angle bands (degrees).
// ELBOW_START_MAX calibrated off 24 therapist-approved clips: start pose
// 22-47°, resting arm 105-148° — 80 sits in the gap. Separate from ELBOW_BENT_MAX, which also gates rep completion.
const ELBOW_START_MAX = 80;      // elbow below this = folded into the start pose
const ELBOW_BENT_MAX = 110;      // elbow below this = "bent" (top-of-rep checks)
const ELBOW_STRAIGHT_MIN = 150;  // elbow above this = "straight" (required at the top)
const SHOULDER_TOP_MIN = 140;    // upper arm overhead
const SHOULDER_YELLOW_MIN = 120; // "almost overhead" band
const SHOULDER_LEAVE_READY = 60; // arm has clearly begun to rise off the start

export default class ShoulderFlexionGuide {
  constructor(targetReps = 12, holdMsPerRep = 0) {
    this.targetReps = Math.max(1, Math.floor(Number(targetReps) || 12));
    // Per-rep hold at the top. 0 (plain-rep sets) = count on reaching the
    // straight-overhead position, matching the generic RepCounter — do NOT
    // force a hold on sets that didn't ask for one (a 6s×12 forced hold can
    // blow the set time cap). A positive value is clamped to a sane minimum.
    const hold = Number(holdMsPerRep);
    this.holdMs = Number.isFinite(hold) && hold > 0 ? Math.max(1000, hold) : 0;
    this.repsCompleted = 0;
    this.phase = PHASE_NEED_START;
    this.currentHoldMs = 0;
    this.shoulder = null;
    this.elbowBent = false;
    this.elbowStraight = false;
    this.overhead = false;
    this.justCompletedRep = false;
  }

  // shoulderAngle = hip-shoulder-elbow (elevation); elbowAngle =
  // shoulder-elbow-wrist (extension); dtMs = ms since the previous frame.
  // Either angle may be null when the arm isn't tracked.
  update(shoulderAngle, elbowAngle = null, dtMs = 0) {
    this.justCompletedRep = false;
    const sh = shoulderAngle === null || shoulderAngle === undefined || Number.isNaN(shoulderAngle)
      ? null : shoulderAngle;
    const el = elbowAngle === null || elbowAngle === undefined || Number.isNaN(elbowAngle)
      ? null : elbowAngle;
    // KNOWN-only: false when el is null. Entering the start pose requires a
    // known folded elbow; proceeding overhead stays lenient since the wrist can leave frame there.
    this.shoulder = sh;
    this.elbowAtStart = el !== null && el < ELBOW_START_MAX;
    this.elbowBent = el !== null && el < ELBOW_BENT_MAX;
    this.elbowStraight = el !== null && el >= ELBOW_STRAIGHT_MIN;
    this.overhead = sh !== null && sh >= SHOULDER_TOP_MIN;

    if (this.repsCompleted >= this.targetReps) return this.snapshot();
    if (sh === null) return this.snapshot(); // arm not tracked → hold state

    switch (this.phase) {
      case PHASE_NEED_START:
        // Requires BOTH elbow folded AND arm back down (not just "not
        // overhead") - otherwise a shallow dip after a rep could mint another.
        if (!this.overhead && this.elbowAtStart && sh < SHOULDER_LEAVE_READY) this.phase = PHASE_READY;
        break;
      case PHASE_READY:
        // Leave once the arm begins to rise, or the elbow is KNOWN straightened
        // — either way the patient is reaching up, not at the bent start.
        if (sh >= SHOULDER_LEAVE_READY || this.elbowStraight) this.phase = PHASE_RAISING;
        break;
      case PHASE_RAISING:
        if (this.overhead && !this.elbowBent) {
          if (this.holdMs === 0) {
            // No per-rep hold — count on reaching the top THIS frame, so a
            // one-frame overhead pose still registers (entering PHASE_HOLDING
            // would defer completion to the next result and drop the rep).
            this._completeRep();
          } else {
            this.phase = PHASE_HOLDING;
            this.currentHoldMs = 0;
          }
        } else if (this.elbowAtStart && sh < SHOULDER_LEAVE_READY) {
          this.phase = PHASE_READY; // lowered back into the bent-elbow start
        }
        break;
      case PHASE_HOLDING:
        if (this.overhead && !this.elbowBent) {
          this.currentHoldMs += Math.max(0, dtMs);
          if (this.currentHoldMs >= this.holdMs) {
            this._completeRep();
          }
        } else {
          // Left the straight-overhead position before the hold finished — the
          // rep must be re-earned with a fresh continuous hold.
          this.currentHoldMs = 0;
          this.phase = (this.elbowAtStart && sh < SHOULDER_LEAVE_READY)
            ? PHASE_READY : PHASE_RAISING;
        }
        break;
      default:
        this.phase = PHASE_NEED_START;
    }

    return this.snapshot();
  }

  // Count a completed rep and send the patient back to the bent-elbow start
  // for the next one. Shared by the hold-complete (PHASE_HOLDING) and the
  // no-hold count-on-reach (PHASE_RAISING) paths.
  _completeRep() {
    this.repsCompleted += 1;
    this.currentHoldMs = 0;
    this.justCompletedRep = true;
    this.phase = PHASE_NEED_START;
  }

  snapshot() {
    let color = COLOR_RED;
    let feedbackText = '';
    let hintKey = 'shoulder_flexion.red_low';

    if (this.justCompletedRep) {
      color = COLOR_GREEN;
      feedbackText = `Rep ${this.repsCompleted}! Bring your hand back down to your shoulder`;
      hintKey = 'shoulder_flexion.red_high';
    } else if (this.phase === PHASE_NEED_START) {
      feedbackText = 'Bend your elbow and bring your hand up to your shoulder to start';
      hintKey = 'shoulder_flexion.get_ready';
    } else if (this.phase === PHASE_READY) {
      color = COLOR_GREEN; // CP1 — bent elbow at the shoulder, the "first green"
      feedbackText = 'Good! Now reach your arm straight up overhead';
      hintKey = 'shoulder_flexion.start';
    } else if (this.phase === PHASE_RAISING) {
      if (this.overhead && this.elbowBent) {
        // Arm is up but the elbow is KNOWN bent — straighten to finish the
        // reach. (A null/unknown elbow at the top doesn't trigger this — it's
        // allowed through so a hidden wrist can't strand the rep.)
        color = COLOR_YELLOW;
        feedbackText = 'Straighten your elbow — reach all the way up';
        hintKey = 'shoulder_flexion.bend_elbow';
      } else if (this.shoulder !== null && this.shoulder >= SHOULDER_YELLOW_MIN) {
        color = COLOR_YELLOW;
        feedbackText = 'Almost there — reach a little higher';
        hintKey = 'shoulder_flexion.yellow_low';
      } else {
        color = COLOR_RED;
        feedbackText = 'Keep reaching — take your arm straight up overhead';
        hintKey = 'shoulder_flexion.red_low';
      }
    } else if (this.phase === PHASE_HOLDING) {
      color = COLOR_GREEN; // CP2 — straight arm overhead, the "second green"
      const targetS = Math.round(this.holdMs / 1000);
      if (targetS > 0) {
        const heldS = Math.floor(this.currentHoldMs / 1000);
        feedbackText = `Hold it — ${heldS}s of ${targetS}s`;
      } else {
        // No per-rep hold configured — the rep counts on reaching the top.
        feedbackText = 'Perfect! Arm straight up overhead';
      }
      hintKey = 'shoulder_flexion.correct';
    }

    return {
      repsCompleted: this.repsCompleted,
      targetReps: this.targetReps,
      setComplete: this.repsCompleted >= this.targetReps,
      state: this.phase,
      color,
      feedbackText,
      hintKey,
    };
  }
}
