import logging
import math
import os
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("uvicorn.error")

# Set H2M_GATE_DEBUG=1 to log the mouth-zone gate's inputs and verdict for every
# scored hand_to_mouth frame (confidences, distances, why it skipped).
_H2M_GATE_DEBUG = os.getenv("H2M_GATE_DEBUG", "").strip().lower() in ("1", "true", "yes")

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
    """Map a joint angle to a band colour + 0-100 form score.

    The score is CONTINUOUS across the band edges: green runs 100->90, yellow
    picks up at 90 and runs to 50, red picks up at 50 and decays to 0. It used
    to jump (green bottomed out at 95 while yellow started at 70), so a 1-degree
    wobble at the edge swung the displayed score 25 points and read as a bug.
    Band COLOURS are unchanged, and rep/hold counting keys off colour, not the
    number - so this only affects the score the patient sees.
    """
    if angle is None:
        return {"color": "#888888", "score": 0}
    diff = abs(angle - target)
    if diff <= green:
        span = green if green > 0 else 1.0
        return {"color": "#4CAF50", "score": round(100 - (diff / span) * 10)}
    if diff <= yellow:
        span = (yellow - green) if yellow > green else 1.0
        return {"color": "#FFC107", "score": round(90 - ((diff - green) / span) * 40)}
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
    # Hand to mouth — elbow angle, therapist-confirmed target 13° (green 7-19°)
    "hand_to_mouth.not_visible": "Step back — your shoulder, elbow, and hand need to be visible",
    "hand_to_mouth.correct": "Great form! Hold your hand up at your mouth",
    "hand_to_mouth.yellow_high": "Almost there — bring your hand up closer to your mouth",
    "hand_to_mouth.yellow_low": "Ease your hand down slightly",
    "hand_to_mouth.red_high": "Bring your hand up toward your mouth",
    "hand_to_mouth.red_low": "Lower your hand back down",
    # Spatial gate: elbow is bent but the hand isn't actually at the mouth
    # (e.g. raised in the air / off to the side).
    "hand_to_mouth.off_target": "Bring your hand to your mouth",
    # Gate couldn't verify the position (face landmarks not confidently tracked).
    # Never award green on unverified data — ask the patient to reposition.
    "hand_to_mouth.unverified": "Can't see your face clearly — face the camera and step back a little",
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
    target 160° = arm raised forward and up OVERHEAD. This is the fallback cue
    for paths without the elbow angle (HTTP /pose/estimate, hold-format sets);
    the frontend two-checkpoint guide, which also sees the elbow, is the primary
    driver. Low shoulder angle = arm near the side."""
    if angle is None:
        return "shoulder_flexion.not_visible"
    # Arm near the side. Without the elbow angle we can't tell a straight
    # hang from the bent-elbow start, so cue getting INTO the start position
    # ("bend your elbow, hand to your shoulder") rather than "now reach up"
    # (shoulder_flexion.start), which assumes CP1 is already held.
    if angle < 40:
        return "shoulder_flexion.get_ready"
    diff = angle - 160
    abs_diff = abs(diff)
    if abs_diff <= 20:
        return "shoulder_flexion.correct"
    if abs_diff <= 40:
        return "shoulder_flexion.yellow_high" if diff > 0 else "shoulder_flexion.yellow_low"
    return "shoulder_flexion.red_high" if diff > 0 else "shoulder_flexion.red_low"


# hand_to_mouth ELBOW band (shoulder-elbow-wrist). Therapist-confirmed intent,
# CALIBRATED FROM THE DATASET 2026-08-13: measured over all 48 correct-labelled
# clips, on the 633 frames where hand_in_mouth_zone() verified the hand was
# actually at the mouth. That distribution: p5=1 p25=5 p50=11 p75=16 p90=20
# p99=27, and ZERO frames above 29. Correct reps are spread across depths (43%
# of verified frames sit below 10 degrees; per-clip medians span 3-24), so the
# band is deliberately ASYMMETRIC-IN-EFFECT: green reaches down to 0 because you
# cannot over-flex past a fist at your own face, and a deeper reach must not be
# punished. Red starts at 30 because no genuine at-mouth frame ever gets there.
#
# The old target of 40 (green 20-60) was inverted in practice: it scored the
# fist-at-CHIN position green while marking the correct fist-at-mouth position
# yellow and telling the patient to "ease your hand down" - i.e. reps only
# counted when the exercise was done WRONG. Note this band is NOT what separates
# mouth from chin (they differ by ~1 degree of elbow angle, and verified
# at-mouth frames run to 27): hand_in_mouth_zone() does that spatial check. This
# band only drives the Form Score and coaching text.
# Single source of truth - both the scorer and the hint function read these.
_H2M_TARGET_ANGLE = 9.5
_H2M_GREEN_BAND = 9.5    # 9.5 +/- 9.5 -> green 0-19  (89% of verified at-mouth frames)
_H2M_YELLOW_BAND = 20.0  # 9.5 +/- 20  -> yellow 20-29 (keeps chin out of green), red 30+


def hand_to_mouth_hint(angle: Optional[float]) -> str:
    """hint_key for hand_to_mouth — ELBOW angle (shoulder-elbow-wrist).
    Target/bands come from the therapist-confirmed constants above; "high"
    (angle above target) means the hand is too LOW, so the cue is to bring it up."""
    if angle is None:
        return "hand_to_mouth.not_visible"
    diff = angle - _H2M_TARGET_ANGLE
    abs_diff = abs(diff)
    if abs_diff <= _H2M_GREEN_BAND:
        return "hand_to_mouth.correct"
    if abs_diff <= _H2M_YELLOW_BAND:
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
# face) from a bent-elbow compensation held at chest height — both flex the
# elbow — so we ALSO require the wrist to actually be in the mouth zone.
#
# Thresholds measured on the recorded Correct clips in LIVE pixel coordinates
# (x*width, y*height — the shape score_pose actually receives), all in
# shoulder-widths:
#   genuine hand-at-mouth : 0.19-0.40 from the mouth, +0.17..+0.45 ABOVE the
#                           shoulder line, and 0.076-0.258 BELOW the nose
#   wrist at collarbone   : 0.33-0.46 from the mouth,  0.00 above the shoulders
#   wrist at mid-chest    : 0.97-1.29 from the mouth,  below the shoulder line
#   fist at nose / temple : 0.09-0.44 from the mouth,  AT or ABOVE the nose
#   hand waving by head   : 0.47-0.52 from the mouth,  ABOVE the nose
#
# The zone therefore needs all three bounds — each one catches a different
# cheat, and no single one catches them all:
#   distance      rejects a hand nowhere near the face (mid-chest, overhead)
#   above-shoulder rejects a wrist parked at the collarbone/chest. Distance
#                  ALONE cannot: 0.33-0.46 overlaps the genuine 0.19-0.40,
#                  which is exactly why a chest compensation scored 96% green.
#   below-nose    rejects a raised "wave" / fist held at nose level. Neither of
#                 the other two can: a fist at the nose is CLOSER to the mouth
#                 (0.09-0.12) than a real rep and sits high above the shoulders.
# Net: the wrist must sit in the band between the shoulder line and the nose,
# near the mouth — which is where a hand actually is during this exercise.
_H2M_WRIST_MOUTH_MAX_RATIO = 0.55     # genuine peaks at 0.40; rejects mid-chest (0.97+)
# Vertical band, measured DOWN from the nose. Anchoring to the nose (a face
# landmark, like the mouth) rather than to the shoulder line matters: a
# shoulder-relative height test is camera-angle dependent and failed in the
# field. In a live labelled capture the same person's wrist sat 0.43-0.52 below
# the nose holding at the mouth, but 0.66-0.94 below it doing the chest/collarbone
# compensation - a 0.145 gap, the widest of any metric measured, so the band
# splits it at ~0.59. The upper bound rejects a raised wave / fist at nose level
# (which measures 0.00 or above, and is CLOSER to the mouth than a real rep).
_H2M_WRIST_MIN_BELOW_NOSE = 0.03      # genuine clears this by 0.076 at worst
_H2M_WRIST_MAX_BELOW_NOSE = 0.59      # genuine max 0.52; compensation min 0.66
_H2M_OFF_TARGET_SCORE = 10            # firmly red when the hand isn't at the mouth
# "Can't verify" must never award green: an unverifiable frame is capped to the
# top of the yellow band instead of letting the elbow-only score stand.
_H2M_UNVERIFIED_SCORE = 55


def hand_in_mouth_zone_detail(
    keypoints: List[Dict[str, float]], sides
) -> Tuple[Optional[bool], Dict[str, Any]]:
    """Gate verdict plus the numbers behind it (for logging/diagnosis).

    Verdict: True if a tracked-side wrist is in the mouth zone, False if it's
    determinable and none are, None if the landmarks aren't confident enough to
    judge. The mouth zone requires ALL THREE:
      - within _H2M_WRIST_MOUTH_MAX_RATIO shoulder-widths of the mouth
      - at least _H2M_WRIST_MIN_BELOW_NOSE below the nose (rejects a raised
        wave / fist at nose level, which is even CLOSER to the mouth than a
        real rep, so distance alone can never catch it)
      - no more than _H2M_WRIST_MAX_BELOW_NOSE below the nose (rejects a wrist
        parked at the collarbone/chest, which sits just as close to the mouth
        as a genuine hand-at-mouth does)
    The last two form a vertical band measured DOWN from the nose. It is
    anchored to the nose rather than to the shoulder line on purpose: a
    shoulder-relative height test is camera-angle dependent and false-rejected
    every genuine frame in field testing.
    `sides` are the mirrored-frame side letters ("L"/"R") used in this module.
    """
    d: Dict[str, Any] = {"reason": None, "nose_c": None, "mouth_c": None,
                         "shoulder_c": None, "wrists": []}
    if len(keypoints) <= max(_MOUTH_RIGHT, _RIGHT_WRIST):
        d["reason"] = "too_few_landmarks"
        return None, d
    nose = keypoints[_NOSE]
    ml, mr = keypoints[_MOUTH_LEFT], keypoints[_MOUTH_RIGHT]
    ls, rs = keypoints[_LEFT_SHOULDER], keypoints[_RIGHT_SHOULDER]
    d["nose_c"] = round(float(nose.get("score", 0)), 3)
    d["mouth_c"] = round(float(min(ml.get("score", 0), mr.get("score", 0))), 3)
    d["shoulder_c"] = round(float(min(ls.get("score", 0), rs.get("score", 0))), 3)
    # Need a confident nose, mouth, and shoulders to place the zone and set its
    # scale. A mis-placed mouth center would produce a meaningless distance, so
    # we report "can't judge" rather than a wrong verdict — but the CALLER now
    # treats that as unverified (capped), not as a pass.
    if (nose.get("score", 0) < 0.5
            or min(ml.get("score", 0), mr.get("score", 0)) < 0.5
            or min(ls.get("score", 0), rs.get("score", 0)) < 0.3):
        d["reason"] = "low_face_confidence"
        return None, d
    shoulder_w = math.hypot(ls["x"] - rs["x"], ls["y"] - rs["y"])
    if shoulder_w < 1e-3:
        d["reason"] = "degenerate_shoulder_width"
        return None, d
    mouth_x = (ml["x"] + mr["x"]) / 2.0
    mouth_y = (ml["y"] + mr["y"]) / 2.0
    shoulder_y = (ls["y"] + rs["y"]) / 2.0
    determinable = False
    verdict = False
    for s in sides:
        wr = keypoints[_LEFT_WRIST] if s == "L" else keypoints[_RIGHT_WRIST]
        wc = float(wr.get("score", 0))
        if wc < 0.3:
            d["wrists"].append({"side": s, "conf": round(wc, 3), "skipped": True})
            continue
        determinable = True
        ratio = math.hypot(wr["x"] - mouth_x, wr["y"] - mouth_y) / shoulder_w
        # Image y grows downward, so "above the shoulder line" is positive here
        # and vs_nose is negative when the wrist is below the nose.
        above = (shoulder_y - wr["y"]) / shoulder_w
        vs_nose = (nose["y"] - wr["y"]) / shoulder_w
        near = ratio <= _H2M_WRIST_MOUTH_MAX_RATIO
        # Vertical band below the nose: `under` rejects a wave at/above nose
        # level, `in_band` rejects a wrist dropped to the chest/collarbone.
        # `above` is logged for diagnosis only - it is NOT a criterion, because
        # shoulder-relative height varies with camera angle (see constants).
        under = vs_nose <= -_H2M_WRIST_MIN_BELOW_NOSE
        in_band = vs_nose >= -_H2M_WRIST_MAX_BELOW_NOSE
        d["wrists"].append({"side": s, "conf": round(wc, 3),
                            "ratio": round(ratio, 3), "above": round(above, 3),
                            "vs_nose": round(vs_nose, 3), "near": near,
                            "under": under, "in_band": in_band,
                            "pass": near and under and in_band})
        if near and under and in_band:
            verdict = True
    if not determinable:
        d["reason"] = "no_confident_wrist"
        return None, d
    d["reason"] = "evaluated"
    return verdict, d


def hand_in_mouth_zone(keypoints: List[Dict[str, float]], sides) -> Optional[bool]:
    """Verdict-only wrapper around hand_in_mouth_zone_detail()."""
    return hand_in_mouth_zone_detail(keypoints, sides)[0]


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
            # Elbow angle (shoulder -> elbow -> wrist), therapist-confirmed band
            # (see _H2M_TARGET_ANGLE): green = fist at the MOUTH, not the chin.
            angle, color, overall = _score_tracked(
                lambda s: _arm_triple(s, False), target=_H2M_TARGET_ANGLE,
                green=_H2M_GREEN_BAND, yellow=_H2M_YELLOW_BAND)
            hint_key = hand_to_mouth_hint(angle)
            # Spatial hard gate: a bent elbow alone also fits a chest-height
            # compensation, so require the wrist to actually be in the mouth
            # zone. Rehab-safe defaults — an unverified position must never be
            # awarded green:
            #   False (definitely not at the mouth) -> red, "bring it up" cue
            #   None  (can't verify: face not tracked) -> capped to yellow +
            #          a reposition cue, rather than trusting the elbow alone
            in_zone, gate_detail = hand_in_mouth_zone_detail(keypoints, tracked_sides)
            if _H2M_GATE_DEBUG:
                # ASCII only - this can run on a cp1252 console.
                logger.info("h2m-gate: verdict=%s reason=%s nose_c=%s mouth_c=%s "
                            "shoulder_c=%s wrists=%s elbow_angle=%s elbow_score=%s",
                            in_zone, gate_detail.get("reason"), gate_detail.get("nose_c"),
                            gate_detail.get("mouth_c"), gate_detail.get("shoulder_c"),
                            gate_detail.get("wrists"), angle, overall)
            if in_zone is False:
                overall = min(overall, _H2M_OFF_TARGET_SCORE)
                color = "#F44336"
                hint_key = "hand_to_mouth.off_target"
            elif in_zone is None:
                overall = min(overall, _H2M_UNVERIFIED_SCORE)
                color = "#FFC107"
                hint_key = "hand_to_mouth.unverified"
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
