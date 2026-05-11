import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import usePatientStore from '../store/usePatientStore';

const RecommendationCard = ({ navigation }) => {
  const {
    recommendedExercises,
    recommendationLoading,
    recommendationError,
    startExercise,
  } = usePatientStore();

  if (recommendationLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading your exercise options...</Text>
      </View>
    );
  }

  if (recommendationError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Unable to load recommendations</Text>
      </View>
    );
  }

  if (!recommendedExercises || recommendedExercises.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>No exercise recommendations yet</Text>
      </View>
    );
  }

  const handleStartExercise = async (exercise) => {
    await startExercise(exercise, navigation);
  };

  return (
    <View style={styles.container}>
      {recommendedExercises.map((exercise, index) => (
        <View key={exercise.id} style={styles.card}>
          {/* Exercise Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{exercise.name}</Text>
            <View style={styles.levelBadge}>
              <Text style={styles.levelText}>
                {'⭐'.repeat(exercise.level)}
              </Text>
            </View>
          </View>

          {/* Exercise Image/Placeholder */}
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>Exercise Video</Text>
          </View>

          {/* Exercise Description */}
          <Text style={styles.description}>
            {exercise.description}
          </Text>

          {/* Exercise Duration */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Duration:</Text>
            <Text style={styles.infoValue}>
              {exercise.duration_minutes} minutes
            </Text>
          </View>

          {/* Primary CTA Button */}
          <TouchableOpacity
            style={styles.button}
            onPress={() => handleStartExercise(exercise)}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>Do This Exercise</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
    marginHorizontal: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  levelBadge: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  levelText: {
    fontSize: 14,
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#f0f0f0',
  },
  imagePlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholderText: {
    fontSize: 16,
    color: '#1976d2',
    fontWeight: '500',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    lineHeight: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  infoLabel: {
    fontSize: 13,
    color: '#999',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#f44336',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 24,
  },
});

export default RecommendationCard;
