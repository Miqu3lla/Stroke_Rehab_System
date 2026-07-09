import math
from typing import Any, Dict, List, Optional

# MediaPipe BlazePose landmark indices used by realtime form scoring.
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


def arm_raise_hint(angle: Optional[float]) -> str:
    """Hints for arm_raise — measured by ELBOW angle (shoulder-elbow-wrist).
    Target 90° = forearm parallel to floor (bicep-curl shape)."""
    if angle is None:
        return "Step back — your shoulder, elbow, and hand need to be visible"
    diff = angle - 90
    abs_diff = abs(diff)
    if abs_diff <= 10:
        return "Great form! Hold this position"
    if abs_diff <= 25:
        return "Almost there — bend your elbow a little more" if diff > 0 \
            else "Almost there — straighten your arm a little"
    return "Bend your elbow to bring your hand up toward your shoulder" if diff > 0 \
        else "Lower your hand back down"


def shoulder_flexion_hint(angle: Optional[float]) -> str:
    """Hints for shoulder_flexion — measured by SHOULDER angle (hip-shoulder-elbow).
    Target 90° = arm raised forward to shoulder height with elbow kept straight."""
    if angle is None:
        return "Step back — your hip, shoulder, and elbow need to be visible"
    diff = angle - 90
    abs_diff = abs(diff)
    if abs_diff <= 15:
        return "Great form! Hold your arm at shoulder height"
    if abs_diff <= 30:
        return "Almost there — lower your arm a little" if diff > 0 \
            else "Almost there — raise your arm a little higher"
    return "Lower your arm — keep it level with your shoulder" if diff > 0 \
        else "Raise your arm forward and up to shoulder height"


# Backwards-compat alias used by the cross-body ("both") branch where we
# don't know the specific exercise — defaults to arm-raise interpretation.
arm_hint = arm_raise_hint


def leg_hint(angle: Optional[float]) -> str:
    """Generic leg hint for sit_to_stand and the cross-body fallback —
    target 90° = seated squat depth where the knee is bent."""
    if angle is None:
        return "Step back — your hip, knee, and ankle need to be visible"
    diff = angle - 90
    abs_diff = abs(diff)
    if abs_diff <= 15:
        return "Great form! Hold this position"
    if abs_diff <= 30:
        return "Almost there — bend your knee a little more" if diff > 0 \
            else "Almost there — straighten your leg a little"
    return "Bend your knee further — try sitting lower" if diff > 0 \
        else "Stand tall and straighten your leg fully"


def knee_extension_hint(angle: Optional[float]) -> str:
    """Hints for knee_extension — measured by KNEE angle (hip-knee-ankle).
    Patient sits in a chair and lifts their foot to extend the affected leg
    straight out, parallel to the floor. Target ~170° = leg fully extended.
    The seated start position is ~90°, so we want them to OPEN the knee
    angle (the opposite of a squat), not close it like sit_to_stand does."""
    if angle is None:
        return "Sit down — your hip, knee, and ankle need to be visible"
    if angle >= 160:
        return "Great form! Hold your leg out straight"
    if angle >= 130:
        return "Almost there — straighten your knee a little more"
    if angle >= 100:
        return "Lift your foot up — extend your leg out straight"
    return "Sit upright, then lift your foot and straighten your knee out in front of you"


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
    # Distinguish knee_extension from sit_to_stand — same body area, but
    # target angles point in opposite directions. Seated knee extension
    # = lift the foot to OPEN the knee (target ~170°); sit_to_stand =
    # bend the knee on descent (target ~90°). Without this split the
    # generic leg_hint kept telling extension patients to "bend more"
    # while they were doing the correct straightening motion.
    is_knee_extension = "knee_extension" in hint_lower or "knee extension" in hint_lower

    # Front-facing camera: expo-camera mirrors the frame it sends to the
    # backend, so MediaPipe's LEFT_* landmarks land on the patient's real
    # RIGHT side and vice-versa. Map the clinical affected side to the
    # mirrored-frame landmark side ("L" = LEFT_* indices, "R" = RIGHT_*) so
    # we score the limb the patient is actually moving. "both" tracks both.
    side = (affected_side or "right").lower()
    if side == "both":
        tracked_sides = ("L", "R")
    elif side == "right":
        tracked_sides = ("L",)   # clinical right → mirrored-frame left
    else:                        # "left" or unknown default
        tracked_sides = ("R",)   # clinical left  → mirrored-frame right

    angles: Dict[str, Any] = {}
    colors: Dict[str, str] = {}
    hint: Optional[str] = None

    # Visibility gate is body-area aware. Arm-only exercises pass when the
    # upper body is in frame even if the patient is sitting and the legs
    # are hidden; leg/cross-body exercises require the full body. Also
    # note that visibility used to be AVERAGED into the form score, which
    # inflated an idle-but-visible patient to ~55%. Now it's just a
    # precondition — pass it and the score is pure form quality.
    if is_arm and not is_leg:
        gate_indices = _ARM_GATE_LANDMARKS
        gate_hint = "Show your upper body — shoulders, elbows, and hands need to be in the camera"
    elif is_leg and not is_arm:
        gate_indices = _LEG_GATE_LANDMARKS
        gate_hint = "Step back so your hips, knees, and feet are visible"
    else:
        gate_indices = tuple(range(33))
        gate_hint = "Move back so your whole body is in the camera"

    if partial_visibility_score(keypoints, gate_indices) < 50:
        return {
            "score": 0,
            "angles": {},
            "colors": {},
            "hint": gate_hint,
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
        # color/score/hint the patient sees — a strong side shouldn't mask a
        # lagging one. Returns (angle, color, score); angle=None + yellow
        # when no side is visible.
        worst = None
        for s in (sides if sides is not None else tracked_sides):
            triple = triple_fn(s)
            if not triple:
                continue
            ang = angle_at_vertex(*triple)
            cs = color_and_score(ang, target=target, green=green, yellow=yellow)
            if worst is None or cs["score"] < worst[2]:
                worst = (ang, cs["color"], cs["score"])
        if worst is None:
            return None, "#FFC107", 0
        return worst

    def _most_visible_side(triple_fn):
        # Side-view exercises (arm_raise, knee_extension, sit_to_stand) show
        # one limb to the camera; the other is occluded behind it. Pick the
        # side whose landmarks are more confident — that's the limb facing the
        # camera (the affected one the patient is demonstrating). Independent
        # of the frontal-only mirror mapping in tracked_sides.
        def _conf(s):
            tri = triple_fn(s)
            return min((kp.get("score", 0) for kp in tri), default=-1.0) if tri else -1.0
        return "L" if _conf("L") >= _conf("R") else "R"

    if is_arm:
        if is_shoulder_flexion:
            # shoulder_flexion is the one FRONTAL exercise (patient faces the
            # camera, raises both arms), so the mirror-mapped affected side
            # applies. Shoulder joint angle: hip -> shoulder -> elbow.
            # Target 90° = arm raised to shoulder height, elbow straight.
            angle, color, overall = _score_tracked(
                lambda s: _arm_triple(s, True), target=90, green=15, yellow=30)
            angles["bicepCurl"] = angle  # frontend overlay key, reused
            colors["bicepCurl"] = color
            hint = shoulder_flexion_hint(angle)
        else:
            # Arm raise (seated bicep curl) is filmed side-on, so only the arm
            # facing the camera tracks well — score the most-visible arm, the
            # same way legs are handled. Elbow angle: shoulder -> elbow ->
            # wrist. Target 90° = forearm parallel to the floor.
            arm_side = _most_visible_side(lambda s: _arm_triple(s, False))
            angle, color, overall = _score_tracked(
                lambda s: _arm_triple(s, False), target=90, green=10, yellow=25,
                sides=(arm_side,))
            angles["bicepCurl"] = angle
            colors["bicepCurl"] = color
            hint = arm_raise_hint(angle)

    elif is_leg:
        # Leg exercises are performed side-on to the camera so the sagittal
        # knee angle sits in the image plane. Only the leg facing the camera
        # tracks reliably — the far leg is occluded behind it. Score the leg
        # with the higher landmark confidence: that's the one the patient is
        # showing the camera (their affected leg). This intentionally
        # overrides the front-camera mirror mapping (which only makes sense
        # for frontal arm exercises) — tracking the mirror-mapped *far* leg
        # was reading a fully-straightened leg as still bent.
        leg_side = _most_visible_side(_leg_triple)
        # Knee extension is rewarded at the open/straight end of the joint
        # range, sit_to_stand at the bent/seated end. Same measurement,
        # opposite target — without splitting these the extension exercise
        # scored 0 the moment the patient started straightening correctly.
        if is_knee_extension:
            target_angle, green_band, yellow_band = 170, 15, 30
        else:
            target_angle, green_band, yellow_band = 90, 15, 30
        angle, color, overall = _score_tracked(
            _leg_triple, target=target_angle, green=green_band, yellow=yellow_band,
            sides=(leg_side,))
        angles["kneeFlexion"] = angle
        colors["kneeFlexion"] = color
        hint = knee_extension_hint(angle) if is_knee_extension else leg_hint(angle)

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
            hint = arm_hint(arm_angle) if arm_score <= leg_score else leg_hint(leg_angle)
        elif arm_present:
            hint = arm_hint(arm_angle)
        elif leg_present:
            hint = leg_hint(leg_angle)
        else:
            hint = "Step back — show your full body"

    return {"score": overall, "angles": angles, "colors": colors, "hint": hint}


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
