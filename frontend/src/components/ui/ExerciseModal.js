import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Clock, X, Play, ChevronRight } from 'lucide-react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../../services/supabase';
import usePatientStore from '../../store/usePatientStore';
import useSessionStore from '../../store/useSessionStore';
import { formatExerciseSession } from '../../utils/duration';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';
import { getExerciseVisual } from '../../utils/exerciseVisuals';

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

  const visual = getExerciseVisual(exercise.name);
  const Icon = visual.icon;

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
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(22, 35, 58, 0.55)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />

        {/* Modal Sheet */}
        <View
          style={{
            backgroundColor: palette.canvas,
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
            paddingTop: 8,
            paddingHorizontal: 24,
            paddingBottom: 40,
            maxHeight: '90%',
          }}
        >
          {/* Drag handle */}
          <View
            style={{
              width: 40,
              height: 4,
              backgroundColor: palette.line,
              borderRadius: 99,
              alignSelf: 'center',
              marginBottom: 20,
            }}
          />

          {/* Header Row */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            {/* Icon + Title */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 12 }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: visual.soft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 14,
                }}
              >
                <Icon size={26} color={visual.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontFamily: fonts.serif, fontSize: 24, color: palette.ink, lineHeight: 30 }}
                  numberOfLines={2}
                >
                  {exercise.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Clock size={14} color={palette.inkSoft} />
                  <Text style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: palette.inkSoft }}>
                    {formatExerciseSession(exercise)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Close button */}
            <TouchableOpacity
              onPress={onClose}
              style={{
                backgroundColor: palette.line,
                padding: 8,
                borderRadius: 99,
                marginTop: 2,
              }}
              activeOpacity={0.7}
            >
              <X size={20} color={palette.ink} />
            </TouchableOpacity>
          </View>

          {/* Video Demo — plays when demo_video_path is set, otherwise falls
              back to the original placeholder so future exercises without a
              recording still render the card. */}
          {demoVideoUrl ? (
            <View
              style={{
                width: '100%',
                aspectRatio: 16 / 9,
                borderRadius: 20,
                marginBottom: 20,
                overflow: 'hidden',
                borderWidth: 2,
                borderColor: palette.line,
                backgroundColor: '#000',
              }}
            >
              <VideoView
                player={player}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                nativeControls
                fullscreenOptions={{ enable: true }}
              />
            </View>
          ) : (
            <View
              style={{
                width: '100%',
                aspectRatio: 16 / 9,
                backgroundColor: visual.soft,
                borderRadius: 20,
                marginBottom: 20,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: palette.line,
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: palette.card,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                  shadowColor: palette.ink,
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.08,
                  shadowRadius: 6,
                  elevation: 2,
                }}
              >
                <Play size={28} color={visual.color} />
              </View>
              <Text style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: palette.inkSoft }}>
                Video demonstration
              </Text>
            </View>
          )}

          {/* Instructions */}
          <View
            style={{
              backgroundColor: palette.card,
              borderRadius: 20,
              padding: 18,
              marginBottom: 24,
              borderWidth: 1,
              borderColor: palette.line,
            }}
          >
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 13, color: palette.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Instructions
            </Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 15, color: palette.ink, lineHeight: 23 }}>
              {exercise.description || 'Follow along with the video to safely and effectively perform this exercise.'}
            </Text>
          </View>

          {/* Start Button */}
          <TouchableOpacity
            style={{
              width: '100%',
              backgroundColor: palette.primary,
              minHeight: 64,
              borderRadius: 99,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
            onPress={handleStartExercise}
            activeOpacity={0.85}
          >
            <Text style={{ fontFamily: fonts.sansBold, fontSize: 18, color: '#ffffff' }}>
              Start Exercise
            </Text>
            <ChevronRight size={20} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
