import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';




const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const BUCKET = 'exercise-audio';
const PREFIX = 'voice';
const PUBLIC_BASE = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PREFIX}`;

// Minimum gap between two spoken cues, so rapid band-flapping can't stutter.
const COOLDOWN_MS = 2500;

// Supabase is behind a Cloudflare tunnel that 1010-blocks non-browser
// User-Agents, so the manifest fetch AND the audio requests must send one
// (same fix as the session-evidence Storage calls).
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// A manifest key is relevant to an exercise if it's that exercise's own cue
// (<slug>.*) or one of the shared gate.* / fallback.* cues.
const keyMatchesExercise = (key, slug) =>
  !!slug && (key.startsWith(`${slug}.`) || key.startsWith('gate.') || key.startsWith('fallback.'));

export default function useVoicePlayback(exerciseType) {
  const slug = String(exerciseType || '').trim().toLowerCase();
  const [muted, setMuted] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);

  const playersRef = useRef(new Map()); // hint_key -> AudioPlayer
  const mutedRef = useRef(false);
  const lastKeyRef = useRef(null);
  const lastPlayMsRef = useRef(0);

  useEffect(() => {
    mutedRef.current = muted;
    // Re-arm on unmute — otherwise a cue that was already "current" when the
    // patient muted never plays again until the hint_key actually changes.
    if (!muted) lastKeyRef.current = null;
  }, [muted]);

  // Configure the audio session once: audible even on the iOS silent switch
  // (it's coaching feedback), and duck — not stop — any music the patient has.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
    }).catch(() => { /* non-fatal — playback still works */ });
  }, []);

  // Load the manifest and preload this exercise's clips when the exercise
  // changes. Preloading means the cue fires instantly instead of paying a
  // network+decode delay at trigger time.
  useEffect(() => {
    let cancelled = false;
    const players = playersRef.current;

    const dispose = () => {
      players.forEach((p) => { try { p.remove(); } catch (_) { /* already gone */ } });
      players.clear();
    };

    async function load() {
      dispose();
      setVoiceReady(false);
      lastKeyRef.current = null;
      if (!SUPABASE_URL || !slug) return;
      try {
        const res = await fetch(`${PUBLIC_BASE}/manifest.json`, {
          cache: 'no-cache',
          headers: { 'User-Agent': BROWSER_UA },      // pass the CF tunnel
        });
        if (!res.ok || cancelled) return;             // no manifest yet -> text-only
        const manifest = await res.json();
        const clips = manifest?.clips || {};
        if (cancelled) return;
        Object.entries(clips).forEach(([key, meta]) => {
          if (!meta?.available) return;               // not generated yet
          if (!keyMatchesExercise(key, slug)) return;
          try {
            players.set(key, createAudioPlayer({
              uri: `${PUBLIC_BASE}/${meta.file}`,
              headers: { 'User-Agent': BROWSER_UA },  // pass the CF tunnel
            }));
          } catch (_) { /* skip a bad clip; the rest still work */ }
        });
        if (!cancelled) setVoiceReady(players.size > 0);
      } catch (_) {
        /* offline / no manifest -> graceful text-only fallback */
      }
    }

    load();
    return () => { cancelled = true; dispose(); };
  }, [slug]);

  // Call this every pose frame with result.hint_key. It internally decides
  // whether to actually speak (edge-trigger + cooldown + no-interrupt).
  const playHintKey = useCallback((hintKey) => {
    if (!hintKey || mutedRef.current) return;
    const player = playersRef.current.get(hintKey);
    if (!player) return;                              // no clip -> text-only
    if (hintKey === lastKeyRef.current) return;       // only on change
    const now = Date.now();
    if (now - lastPlayMsRef.current < COOLDOWN_MS) return;
    if (player.playing) return;                       // don't talk over a clip
    try {
      player.seekTo(0);
      player.play();
      lastKeyRef.current = hintKey;
      lastPlayMsRef.current = now;
    } catch (_) { /* playback hiccup is non-fatal */ }
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  return { playHintKey, muted, toggleMute, voiceReady };
}
