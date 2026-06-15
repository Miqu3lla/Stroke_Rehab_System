import React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { CheckCircle2, Circle } from 'lucide-react-native';

/**
 * QuestionCard
 *
 * Renders a single onboarding question inside a card. Three rendering
 * modes:
 *   1. options[]   → tappable choice list (one selection per step)
 *   2. fields[]    → multiple text inputs on one card (e.g. first +
 *                    last name, so the patient doesn't go through two
 *                    consecutive screens)
 *   3. fallback    → single free-text input (one input per step)
 *
 * Props:
 *   question        – { id, title, options[], fields?[] }
 *   selectedOption  – current answer for the single-input/options path
 *   onSelect        – called with the chosen value (single-input/options)
 *   answers         – flat object of all answers keyed by id (needed for
 *                     fields[] to read each input's current value)
 *   setFieldAnswer  – (fieldId, value) writer for fields[] inputs
 */
export default function QuestionCard({
  question,
  selectedOption,
  onSelect,
  answers,
  setFieldAnswer,
}) {
  const hasOptions = question.options && question.options.length > 0;
  const hasFields = Array.isArray(question.fields) && question.fields.length > 0;

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
        ) : hasFields ? (
          // Multi-input card: stack each field as its own labeled input.
          // The patient sees one screen with all inputs, no Back/Next ping-
          // ponging between conceptually-paired questions.
          question.fields.map((field, index) => (
            <TextInput
              key={field.id}
              className="bg-slate-50 border-2 border-slate-100 rounded-2xl p-5 text-lg font-semibold text-slate-900"
              placeholder={field.placeholder}
              placeholderTextColor="#94a3b8"
              value={(answers && answers[field.id]) || ''}
              onChangeText={(text) => setFieldAnswer(field.id, text)}
              autoFocus={index === 0}
            />
          ))
        ) : (
          // Free-text input for questions without preset options
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
