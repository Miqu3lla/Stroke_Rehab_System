// Password policy rules and validation helper for user signup.
// Requires: at least 8 characters, 1 uppercase letter, and 1 number.

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

// Validates a password against PASSWORD_RULES.
// Returns { ok: boolean, failed: string[] } where failed contains labels of violated rules.
export function validatePassword(pw) {
  const failed = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.label);
  return { ok: failed.length === 0, failed };
}
