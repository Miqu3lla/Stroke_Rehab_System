import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Play, X } from 'lucide-react-native';
import { palette, scoreTone } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// BreakScreen — overlay shown between sets of the same exercise.
// Sets-and-modes Phase C (2026-06-04). Designed with the user's
// "Happy Path" UX brief: massive primary "Start Next Set" button to
// reduce decision fatigue, plus a smaller secondary "End Early" for
// the patient to bail out when they're exhausted. Sits inside
// CameraComponent so the camera + WebSocket stay alive across sets
// (no re-handshake), but pauses frame capture while the screen is up.

export default function BreakScreen({
  justFinishedSetIndex,    // 0-indexed; +1 for display
  totalSets,
  justFinishedScore,       // 0-100 avg form score for the set just done
  justFinishedReps,        // reps actually completed (may be < target on cap)
  targetRepsForFinishedSet,
  upNextLabel,             // e.g. "Set 2 of 3" — caller computes
  onStartNextSet,
  onEndEarly,
}) {
  const score = Math.round(Number(justFinishedScore) || 0);
  const tone = scoreTone(score);
  const toneSoft = score >= 70 ? palette.sageSoft : palette.amberSoft;

  const encouragement = score >= 85
    ? 'Great form! Keep it up.'
    : score >= 60
      ? 'Good effort — push through.'
      : 'Catch your breath, then go again.';

  const reps = Math.max(0, Math.floor(Number(justFinishedReps) || 0));
  const repTarget = Math.max(1, Math.floor(Number(targetRepsForFinishedSet) || 12));

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.canvas, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>

        {/* Set badge */}
        <View style={{ backgroundColor: palette.primarySoft, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 99, marginBottom: 16 }}>
          <Text style={{ fontFamily: fonts.monoSemibold, fontSize: 11, color: palette.primary, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            Set {Math.max(1, (Number(justFinishedSetIndex) || 0) + 1)} of {Math.max(1, Number(totalSets) || 1)} complete
          </Text>
        </View>

        {/* Heading */}
        <Text style={{ fontFamily: fonts.serif, fontSize: 28, color: palette.ink, textAlign: 'center', marginBottom: 28 }}>
          Take a breather
        </Text>

        {/* Score ring */}
        <View
          style={{
            width: 176,
            height: 176,
            borderRadius: 88,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 8,
            borderColor: tone,
            backgroundColor: toneSoft,
            marginBottom: 20,
          }}
        >
          <Text style={{ fontFamily: fonts.monoSemibold, fontSize: 52, color: palette.ink, lineHeight: 56 }}>
            {score}%
          </Text>
          <Text style={{ fontFamily: fonts.sansSemibold, fontSize: 11, color: palette.inkSoft, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
            Form Score
          </Text>
        </View>

        {/* Rep count */}
        <Text style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: palette.inkSoft, marginBottom: 6 }}>
          {reps} of {repTarget} reps completed
        </Text>

        {/* Encouragement */}
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 18, color: tone, marginBottom: 4 }}>
          {encouragement}
        </Text>

        {/* Up next */}
        {upNextLabel ? (
          <Text style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: palette.inkSoft, marginTop: 16, textAlign: 'center' }}>
            Up next:{' '}
            <Text style={{ fontFamily: fonts.sansBold, color: palette.ink }}>{upNextLabel}</Text>
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 12 }}>
        {/* Happy Path primary action — massive button, hard to miss. */}
        <TouchableOpacity
          style={{
            backgroundColor: palette.primary,
            borderRadius: 99,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 72,
          }}
          onPress={onStartNextSet}
          accessibilityRole="button"
          activeOpacity={0.85}
        >
          <Play size={26} color="#ffffff" />
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 20, color: '#ffffff', marginLeft: 12 }}>
            Start Next Set
          </Text>
        </TouchableOpacity>

        {/* Secondary "end early" — visually deprioritized so an
            exhausted patient can still find the exit, but the eye
            naturally lands on Start Next Set first. */}
        <TouchableOpacity
          style={{
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderColor: palette.line,
            borderRadius: 99,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 52,
          }}
          onPress={onEndEarly}
          accessibilityRole="button"
          activeOpacity={0.7}
        >
          <X size={18} color={palette.inkSoft} />
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 15, color: palette.inkSoft, marginLeft: 8 }}>
            End Early
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
