import math
from typing import Any, Dict, List, Optional

# MediaPipe BlazePose landmark indices used by realtime form scoring.
_NOSE, _MOUTH_LEFT, _MOUTH_RIGHT = 0, 9, 10
_LEFT_SHOULDER, _LEFT_ELBOW, _LEFT_WRIST, _LEFT_HIP, _LEFT_KNEE, _LEFT_ANKLE = 11, 13, 15, 23, 25, 27
_RIGHT_SHOULDER, _RIGHT_ELBOW, _RIGHT_WRIST, _RIGHT_HIP, _RIGHT_KNEE, _RIGHT_ANKLE = 12, 14, 16, 24, 26, 28


def angle_at_vertex(a: Dict[str, float], b: Dict[str, float], c: Dict[str, float]) -> Optional[float]:
    v1x, v1y = a["x"] - b["x"], a["y"] - b["y"]
    v2x, v2y = c["x"] - b["x"], c["y"] - b["y"]
    m1 = math.hypot(v1x, v1y)
    m2 = math.hypot(v2x, v2y)
    if m1 == 0 or m2 == 0:
        return None
    dot = max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / (m1 * m2)))
    return round(math.degrees(math.acos(dot)))


def color_and_score(angle: Optional[float], target: float, green: float, yellow: float) -> Dict[str, Any]:
    if angle is None:
        return {"color": "#888888", "score": 0}
    diff = abs(angle - target)
    if diff <= green:
        return {"color": "#4CAF50", "score": max(90, round(100 - (diff / green) * 5))}
    if diff <= yellow:
        return {"color": "#FFC107", "score": max(50, round(70 - ((diff - green) / (yellow - green)) * 20))}
    # Red zone: no floor and a steeper penalty so an idle pose (arm fully
    # down, leg fully straight = diff ≥ 60-90) scores near 0 instead of
    # staying at the old 20-point floor.
    return {"color": "#F44336", "score": max(0, round(50 - (diff - yellow) * 1.0))}


def joint_triple(keypoints: List[Dict[str, float]], i1: int, i2: int, i3: int, min_conf: float = 0.3):
    if len(keypoints) <= max(i1, i2, i3):
        return None
    a, b, c = keypoints[i1], keypoints[i2], keypoints[i3]
    if min(a.get("score", 0), b.get("score", 0), c.get("score", 0)) < min_conf:
        return None
    return a, b, c


# ── Single source of truth for spoken/displayed hint text ──────────────────
# Every hint line, keyed by a STABLE hint_key. The hint functions below return
# these keys (never raw prose); score_pose resolves the key to text via
# HINT_TEXT for display and passes the key through to the client for audio.
# The offline voice generator (scripts/generate_voice.py) imports this table so
# voice_script.json and the audio filenames are derived from it and cannot
# drift from the app. Keys are structural: <group>.<state> where, for the
# symmetric-band exercises, "high"/"low" mean the measured angle is above/below
# target (diff > 0 / diff < 0) — the prose carries the exercise-specific words.
HINT_TEXT: Dict[str, str] = {
    # Visibility gates
    "gate.upper_body": "Show your upper body — shoulders, elbows, and hands need to be in the camera",
    "gate.lower_body": "Step back so your hips, knees, and feet are visible",
    "gate.whole_body": "Move back so your whole body is in the camera",
    # Arm raise (seated bicep curl) — elbow angle, target 55°
    "arm_raise.not_visible": "Step back — your shoulder, elbow, and hand need to be visible",
    "arm_raise.correct": "Great form! Hold your hand up by your shoulder",
    "arm_raise.yellow_high": "Almost there — curl your hand up a little more",
    "arm_raise.yellow_low": "Ease your hand down slightly",
    "arm_raise.red_high": "Curl your hand up toward your shoulder",
    "arm_raise.red_low": "Lower your hand back down",
    # Shoulder flexion — two-checkpoint guide: CP1 elbow bent, hand at the
    # shoulder → CP2 reach the arm straight up overhead → hold. Cues below are
    # driven by the frontend guide (utils/shoulderFlexionGuide) which reads both
    # the shoulder angle (elevation) and the elbow angle (extension).
    "shoulder_flexion.not_visible": "Step back — your hip, shoulder, and elbow need to be visible",
    "shoulder_flexion.get_ready": "Bend your elbow and bring your hand up to your shoulder to start",
    "shoulder_flexion.start": "Good! Now reach your arm straight up overhead",
    "shoulder_flexion.bend_elbow": "Straighten your elbow — reach all the way up",
    "shoulder_flexion.correct": "Perfect! Hold your arm straight up overhead",
    "shoulder_flexion.yellow_high": "Ease your arm down a little",
    "shoulder_flexion.yellow_low": "Almost there — reach a little higher",
    "shoulder_flexion.red_high": "Bring your hand back down to your shoulder",
    "shoulder_flexion.red_low": "Keep reaching — take your arm straight up overhead",
    # Hand to mouth — elbow angle, target 40°
    "hand_to_mouth.not_visible": "Step back — your shoulder, elbow, and hand need to be visible",
    "hand_to_mouth.correct": "Great form! Hold your hand up at your mouth",
    "hand_to_mouth.yellow_high": "Almost there — bring your hand up closer to your mouth",
    "hand_to_mouth.yellow_low": "Ease your hand down slightly",
    "hand_to_mouth.red_high": "Bring your hand up toward your mouth",
    "hand_to_mouth.red_low": "Lower your hand back down",
    # Spatial gate: elbow is bent but the hand isn't actually at the mouth
    # (e.g. raised in the air / off to the side).
    "hand_to_mouth.off_target": "Bring your hand to your mouth",
    # Sit to stand (also the generic leg + cross-body leg fallback) — knee angle, target 90°
    "sit_to_stand.not_visible": "Step back — your hip, knee, and ankle need to be visible",
    "sit_to_stand.correct": "Great form! Hold this position",
    "sit_to_stand.yellow_high": "Almost there — bend your knee a little more",
    "sit_to_stand.yellow_low": "Almost there — straighten your leg a little",
    "sit_to_stand.red_high": "Bend your knee further — try sitting lower",
    "sit_to_stand.red_low": "Stand tall and straighten your leg fully",
    # Knee extension — knee angle, threshold-based (not symmetric bands)
    "knee_extension.not_visible": "Sit down — your hip, knee, and ankle need to be visible",
    "knee_extension.correct": "Great form! Hold your leg out straight",
    "knee_extension.almost": "Almost there — straighten your knee a little more",
    "knee_extension.partial": "Lift your foot up — extend your leg out straight",
    "knee_extension.start": "Sit upright, then lift your foot and straighten your knee out in front of you",
    # Cross-body fallback
    "fallback.show_full_body": "Step back — show your full body",
}


def hint_text(key: Optional[str]) -> Optional[str]:
    """Resolve a hint_key to its display text (None-safe)."""
    return HINT_TEXT.get(key) if key else None


def arm_raise_hint(angle: Optional[float]) -> str:
    """hint_key for arm_raise (seated bicep curl) — ELBOW angle
    (shoulder-elbow-wrist), target 55°, bands green=25/yellow=45."""
    if angle is None:
        return "arm_raise.not_visible"
    diff = angle - 55
    abs_diff = abs(diff)
    if abs_diff <= 25:
        return "arm_raise.correct"
    if abs_diff <= 45:
        return "arm_raise.yellow_high" if diff > 0 else "arm_raise.yellow_low"
    return "arm_raise.red_high" if diff > 0 else "arm_raise.red_low"


def shoulder_flexion_hint(angle: Optional[float]) -> str:
    """hint_key for shoulder_flexion — SHOULDER angle (hip-shoulder-elbow),
    target 160° = arm raised forward and up OVERHEAD, elbow kept straight.
    Drives a step-by-step guide: arm down at the side (< 40°) is the START
    position, then the patient raises up overhead and holds at the top."""
    if angle is None:
        return "shoulder_flexion.not_visible"
    # Arm hanging at the side = the ready/start position for a rep. Cue the
    # raise from here rather than scolding it as "too low".
    if angle < 40:
        return "shoulder_flexion.start"
    diff = angle - 160
    abs_diff = abs(diff)
    if abs_diff <= 20:
        return "shoulder_flexion.correct"
    if abs_diff <= 40:
        return "shoulder_flexion.yellow_high" if diff > 0 else "shoulder_flexion.yellow_low"
    return "shoulder_flexion.red_high" if diff > 0 else "shoulder_flexion.red_low"


def hand_to_mouth_hint(angle: Optional[float]) -> str:
    """hint_key for hand_to_mouth — ELBOW angle (shoulder-elbow-wrist),
    target 40° = hand brought up to the mouth (deep flexion),
    bands green=20/yellow=40."""
    if angle is None:
        return "hand_to_mouth.not_visible"
    diff = angle - 40
    abs_diff = abs(diff)
    if abs_diff <= 20:
        return "hand_to_mouth.correct"
    if abs_diff <= 40:
        return "hand_to_mouth.yellow_high" if diff > 0 else "hand_to_mouth.yellow_low"
    return "hand_to_mouth.red_high" if diff > 0 else "hand_to_mouth.red_low"


# Backwards-compat alias used by the cross-body ("both") branch where we
# don't know the specific exercise — defaults to arm-raise interpretation.
arm_hint = arm_raise_hint


def leg_hint(angle: Optional[float]) -> str:
    """hint_key for sit_to_stand and the cross-body leg fallback —
    KNEE angle, target 90° = seated squat depth where the knee is bent."""
    if angle is None:
        return "sit_to_stand.not_visible"
    diff = angle - 90
    abs_diff = abs(diff)
    if abs_diff <= 15:
        return "sit_to_stand.correct"
    if abs_diff <= 30:
        return "sit_to_stand.yellow_high" if diff > 0 else "sit_to_stand.yellow_low"
    return "sit_to_stand.red_high" if diff > 0 else "sit_to_stand.red_low"


def knee_extension_hint(angle: Optional[float]) -> str:
    """hint_key for knee_extension — KNEE angle (hip-knee-ankle). Patient sits
    and lifts the foot to extend the affected leg straight out. Target ~170° =
    fully extended; seated start ~90°, so we cue OPENING the knee."""
    if angle is None:
        return "knee_extension.not_visible"
    if angle >= 160:
        return "knee_extension.correct"
    if angle >= 130:
        return "knee_extension.almost"
    if angle >= 100:
        return "knee_extension.partial"
    return "knee_extension.start"


def overall_visibility_score(keypoints: List[Dict[str, float]]) -> int:
    if not keypoints:
        return 0
    confidences = [kp.get("score", 0) for kp in keypoints]
    avg = sum(confidences) / len(confidences)
    return round(max(0, min(100, avg * 100)))


# Landmark subsets used by the body-area-aware visibility gate. Asking a
# patient doing shoulder flexion to "show your whole body" is wrong when
# their legs are under a chair — for arm exercises only the upper body
# needs to be in frame, and vice versa for legs.
_ARM_GATE_LANDMARKS = (0, 11, 12, 13, 14, 15, 16)            # nose + shoulders + elbows + wrists
_LEG_GATE_LANDMARKS = (11, 12, 23, 24, 25, 26, 27, 28)       # shoulders (trunk anchor) + hips + knees + ankles


def partial_visibility_score(keypoints: List[Dict[str, float]], indices) -> int:
    """Average MediaPipe confidence over a subset of landmark indices."""
    if not keypoints:
        return 0
    confidences = [keypoints[i].get("score", 0) for i in indices if i < len(keypoints)]
    if not confidences:
        return 0
    avg = sum(confidences) / len(confidences)
    return round(max(0, min(100, avg * 100)))


# ── Hand-to-mouth spatial gate ─────────────────────────────────────────────
# The elbow angle alone can't tell a real hand-to-mouth (hand folded up to the
# face) from a raised, bent-elbow "wave" — both flex the elbow, so a wave scored
# ~96%. So we ALSO require the wrist to actually be in the mouth zone: close to
# the mouth AND below the nose. Thresholds come from the recorded Correct clips
# (scripts h2m diagnostic): at peak flexion the wrist sits 0.22-0.58 shoulder-
# widths from the mouth and always ≥0.31 shoulder-width BELOW the nose, whereas a
# wave puts the wrist above the nose. Margins added for live-tracking noise and
# body-proportion variation.
_H2M_WRIST_MOUTH_MAX_RATIO = 0.75   # correct clips peak at 0.58
_H2M_WRIST_MIN_BELOW_NOSE = 0.10    # correct clips ≥0.31 below nose; a wave is above it
_H2M_OFF_TARGET_SCORE = 10          # firmly red when the hand isn't at the mouth


def hand_in_mouth_zone(keypoints: List[Dict[str, float]], sides) -> Optional[bool]:
    """Whether a tracked-side wrist is in the mouth zone (near the mouth AND
    below the nose).

    Returns True if any tracked side qualifies, False if it's determinable and
    none do, and None if the face/shoulder landmarks aren't confident enough to
    judge — in which case the caller SKIPS the gate rather than false-reject
    (e.g. the hand-at-mouth itself can occlude the face). `sides` are the
    mirrored-frame side letters ("L"/"R") used throughout this module."""
    if len(keypoints) <= max(_MOUTH_RIGHT, _RIGHT_WRIST):
        return None
    nose = keypoints[_NOSE]
    ml, mr = keypoints[_MOUTH_LEFT], keypoints[_MOUTH_RIGHT]
    ls, rs = keypoints[_LEFT_SHOULDER], keypoints[_RIGHT_SHOULDER]
    # Need a confident nose, mouth, and shoulders to place the zone and set its
    # scale. The mouth center comes straight from ml/mr, so if those landmarks
    # aren't reliable (head turned, poor light, or the hand-at-mouth occluding
    # them) a mis-placed center could wrongly read "far from mouth" and cap a
    # valid score — so return None to SKIP the gate instead of false-rejecting.
    if (nose.get("score", 0) < 0.5
            or min(ml.get("score", 0), mr.get("score", 0)) < 0.5
            or min(ls.get("score", 0), rs.get("score", 0)) < 0.3):
        return None
    shoulder_w = math.hypot(ls["x"] - rs["x"], ls["y"] - rs["y"])
    if shoulder_w < 1e-3:
        return None
    mouth_x = (ml["x"] + mr["x"]) / 2.0
    mouth_y = (ml["y"] + mr["y"]) / 2.0
    determinable = False
    for s in sides:
        wr = keypoints[_LEFT_WRIST] if s == "L" else keypoints[_RIGHT_WRIST]
        if wr.get("score", 0) < 0.3:
            continue
        determinable = True
        ratio = math.hypot(wr["x"] - mouth_x, wr["y"] - mouth_y) / shoulder_w
        below_nose = (nose["y"] - wr["y"]) / shoulder_w   # < 0 ⇒ wrist below nose
        if ratio <= _H2M_WRIST_MOUTH_MAX_RATIO and below_nose <= -_H2M_WRIST_MIN_BELOW_NOSE:
            return True
    return False if determinable else None


def score_pose(keypoints: List[Dict[str, float]], exercise_type: str, affected_side: str) -> Dict[str, Any]:
    """Core scoring logic: given keypoints + exercise context, return angles, colors, score, hint."""
    hint_lower = (exercise_type or "").lower()
    is_arm = any(kw in hint_lower for kw in (
        "upper-limb", "upper limb", "bicep", "arm", "reach", "fine motor",
    )) and "lower" not in hint_lower
    is_leg = any(kw in hint_lower for kw in (
        "lower-limb", "lower limb", "leg", "knee", "ankle", "gait", "squat", "walk", "balance",
    ))
    # Distinguish shoulder_flexion from arm_raise — same body area, but the
    # joint being measured (and the cues a stroke patient should follow)
    # are different. Shoulder flexion = raising the whole arm at the
    # shoulder; arm raise = bending the elbow toward the shoulder.
    is_shoulder_flexion = "shoulder_flexion" in hint_lower or "shoulder flexion" in hint_lower
    # hand_to_mouth: bring the hand up to the mouth. Same body area as the
    # other arm exercises but scored on the elbow with a deeper target than
    # shoulder flexion (which scores the shoulder joint).
    is_hand_to_mouth = "hand_to_mouth" in hint_lower or "hand to mouth" in hint_lower
    # Distinguish knee_extension from sit_to_stand — same body area, but
    # target angles point in opposite directions. Seated knee extension
    # = lift the foot to OPEN the knee (target ~170°); sit_to_stand =
    # bend the knee on descent (target ~90°). Without this split the
    # generic leg_hint kept telling extension patients to "bend more"
    # while they were doing the correct straightening motion.
    is_knee_extension = "knee_extension" in hint_lower or "knee extension" in hint_lower

    # A recognized specific exercise implies its body area even when the
    # generic keyword lists miss it — e.g. "shoulder_flexion" carries no
    # "arm" token, so without this it would fall through to the cross-body
    # fallback and score the wrong joint. Same guard for knee_extension.
    if is_shoulder_flexion:
        is_arm, is_leg = True, False
    if is_hand_to_mouth:
        is_arm, is_leg = True, False
    if is_knee_extension:
        is_leg, is_arm = True, False

    # The front camera feeds a MIRRORED frame (the patient's shirt text reads
    # backwards on screen), so MediaPipe labels the patient's real RIGHT limb
    # as its LEFT_* landmarks and vice-versa. Map the clinical affected side to
    # the mirrored MediaPipe side ("L" = LEFT_* 11/13/15/23/25/27, "R" = RIGHT_*
    # 12/14/16/24/26/28). "both" tracks both. Normalize first: strip/lowercase
    # so "Right" or "right " match, default any unexpected value to right.
    #
    # If testing shows this inverted (lifting the OTHER limb scores), swap the
    # two single-side lines below — this is the one place the mapping lives.
    side = (affected_side or "right").strip().lower()
    if side == "both":
        tracked_sides = ("L", "R")
    elif side == "left":
        tracked_sides = ("R",)   # clinical left → MediaPipe RIGHT (mirrored)
    else:                        # "right" or any unexpected value → right
        tracked_sides = ("L",)   # clinical right → MediaPipe LEFT (mirrored)

    angles: Dict[str, Any] = {}
    colors: Dict[str, str] = {}
    hint_key: Optional[str] = None

    # Visibility gate is body-area aware. Arm-only exercises pass when the
    # upper body is in frame even if the patient is sitting and the legs
    # are hidden; leg/cross-body exercises require the full body. Also
    # note that visibility used to be AVERAGED into the form score, which
    # inflated an idle-but-visible patient to ~55%. Now it's just a
    # precondition — pass it and the score is pure form quality.
    if is_arm and not is_leg:
        gate_indices = _ARM_GATE_LANDMARKS
        gate_key = "gate.upper_body"
    elif is_leg and not is_arm:
        gate_indices = _LEG_GATE_LANDMARKS
        gate_key = "gate.lower_body"
    else:
        gate_indices = tuple(range(33))
        gate_key = "gate.whole_body"

    if partial_visibility_score(keypoints, gate_indices) < 50:
        return {
            "score": 0,
            "angles": {},
            "colors": {},
            "hint": hint_text(gate_key),
            "hint_key": gate_key,
        }

    overall = 0

    # Landmark-triple pickers for a mirrored-frame side ("L"/"R"). tracked_sides
    # (set above) already maps the clinical affected side onto these.
    def _arm_triple(s, shoulder_joint):
        if shoulder_joint:
            # hip -> shoulder -> elbow (shoulder_flexion)
            idx = (_LEFT_HIP, _LEFT_SHOULDER, _LEFT_ELBOW) if s == "L" \
                else (_RIGHT_HIP, _RIGHT_SHOULDER, _RIGHT_ELBOW)
        else:
            # shoulder -> elbow -> wrist (arm_raise)
            idx = (_LEFT_SHOULDER, _LEFT_ELBOW, _LEFT_WRIST) if s == "L" \
                else (_RIGHT_SHOULDER, _RIGHT_ELBOW, _RIGHT_WRIST)
        return joint_triple(keypoints, *idx)

    def _leg_triple(s):
        idx = (_LEFT_HIP, _LEFT_KNEE, _LEFT_ANKLE) if s == "L" \
            else (_RIGHT_HIP, _RIGHT_KNEE, _RIGHT_ANKLE)
        return joint_triple(keypoints, *idx)

    def _score_tracked(triple_fn, target, green, yellow, sides=None):
        # Score every side in `sides` (defaults to tracked_sides) and keep
        # the WORST (lowest score) so on "both" the weaker limb drives the
        # color/score/hint — a strong side shouldn't mask a lagging one. A
        # requested side with no confident landmarks counts as the worst
        # (score 0), so "both" genuinely requires BOTH limbs to be tracked
        # and doesn't pass on one good limb while the other is missing.
        # Returns (angle, color, score).
        worst = None
        for s in (sides if sides is not None else tracked_sides):
            triple = triple_fn(s)
            if triple:
                ang = angle_at_vertex(*triple)
                cs = color_and_score(ang, target=target, green=green, yellow=yellow)
                candidate = (ang, cs["color"], cs["score"])
            else:
                candidate = (None, "#FFC107", 0)  # requested limb not visible → weakest
            if worst is None or candidate[2] < worst[2]:
                worst = candidate
        if worst is None:
            return None, "#FFC107", 0
        return worst

    if is_arm:
        if is_shoulder_flexion:
            # Shoulder joint angle: hip -> shoulder -> elbow.
            # Target 160° = arm raised forward and up OVERHEAD (above shoulder
            # height), elbow straight. Green band 140-180° rewards a full
            # overhead raise; below that the guide cues the patient higher.
            angle, color, overall = _score_tracked(
                lambda s: _arm_triple(s, True), target=160, green=20, yellow=40)
            # Elbow extension (shoulder -> elbow -> wrist) so the two-checkpoint
            # guide can require a STRAIGHT arm — the shoulder angle alone can't
            # see a bent-elbow "cheat" (arm down/up but elbow folded). Report the
            # most-bent tracked side (smallest angle) so one bent arm is caught.
            elbow_angle = None
            for s in tracked_sides:
                triple = _arm_triple(s, False)
                if triple:
                    ea = angle_at_vertex(*triple)
                    if ea is not None and (elbow_angle is None or ea < elbow_angle):
                        elbow_angle = ea
            angles["bicepCurl"] = angle  # frontend overlay key, reused
            angles["elbowAngle"] = elbow_angle
            colors["bicepCurl"] = color
            hint_key = shoulder_flexion_hint(angle)
        elif is_hand_to_mouth:
            # Elbow angle (shoulder -> elbow -> wrist). Target 40° = hand
            # brought up to the mouth (deep flexion). Generous bands reward
            # the raised-to-mouth position without punishing a deeper reach.
            angle, color, overall = _score_tracked(
                lambda s: _arm_triple(s, False), target=40, green=20, yellow=40)
            hint_key = hand_to_mouth_hint(angle)
            # Spatial hard gate: a bent elbow alone also fits a raised "wave",
            # so require the wrist to actually be in the mouth zone. When it
            # isn't, force red + a "bring your hand to your mouth" cue no matter
            # how good the elbow angle looks. None (can't judge — e.g. the hand
            # occludes the face) leaves the elbow score untouched.
            if hand_in_mouth_zone(keypoints, tracked_sides) is False:
                overall = min(overall, _H2M_OFF_TARGET_SCORE)
                color = "#F44336"
                hint_key = "hand_to_mouth.off_target"
            angles["bicepCurl"] = angle
            colors["bicepCurl"] = color
        else:
            # Arm raise = seated bicep curl: elbow angle (shoulder -> elbow ->
            # wrist). Target 55° = hand curled up near the shoulder (top of the
            # curl, per the demo video). The generous band rewards the raised
            # position and doesn't punish curling higher — the old 90° target
            # graded only a half-curl and told patients to "straighten" when
            # they raised their hand properly.
            angle, color, overall = _score_tracked(
                lambda s: _arm_triple(s, False), target=55, green=25, yellow=45)
            angles["bicepCurl"] = angle
            colors["bicepCurl"] = color
            hint_key = arm_raise_hint(angle)

    elif is_leg:
        # Track the AFFECTED leg via tracked_sides (right → right leg, left →
        # left, both → both) so only the affected leg is graded — the patient
        # extends their affected leg and that's the one that must score.
        # Knee extension is rewarded at the open/straight end (~170°),
        # sit_to_stand at the bent/seated end (~90°): same measurement,
        # opposite target.
        if is_knee_extension:
            target_angle, green_band, yellow_band = 170, 15, 30
        else:
            target_angle, green_band, yellow_band = 90, 15, 30
        angle, color, overall = _score_tracked(
            _leg_triple, target=target_angle, green=green_band, yellow=yellow_band)
        angles["kneeFlexion"] = angle
        colors["kneeFlexion"] = color
        hint_key = knee_extension_hint(angle) if is_knee_extension else leg_hint(angle)

    else:
        # Cross-body fallback (neither clearly arm nor leg): score arm + leg
        # on the tracked side(s) and average the two components.
        arm_angle, arm_color, arm_score = _score_tracked(
            lambda s: _arm_triple(s, False), target=90, green=10, yellow=25)
        leg_angle, leg_color, leg_score = _score_tracked(
            _leg_triple, target=90, green=15, yellow=30)
        arm_present = arm_angle is not None
        leg_present = leg_angle is not None
        if arm_present:
            angles["bicepCurl"] = arm_angle
            colors["bicepCurl"] = arm_color
        if leg_present:
            angles["kneeFlexion"] = leg_angle
            colors["kneeFlexion"] = leg_color
        # Combine arm + leg form scores only (no visibility average).
        component_scores = [sc for sc, present in
                            ((arm_score, arm_present), (leg_score, leg_present)) if present]
        overall = round(sum(component_scores) / len(component_scores)) if component_scores else 0
        # Pick the hint from the worst-scoring component so a poor limb
        # isn't hidden behind a better one.
        if arm_present and leg_present:
            hint_key = arm_hint(arm_angle) if arm_score <= leg_score else leg_hint(leg_angle)
        elif arm_present:
            hint_key = arm_hint(arm_angle)
        elif leg_present:
            hint_key = leg_hint(leg_angle)
        else:
            hint_key = "fallback.show_full_body"

    return {
        "score": overall,
        "angles": angles,
        "colors": colors,
        "hint": hint_text(hint_key),
        "hint_key": hint_key,
    }


# ── Rep counting (sets-and-modes feature, Phase A, 2026-06-04) ─────────
# Counts repetitions by watching the active joint angle cross into the
# green form-band and back out, with hysteresis at the yellow-band edge
# so a patient hovering near the boundary doesn't spam-count reps.
#
# Wired in Phase C — for now this class lives on its own. The WebSocket
# pose loop will instantiate one per rep-set (target_reps=12 by default)
# and call .update() per frame with the joint angle + the same band
# parameters that color_and_score uses for that exercise.

class RepCounter:
    """Per-set rep counter with form-band hysteresis.

    State machine:
        INITIAL          → patient may have started in the green band;
                            wait for them to leave it so the first rep
                            counts on a real movement, not the
                            already-correct starting pose.
        WAITING_FOR_TOP  → patient is outside the green band; the next
                            entry into green = +1 rep.
        AT_TOP           → patient is at correct form; must move BEYOND
                            the yellow band before another rep can
                            count (hysteresis).

    Why hysteresis: without the yellow-band exit threshold, a patient
    hovering at the green/yellow boundary would oscillate between
    in-green and out-of-green every frame and rack up false reps.
    Yellow-band exit forces a meaningful movement away from the target
    before the next rep is countable.

    Typical usage (from the WS pose loop, Phase C):
        counter = RepCounter(target_reps=12)
        # ...for each frame...
        snapshot = counter.update(
            angle=current_joint_angle,
            target_angle=90,        # same target color_and_score uses
            green_band=15,          # same green band
            yellow_band=30,         # same yellow band
        )
        if snapshot["set_complete"]:
            # advance to break screen / next set
    """

    STATE_INITIAL = "initial"
    STATE_WAITING_FOR_TOP = "waiting_for_top"
    STATE_AT_TOP = "at_top"

    def __init__(self, target_reps: int = 12) -> None:
        self.target_reps = max(1, int(target_reps))
        self.reps_completed = 0
        self.state = self.STATE_INITIAL

    def update(
        self,
        angle: Optional[float],
        target_angle: float,
        green_band: float,
        yellow_band: float,
    ) -> Dict[str, Any]:
        """Process one frame's joint angle and advance the state machine.

        Returns a snapshot the WS endpoint forwards to the client HUD:
            {
                "reps_completed": int,
                "target_reps": int,
                "set_complete": bool,
                "state": "initial" | "waiting_for_top" | "at_top",
            }

        `angle=None` (joint not visible, low confidence) is treated as
        "no signal" — state is preserved, no rep change. Set-complete
        snapshots are idempotent: calling update() again after the set
        finished returns the same snapshot without advancing.
        """
        if angle is None or self.reps_completed >= self.target_reps:
            return self._snapshot()

        diff = abs(angle - target_angle)
        in_green = diff <= green_band
        beyond_yellow = diff > yellow_band

        if self.state == self.STATE_INITIAL:
            # Refuse the first rep until the patient has demonstrably
            # left correct form — guards against the "started in green
            # zone = instant rep" foot-gun.
            if not in_green:
                self.state = self.STATE_WAITING_FOR_TOP

        elif self.state == self.STATE_WAITING_FOR_TOP:
            if in_green:
                self.reps_completed += 1
                self.state = self.STATE_AT_TOP

        elif self.state == self.STATE_AT_TOP:
            # Hysteresis: the patient must travel out of the yellow
            # band entirely before the next rep can count. Inside
            # yellow we hold AT_TOP so a slight wobble at the boundary
            # doesn't trigger another rep.
            if beyond_yellow:
                self.state = self.STATE_WAITING_FOR_TOP

        return self._snapshot()

    def _snapshot(self) -> Dict[str, Any]:
        return {
            "reps_completed": self.reps_completed,
            "target_reps": self.target_reps,
            "set_complete": self.reps_completed >= self.target_reps,
            "state": self.state,
        }
