// Color tokens lifted from theramotion-redesign.html. Kept flat (plain hex)
// rather than routed through tailwind.config.js since the rest of the app
// already uses arbitrary-value classes (`bg-[#0c56d0]`) instead of theme
// extension — this just gives that pattern named values to import instead
// of re-typing hex codes at every call site.
export const palette = {
  ink: '#16233A',
  inkSoft: '#5B6B7F',
  canvas: '#F3F1EC',
  card: '#FFFFFF',
  primary: '#1B4D4A',
  primaryDeep: '#0F332F',
  primarySoft: '#E4EDEC',
  coral: '#E07856',
  coralSoft: '#FBE7DF',
  sage: '#5E8C6A',
  sageSoft: '#E3EFE4',
  amber: '#C99A3E',
  amberSoft: '#F6EBD6',
  line: '#E4E0D6',
};

// Score -> tone mapping shared by activity cards and progress panels.
// Sage/amber only, no red — the mockup never uses coral for a "bad"
// signal, it reserves coral for CTA/accent elements. Red reads as
// "failure/danger", the wrong signal for a rehab app.
export const scoreTone = (score) => (score >= 70 ? palette.sage : palette.amber);
