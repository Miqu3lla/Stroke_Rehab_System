import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ChevronRight, X } from 'lucide-react-native';
import { palette, scoreTone } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

// Rest / Transition state between exercises. Shows the score from the
// exercise the patient just ended and offers two choices: Move to Next
// (continue the session) or End Workout (flush and exit).
export default function RestState({
  justFinishedName,
  justFinishedScore,
  isLastExercise,
  upNextName,
  onNext,
  onEndWorkout,
}) {
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [isLoadingEnd, setIsLoadingEnd] = useState(false);

  // Track whether this component is still mounted to avoid
  // setting state after navigation.replace unmounts it.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const handleNext = async () => {
    setIsLoadingNext(true);
    try {
      await onNext();
    } finally {
      if (isMountedRef.current) setIsLoadingNext(false);
    }
  };

  const handleEnd = async () => {
    setIsLoadingEnd(true);
    try {
      await onEndWorkout();
    } finally {
      if (isMountedRef.current) setIsLoadingEnd(false);
    }
  };

  const score = Math.round(Number(justFinishedScore) || 0);
  const tone = scoreTone(score);
  const toneSoft = score >= 70 ? palette.sageSoft : palette.amberSoft;

  const message = score >= 85
    ? 'Great job!'
    : score >= 60
      ? 'Good effort — keep going!'
      : 'Nice try — every rep counts.';

  const isAnyLoading = isLoadingNext || isLoadingEnd;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>

        {/* Finished label */}
        <Text style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: palette.inkSoft, marginBottom: 6 }}>
          You just finished
        </Text>
        <Text
          style={{ fontFamily: fonts.serif, fontSize: 24, color: palette.ink, textAlign: 'center', marginBottom: 28 }}
          numberOfLines={2}
        >
          {justFinishedName}
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

        {/* Encouragement */}
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 18, color: tone, marginBottom: 4 }}>
          {message}
        </Text>

        {/* Up next */}
        {!isLastExercise && upNextName ? (
          <Text style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: palette.inkSoft, marginTop: 16, textAlign: 'center' }}>
            Up next:{' '}
            <Text style={{ fontFamily: fonts.sansBold, color: palette.ink }}>{upNextName}</Text>
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 12 }}>
        {!isLastExercise ? (
          <TouchableOpacity
            style={{
              backgroundColor: palette.primary,
              borderRadius: 99,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 60,
              opacity: isAnyLoading ? 0.7 : 1,
            }}
            onPress={handleNext}
            disabled={isAnyLoading}
            activeOpacity={0.85}
          >
            {isLoadingNext ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: '#ffffff', marginRight: 6 }}>
                  Move to Next
                </Text>
                <ChevronRight size={22} color="white" />
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={{
              backgroundColor: palette.sage,
              borderRadius: 99,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 60,
              opacity: isAnyLoading ? 0.7 : 1,
            }}
            onPress={handleNext}
            disabled={isAnyLoading}
            activeOpacity={0.85}
          >
            {isLoadingNext ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: '#ffffff' }}>
                Finish Workout
              </Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={{
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderColor: palette.line,
            borderRadius: 99,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 56,
            opacity: isAnyLoading ? 0.7 : 1,
          }}
          onPress={handleEnd}
          disabled={isAnyLoading}
          activeOpacity={0.7}
        >
          {isLoadingEnd ? (
            <ActivityIndicator color={palette.inkSoft} />
          ) : (
            <>
              <X size={18} color={palette.inkSoft} />
              <Text style={{ fontFamily: fonts.sansBold, fontSize: 15, color: palette.inkSoft, marginLeft: 8 }}>
                End Workout
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
