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
    return {"color": "#F44336", "score": max(20, round(50 - (diff - yellow) * 0.5))}


def joint_triple(keypoints: List[Dict[str, float]], i1: int, i2: int, i3: int, min_conf: float = 0.3):
    if len(keypoints) <= max(i1, i2, i3):
        return None
    a, b, c = keypoints[i1], keypoints[i2], keypoints[i3]
    if min(a.get("score", 0), b.get("score", 0), c.get("score", 0)) < min_conf:
        return None
    return a, b, c


def arm_hint(angle: Optional[float]) -> str:
    if angle is None:
        return "Show your full arm — elbow must be visible"
    diff = angle - 90
    abs_diff = abs(diff)
    if abs_diff <= 10:
        return "Great form! Hold it"
    if abs_diff <= 25:
        return "Curl a little more" if diff > 0 else "Open your arm slightly"
    return "Bend your elbow higher" if diff > 0 else "Lower your arm a bit"


def leg_hint(angle: Optional[float]) -> str:
    if angle is None:
        return "Show your full leg — knee must be visible"
    diff = angle - 90
    abs_diff = abs(diff)
    if abs_diff <= 15:
        return "Great form! Hold it"
    if abs_diff <= 30:
        return "Bend your knee a bit more" if diff > 0 else "Straighten slightly"
    return "Bend your knee deeper" if diff > 0 else "Straighten your leg"


def overall_visibility_score(keypoints: List[Dict[str, float]]) -> int:
    if not keypoints:
        return 0
    confidences = [kp.get("score", 0) for kp in keypoints]
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

    side = (affected_side or "right").lower()
    left_side = side == "left"

    angles: Dict[str, Any] = {}
    colors: Dict[str, str] = {}
    overall = overall_visibility_score(keypoints)
    hint: Optional[str] = None

    if is_arm:
        sh, el, wr = (_LEFT_SHOULDER, _LEFT_ELBOW, _LEFT_WRIST) if left_side else (_RIGHT_SHOULDER, _RIGHT_ELBOW, _RIGHT_WRIST)
        triple = joint_triple(keypoints, sh, el, wr)
        component_scores = [overall_visibility_score(keypoints)]
        if triple:
            angle = angle_at_vertex(*triple)
            angles["bicepCurl"] = angle
            cs = color_and_score(angle, target=90, green=10, yellow=25)
            colors["bicepCurl"] = cs["color"]
            component_scores.append(cs["score"])
        else:
            angles["bicepCurl"] = None
            colors["bicepCurl"] = "#FFC107"
        overall = round(sum(component_scores) / len(component_scores))
        hint = arm_hint(angles.get("bicepCurl"))

    elif is_leg:
        hp, kn, an = (_LEFT_HIP, _LEFT_KNEE, _LEFT_ANKLE) if left_side else (_RIGHT_HIP, _RIGHT_KNEE, _RIGHT_ANKLE)
        triple = joint_triple(keypoints, hp, kn, an)
        component_scores = [overall_visibility_score(keypoints)]
        if triple:
            angle = angle_at_vertex(*triple)
            angles["kneeFlexion"] = angle
            cs = color_and_score(angle, target=90, green=15, yellow=30)
            colors["kneeFlexion"] = cs["color"]
            component_scores.append(cs["score"])
        else:
            angles["kneeFlexion"] = None
            colors["kneeFlexion"] = "#FFC107"
        overall = round(sum(component_scores) / len(component_scores))
        hint = leg_hint(angles.get("kneeFlexion"))

    else:
        arm_sh, arm_el, arm_wr = (_LEFT_SHOULDER, _LEFT_ELBOW, _LEFT_WRIST) if left_side else (_RIGHT_SHOULDER, _RIGHT_ELBOW, _RIGHT_WRIST)
        leg_hp, leg_kn, leg_an = (_LEFT_HIP, _LEFT_KNEE, _LEFT_ANKLE) if left_side else (_RIGHT_HIP, _RIGHT_KNEE, _RIGHT_ANKLE)
        arm_triple = joint_triple(keypoints, arm_sh, arm_el, arm_wr)
        leg_triple = joint_triple(keypoints, leg_hp, leg_kn, leg_an)
        # Collect all component scores first so the final average is a true mean
        # and not order-dependent from repeated round((overall + cs) / 2) chaining.
        component_scores = [overall_visibility_score(keypoints)]
        arm_score = None
        leg_score = None
        if arm_triple:
            arm_angle = angle_at_vertex(*arm_triple)
            angles["bicepCurl"] = arm_angle
            cs = color_and_score(arm_angle, target=90, green=10, yellow=25)
            colors["bicepCurl"] = cs["color"]
            arm_score = cs["score"]
            component_scores.append(arm_score)
        if leg_triple:
            leg_angle = angle_at_vertex(*leg_triple)
            angles["kneeFlexion"] = leg_angle
            cs = color_and_score(leg_angle, target=90, green=15, yellow=30)
            colors["kneeFlexion"] = cs["color"]
            leg_score = cs["score"]
            component_scores.append(leg_score)
        overall = round(sum(component_scores) / len(component_scores))
        # Pick the hint from the worst-scoring component so a poor limb
        # isn't hidden behind a better one.
        if arm_score is not None and leg_score is not None:
            if arm_score <= leg_score:
                hint = arm_hint(angles["bicepCurl"])
            else:
                hint = leg_hint(angles["kneeFlexion"])
        elif arm_score is not None:
            hint = arm_hint(angles["bicepCurl"])
        elif leg_score is not None:
            hint = leg_hint(angles["kneeFlexion"])
        else:
            hint = "Step back — show your full body"

    return {"score": overall, "angles": angles, "colors": colors, "hint": hint}
