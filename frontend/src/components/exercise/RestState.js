import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ChevronRight, X } from 'lucide-react-native';

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
  const tone = score >= 85 ? '#4CAF50' : score >= 60 ? '#FFC107' : '#FF5252';
  const message = score >= 85
    ? 'Great job!'
    : score >= 60
      ? 'Good effort — keep going!'
      : 'Nice try — every rep counts.';

  const isAnyLoading = isLoadingNext || isLoadingEnd;

  return (
    <View className="flex-1 bg-[#faf8ff] px-6 pt-12 pb-8">
      <View className="flex-1 items-center justify-center">
        <Text className="text-[#434654] text-base font-medium mb-2">You just finished</Text>
        <Text className="text-[#191b23] text-2xl font-bold text-center mb-8" numberOfLines={2}>
          {justFinishedName}
        </Text>

        <View
          className="w-44 h-44 rounded-full items-center justify-center border-8 mb-6"
          style={{ borderColor: tone }}
        >
          <Text className="text-[#191b23] text-6xl font-black">{score}%</Text>
          <Text className="text-[#434654] text-sm font-semibold mt-1">Form Score</Text>
        </View>

        <Text className="text-[#191b23] text-xl font-bold mb-2" style={{ color: tone }}>
          {message}
        </Text>

        {!isLastExercise && upNextName ? (
          <Text className="text-[#434654] text-base font-medium mt-4 text-center">
            Up next: <Text className="font-bold text-[#191b23]">{upNextName}</Text>
          </Text>
        ) : null}
      </View>

      <View className="gap-3">
        {!isLastExercise ? (
          <TouchableOpacity
            className={`bg-[#0c56d0] rounded-full flex-row items-center justify-center min-h-[60px] ${isAnyLoading ? 'opacity-70' : 'active:bg-[#0a46a8]'}`}
            onPress={handleNext}
            disabled={isAnyLoading}
          >
            {isLoadingNext ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Text className="text-white text-lg font-bold mr-2">Move to Next</Text>
                <ChevronRight size={22} color="white" />
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            className={`bg-[#4CAF50] rounded-full flex-row items-center justify-center min-h-[60px] ${isAnyLoading ? 'opacity-70' : 'active:opacity-90'}`}
            onPress={handleNext}
            disabled={isAnyLoading}
          >
            {isLoadingNext ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white text-lg font-bold">Finish Workout</Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          className={`bg-transparent border-2 border-[#c3c6d6] rounded-full flex-row items-center justify-center min-h-[56px] ${isAnyLoading ? 'opacity-70' : 'active:bg-[#ededf8]'}`}
          onPress={handleEnd}
          disabled={isAnyLoading}
        >
          {isLoadingEnd ? (
            <ActivityIndicator color="#434654" />
          ) : (
            <>
              <X size={18} color="#434654" />
              <Text className="text-[#434654] text-base font-bold ml-2">End Workout</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
