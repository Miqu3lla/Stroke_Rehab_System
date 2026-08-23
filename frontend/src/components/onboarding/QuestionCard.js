import React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { CheckCircle2, Circle } from 'lucide-react-native';
import { palette } from '../../constants/palette';
import { fonts } from '../../constants/fonts';

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
    <View
      style={{
        backgroundColor: palette.card,
        borderRadius: 28,
        padding: 24,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: palette.line,
        shadowColor: palette.ink,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      {/* Question title */}
      <Text
        style={{
          fontFamily: fonts.serif,
          fontSize: 24,
          color: palette.ink,
          marginBottom: 24,
          lineHeight: 32,
        }}
      >
        {question.title}
      </Text>

      <View style={{ gap: 12 }}>
        {hasOptions ? (
          // Render a tappable row for each answer choice
          question.options.map((option, index) => {
            const isSelected = selectedOption === option;

            return (
              <Pressable
                key={index}
                onPress={() => onSelect(option)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 16,
                  paddingHorizontal: 20,
                  borderRadius: 18,
                  borderWidth: 2,
                  backgroundColor: isSelected
                    ? palette.primary
                    : pressed
                      ? palette.primarySoft
                      : palette.canvas,
                  borderColor: isSelected ? palette.primary : palette.line,
                  opacity: pressed && !isSelected ? 0.85 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily: fonts.sansSemibold,
                    fontSize: 16,
                    color: isSelected ? '#ffffff' : palette.ink,
                    flex: 1,
                    marginRight: 8,
                  }}
                >
                  {option}
                </Text>

                {/* Checkmark icon when selected, empty circle when not */}
                {isSelected ? (
                  <CheckCircle2 color="#ffffff" size={22} strokeWidth={2.5} />
                ) : (
                  <Circle color={palette.line} size={22} strokeWidth={2.5} />
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
              style={{
                backgroundColor: palette.canvas,
                borderWidth: 2,
                borderColor: palette.line,
                borderRadius: 18,
                padding: 18,
                fontSize: 16,
                color: palette.ink,
                fontFamily: fonts.sansMedium,
              }}
              placeholder={field.placeholder}
              placeholderTextColor={palette.inkSoft}
              value={(answers && answers[field.id]) || ''}
              onChangeText={(text) => setFieldAnswer(field.id, text)}
              autoFocus={index === 0}
            />
          ))
        ) : (
          // Free-text input for questions without preset options
          <TextInput
            style={{
              backgroundColor: palette.canvas,
              borderWidth: 2,
              borderColor: palette.line,
              borderRadius: 18,
              padding: 18,
              fontSize: 16,
              color: palette.ink,
              fontFamily: fonts.sansMedium,
            }}
            placeholder="Type your answer here..."
            placeholderTextColor={palette.inkSoft}
            value={selectedOption || ''}
            onChangeText={onSelect}
            autoFocus
          />
        )}
      </View>
    </View>
  );
}
