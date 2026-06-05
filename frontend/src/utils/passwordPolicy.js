// Signup password policy (2026-06-05). Replaces the previous "at least
// 6 characters" check, which let `123456`, `qwerty`, `password` through.
//
// Floor for new patient accounts: 8 chars + 1 uppercase + 1 number.
// Deliberately no symbol requirement and no banned-words list — the
// patient population skews motor/cognitive-impaired and mobile typing
// is already a barrier; we want a real-bar-not-a-frustration-bar.
//
// The same SignupCard checklist + handleSignUp gate import from here so
// the UI and the final validation never drift from each other.

export const PASSWORD_RULES = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (pw) => typeof pw === 'string' && pw.length >= 8,
  },
  {
    id: 'upper',
    label: 'At least 1 uppercase letter',
    test: (pw) => typeof pw === 'string' && /[A-Z]/.test(pw),
  },
  {
    id: 'number',
    label: 'At least 1 number',
    test: (pw) => typeof pw === 'string' && /[0-9]/.test(pw),
  },
];

// Returns { ok, failed } — `failed` is the list of rule LABELS the
// password violates, ready to surface in an Alert. Empty failed array
// means the password meets every rule.
export function validatePassword(pw) {
  const failed = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.label);
  return { ok: failed.length === 0, failed };
}
