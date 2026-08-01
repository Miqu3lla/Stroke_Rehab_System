import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react-native';
import usePatientStore from '../store/usePatientStore';
import useSessionStore from '../store/useSessionStore';
import { supabase } from '../services/supabase';

// This screen shows the user's score after they finish their workout.
// It displays which exercises were completed and which ones were skipped.
const SessionSummaryScreen = ({ route, navigation }) => {
  const { session, clearSession } = useSessionStore();
  const { fetchRecommendation } = usePatientStore();
  const saveResult = route?.params?.saveResult;

  // Match each exercise in the playlist with its final score.
  // We use the position in the list (index) to make sure we don't mix up
  // scores if the same exercise appears twice in the workout.
  const resultsByIndex = new Map(
    (session.results || []).map((r) => [r.session_index, r]),
  );
  const slots = (session.playlist || []).map((exercise, index) => ({
    index,
    exercise,
    result: resultsByIndex.get(index), // may be undefined → skipped
  }));

  const scoredResults = slots.filter((s) => s.result).map((s) => s.result);
  const completedCount = scoredResults.length;
  const totalCount = slots.length;
  const overallScore = completedCount > 0
    ? Math.round(scoredResults.reduce((sum, r) => sum + (r.avg_form_score || 0), 0) / completedCount)
    : 0;

  const handleDone = () => {
    clearSession();
    // Fetch new exercise recommendations based on how well the user just did,
    // so the dashboard is up-to-date when they go back. force:true bypasses
    // the query cache since the recommendation genuinely changed server-side.
    fetchRecommendation({ force: true });
    navigation.replace('Dashboard');
  };

  const [previousScores, setPreviousScores] = useState({});

  // If there's no active workout session, send the user back to the dashboard
  useEffect(() => {
    if (!session.sessionId && (!session.playlist || session.playlist.length === 0)) {
      navigation.replace('Dashboard');
    }
  }, []);

  // Fetch previous scores for comparison
  useEffect(() => {
    const fetchPreviousScores = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('recommendation_logs')
          .select('latest_form_score, recommendation, created_at')
          .eq('patient_id', user.id)
          .gt('latest_form_score', 0)
          .order('created_at', { ascending: false });

        if (error) throw error;

        const prev = {};
        for (const row of data) {
          const rec = row.recommendation;
          if (!rec) continue;
          
          // Skip the session we literally just completed
          if (rec.session_id === session.sessionId) continue;
          
          const exId = rec.recommendation_id;
          if (exId && prev[exId] === undefined) {
             prev[exId] = row.latest_form_score;
          }
        }
        setPreviousScores(prev);
      } catch (err) {
        console.error("Failed to fetch previous scores:", err);
      }
    };

    if (session.sessionId) {
      fetchPreviousScores();
    }
  }, [session.sessionId]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#faf8ff' }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text className="text-[#191b23] text-3xl font-black mt-4 mb-1">Session Complete</Text>
      <Text className="text-[#434654] text-base font-medium mb-6">
        {completedCount} of {totalCount} {totalCount === 1 ? 'exercise' : 'exercises'} completed
      </Text>

      {/* Overall score ring */}
      <View className="items-center mb-8">
        <View
          className="w-40 h-40 rounded-full items-center justify-center border-8 bg-white"
          style={{ borderColor: overallScore >= 85 ? '#4CAF50' : overallScore >= 60 ? '#FFC107' : '#FF5252' }}
        >
          <Text className="text-[#191b23] text-5xl font-black">{overallScore}%</Text>
          <Text className="text-[#434654] text-xs font-bold mt-1">AVERAGE</Text>
        </View>
      </View>

      <View className="gap-3 mb-6">
        {slots.map((slot) => (
          <ResultRow key={slot.index} slot={slot} previousScore={previousScores[slot.exercise.id]} />
        ))}
      </View>

      {/* Warning message shown if the scores couldn't be saved to the server */}
      {saveResult && !saveResult.ok ? (
        <View className="flex-row items-center bg-[#fff4e5] border border-[#FFC107] rounded-xl p-4 mb-6">
          <AlertTriangle size={20} color="#b86e00" />
          <Text className="text-[#7a4a00] text-sm font-medium ml-2 flex-1">
            Results couldn't sync to the server. Your scores are still visible here, but tomorrow's recommendation won't reflect this session.
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        className="bg-[#0c56d0] rounded-full min-h-[60px] items-center justify-center active:bg-[#0a46a8]"
        onPress={handleDone}
      >
        <Text className="text-white text-lg font-bold">Back to Dashboard</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const ResultRow = ({ slot, previousScore }) => {
  const { exercise, result, index } = slot;

  if (!result) {
    return (
      <View className="flex-row items-center bg-[#ededf8] border border-[#e7e7f2] rounded-xl p-4">
        <XCircle size={22} color="#8a8d9b" />
        <View className="flex-1 ml-3">
          <Text className="text-[#191b23] font-bold text-base" numberOfLines={1}>
            {index + 1}. {exercise.name}
          </Text>
          <Text className="text-[#8a8d9b] text-sm font-medium">Skipped</Text>
        </View>
      </View>
    );
  }

  const score = Math.round(Number(result.avg_form_score) || 0);
  const tone = score >= 85 ? '#4CAF50' : score >= 60 ? '#FFC107' : '#FF5252';
  const isEarly = result.ended_via === 'end_early';
  
  let diffElement = null;
  if (previousScore !== undefined) {
    const prevScoreRounded = Math.round(previousScore);
    const diff = score - prevScoreRounded;
    if (diff > 0) {
      diffElement = <Text className="text-[#4CAF50] text-xs font-bold mt-0.5">+{diff}% better on average</Text>;
    } else if (diff < 0) {
      diffElement = <Text className="text-[#FF5252] text-xs font-bold mt-0.5">{Math.abs(diff)}% less on average</Text>;
    } else {
      diffElement = <Text className="text-[#8a8d9b] text-xs font-bold mt-0.5">Same as before</Text>;
    }
  }

  return (
    <View className="flex-row items-center bg-white border-2 rounded-xl p-4" style={{ borderColor: tone }}>
      <CheckCircle2 size={22} color={tone} />
      <View className="flex-1 ml-3">
        <Text className="text-[#191b23] font-bold text-base" numberOfLines={1}>
          {index + 1}. {exercise.name}
        </Text>
        {isEarly ? (
          <Text className="text-[#8a8d9b] text-xs font-medium mt-0.5">Ended early</Text>
        ) : diffElement}
      </View>
      <Text className="text-[#191b23] text-2xl font-black" style={{ color: tone }}>
        {score}%
      </Text>
    </View>
  );
};

export default SessionSummaryScreen;
