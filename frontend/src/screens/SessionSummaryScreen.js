import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { CheckCircle2, XCircle, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react-native';
import usePatientStore from '../store/usePatientStore';
import useSessionStore from '../store/useSessionStore';
import { supabase } from '../services/supabase';
import { palette, scoreTone } from '../constants/palette';
import { fonts } from '../constants/fonts';

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
    // reset (not replace) so the Dashboard/Sessions screens buried under this
    // one actually unmount, instead of piling up as ghost instances every workout.
    navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
  };

  const [previousScores, setPreviousScores] = useState({});

  // If there's no active workout session, send the user back to the dashboard
  useEffect(() => {
    if (!session.sessionId && (!session.playlist || session.playlist.length === 0)) {
      navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
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

  const overallTone = scoreTone(overallScore);
  const overallToneSoft = overallScore >= 70 ? palette.sageSoft : palette.amberSoft;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.canvas }}
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
    >
      {/* Header */}
      <Text
        style={{ fontFamily: fonts.serif, fontSize: 34, color: palette.ink, marginTop: 16, marginBottom: 4 }}
      >
        Session Complete
      </Text>
      <Text style={{ fontFamily: fonts.sansMedium, fontSize: 15, color: palette.inkSoft, marginBottom: 28 }}>
        {completedCount} of {totalCount} {totalCount === 1 ? 'exercise' : 'exercises'} completed
      </Text>

      {/* Overall score ring */}
      <View style={{ alignItems: 'center', marginBottom: 32 }}>
        <View
          style={{
            width: 160,
            height: 160,
            borderRadius: 80,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 8,
            borderColor: overallTone,
            backgroundColor: overallToneSoft,
          }}
        >
          <Text style={{ fontFamily: fonts.monoSemibold, fontSize: 46, color: palette.ink, lineHeight: 50 }}>
            {overallScore}%
          </Text>
          <Text style={{ fontFamily: fonts.sansSemibold, fontSize: 10, color: palette.inkSoft, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1.2 }}>
            Average
          </Text>
        </View>
      </View>

      {/* Exercise result rows */}
      <View style={{ gap: 12, marginBottom: 24 }}>
        {slots.map((slot) => (
          <ResultRow key={slot.index} slot={slot} previousScore={previousScores[slot.exercise.id]} />
        ))}
      </View>

      {/* Warning message shown if the scores couldn't be saved to the server */}
      {saveResult && !saveResult.ok ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: palette.amberSoft, borderWidth: 1, borderColor: palette.amber, borderRadius: 18, padding: 16, marginBottom: 24 }}>
          <AlertTriangle size={20} color={palette.amber} />
          <Text style={{ fontFamily: fonts.sansMedium, fontSize: 13, color: palette.ink, marginLeft: 10, flex: 1 }}>
            Results couldn't sync to the server. Your scores are still visible here, but tomorrow's recommendation won't reflect this session.
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={{ backgroundColor: palette.primary, borderRadius: 99, minHeight: 60, alignItems: 'center', justifyContent: 'center' }}
        onPress={handleDone}
        activeOpacity={0.85}
      >
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 17, color: '#ffffff' }}>
          Back to Dashboard
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const ResultRow = ({ slot, previousScore }) => {
  const { exercise, result, index } = slot;

  if (!result) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: palette.canvas, borderWidth: 1.5, borderColor: palette.line, borderRadius: 18, padding: 16 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: palette.line, alignItems: 'center', justifyContent: 'center' }}>
          <XCircle size={20} color={palette.inkSoft} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 15, color: palette.ink }} numberOfLines={1}>
            {index + 1}. {exercise.name}
          </Text>
          <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: palette.inkSoft, marginTop: 2 }}>
            Skipped
          </Text>
        </View>
      </View>
    );
  }

  const score = Math.round(Number(result.avg_form_score) || 0);
  const tone = scoreTone(score);
  const toneSoft = score >= 70 ? palette.sageSoft : palette.amberSoft;
  const isEarly = result.ended_via === 'end_early';

  let diffElement = null;
  if (previousScore !== undefined) {
    const prevScoreRounded = Math.round(previousScore);
    const diff = score - prevScoreRounded;
    if (diff > 0) {
      diffElement = (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <TrendingUp size={12} color={palette.sage} />
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 11, color: palette.sage }}>+{diff}% better on average</Text>
        </View>
      );
    } else if (diff < 0) {
      diffElement = (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <TrendingDown size={12} color={palette.amber} />
          <Text style={{ fontFamily: fonts.sansBold, fontSize: 11, color: palette.amber }}>{Math.abs(diff)}% less on average</Text>
        </View>
      );
    } else {
      diffElement = (
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 11, color: palette.inkSoft, marginTop: 2 }}>Same as before</Text>
      );
    }
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: palette.card, borderWidth: 2, borderColor: tone, borderRadius: 18, padding: 16 }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: toneSoft, alignItems: 'center', justifyContent: 'center' }}>
        <CheckCircle2 size={20} color={tone} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontFamily: fonts.sansBold, fontSize: 15, color: palette.ink }} numberOfLines={1}>
          {index + 1}. {exercise.name}
        </Text>
        {isEarly ? (
          <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: palette.inkSoft, marginTop: 2 }}>Ended early</Text>
        ) : diffElement}
      </View>
      <Text style={{ fontFamily: fonts.monoSemibold, fontSize: 22, color: tone }}>
        {score}%
      </Text>
    </View>
  );
};

export default SessionSummaryScreen;
