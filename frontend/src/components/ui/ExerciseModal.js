import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Clock, X, Play } from 'lucide-react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../../services/supabase';
import usePatientStore from '../../store/usePatientStore';
import useSessionStore from '../../store/useSessionStore';
import { formatExerciseSession } from '../../utils/duration';

export default function ExerciseModal({ visible, exercise, onClose, navigation }) {
  const { recommendedExercises } = usePatientStore();
  const { beginSession } = useSessionStore();

  // Build the public playback URL from the storage-relative filename
  // (e.g. "shoulder_flexion.mp4"). getPublicUrl uses the supabase client's
  // URL so this adapts to dev/prod (and the emulator's 10.0.2.2 vs phone IP)
  // automatically without us hard-coding a host. Returns empty string when
  // the exercise has no recording yet — we render the placeholder in that case.
  const demoVideoUrl = React.useMemo(() => {
    if (!exercise?.demo_video_path) return '';
    const { data } = supabase.storage
      .from('exercise-demos')
      .getPublicUrl(exercise.demo_video_path);
    return data?.publicUrl || '';
  }, [exercise?.demo_video_path]);

  // useVideoPlayer must be called on every render to satisfy React's hooks
  // rules, even when there's no URL yet — the player is harmless when its
  // source is empty. Looping + muted matches how the user reads a silent,
  // repeating instructional clip in the bottom-sheet.
  const player = useVideoPlayer(demoVideoUrl, (p) => {
    p.loop = true;
    p.muted = true;
  });

  // Pause when the sheet hides so the video isn't burning frames behind a
  // dismissed modal, then resume when it reopens. We also re-trigger play
  // whenever the URL changes (e.g. user opens the modal on a different exercise).
  React.useEffect(() => {
    if (visible && demoVideoUrl) {
      player.play();
    } else {
      player.pause();
    }
  }, [visible, demoVideoUrl, player]);

  if (!exercise) return null;

  // Tapping a card starts a workout session with the full recommended
  // playlist, entering at the tapped exercise's index. Falls back to a
  // single-exercise playlist if the recommendations list isn't loaded.
  const handleStartExercise = () => {
    const playlist = (recommendedExercises && recommendedExercises.length > 0)
      ? recommendedExercises
      : [exercise];
    const startIndex = playlist.findIndex((e) => e.id === exercise.id);
    beginSession(playlist, startIndex >= 0 ? startIndex : 0);
    onClose();
    navigation.navigate('Exercise');
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" onPress={onClose} />

        {/* Modal Content */}
        <View className="bg-[#faf8ff] rounded-t-3xl pt-2 px-6 pb-10 max-h-[90%]">

          {/* Drag Indicator */}
          <View className="w-12 h-1.5 bg-[#c3c6d6] rounded-full self-center mb-4" />

          {/* Header Row */}
          <View className="flex-row justify-between items-start mb-6">
            <View className="flex-1 pr-4">
              <Text className="text-[28px] font-bold text-[#191b23] leading-tight">
                {exercise.name}
              </Text>
              <View className="flex-row items-center gap-2 mt-2">
                <Clock size={18} color="#434654" />
                <Text className="text-[16px] font-medium text-[#434654]">
                  {formatExerciseSession(exercise)}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={onClose}
              className="bg-[#e7e7f2] p-2 rounded-full mt-1"
            >
              <X size={24} color="#191b23" />
            </TouchableOpacity>
          </View>

          {/* Video Demo — plays when demo_video_path is set, otherwise falls
              back to the original placeholder so future exercises without a
              recording still render the card. */}
          {demoVideoUrl ? (
            <View className="w-full aspect-video rounded-2xl mb-6 overflow-hidden border-4 border-[#ededf8] bg-black">
              <VideoView
                player={player}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                nativeControls
                fullscreenOptions={{ enable: true }}
              />
            </View>
          ) : (
            <View className="w-full aspect-video bg-[#e7e7f2] rounded-2xl mb-6 items-center justify-center border-4 border-[#ededf8]">
              <Play size={48} color="#c3c6d6" />
              <Text className="text-[#434654] font-medium mt-2">Video Demonstration</Text>
            </View>
          )}

          {/* Description */}
          <View className="mb-8">
            <Text className="text-[18px] font-bold text-[#191b23] mb-2">Instructions</Text>
            <Text className="text-[16px] text-[#434654] leading-relaxed">
              {exercise.description || "Follow along with the video to safely and effectively perform this exercise."}
            </Text>
          </View>

          {/* Start Button */}
          <TouchableOpacity
            className="w-full bg-[#0c56d0] min-h-[64px] rounded-full flex-row items-center justify-center active:bg-[#0a46a8]"
            onPress={handleStartExercise}
          >
            <Text className="text-white text-[20px] font-bold">Start Exercise</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
