import React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { CheckCircle2, Circle } from 'lucide-react-native';

/**
 * QuestionCard
 *
 * Renders a single onboarding question inside a card.
 * - If the question has options, it renders a selectable list.
 * - If options is empty, it renders a free-text input.
 *
 * Props:
 *   question       – { id, title, options[] } object from the store
 *   selectedOption – the currently selected answer (string | undefined)
 *   onSelect       – called with the chosen option string when the user picks one
 */
export default function QuestionCard({ question, selectedOption, onSelect }) {
  const hasOptions = question.options && question.options.length > 0;

  return (
    <View className="bg-white rounded-[32px] p-6 mb-8 border border-slate-100 shadow-sm elevation-2">
      {/* Question title */}
      <Text className="text-2xl font-extrabold text-slate-900 mb-8">
        {question.title}
      </Text>

      <View className="gap-3">
        {hasOptions ? (
          // Render a tappable row for each answer choice
          question.options.map((option, index) => {
            const isSelected = selectedOption === option;

            return (
              <Pressable
                key={index}
                onPress={() => onSelect(option)}
                className={`flex-row items-center justify-between p-5 rounded-2xl border-2 ${
                  isSelected
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-slate-50 border-slate-100'
                }`}
              >
                <Text
                  className={`text-lg font-bold ${
                    isSelected ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {option}
                </Text>

                {/* Checkmark icon when selected, empty circle when not */}
                {isSelected ? (
                  <CheckCircle2 color="white" size={24} strokeWidth={2.5} />
                ) : (
                  <Circle color="#cbd5e1" size={24} strokeWidth={2.5} />
                )}
              </Pressable>
            );
          })
        ) : (
          // Free-text input for questions without preset options (e.g. name)
          <TextInput
            className="bg-slate-50 border-2 border-slate-100 rounded-2xl p-5 text-lg font-semibold text-slate-900"
            placeholder="Type your answer here..."
            placeholderTextColor="#94a3b8"
            value={selectedOption || ''}
            onChangeText={onSelect}
            autoFocus
          />
        )}
      </View>
    </View>
  );
}
