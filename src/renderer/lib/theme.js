// Appearance presets. Tone is the base palette for surfaces and text,
// accent is the highlight color; each works in both dark and light and the
// values live in global.css keyed by data-tone / data-accent attributes.

export const TONES = [
  { id: 'warm', label: 'Warm' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'cool', label: 'Cool' },
  { id: 'ink', label: 'Ink' },
]

// Swatch colors are the dark-theme values, used for the picker preview
export const ACCENTS = [
  { id: 'coral', label: 'Coral', swatch: '#ff7a59' },
  { id: 'amber', label: 'Amber', swatch: '#f5b342' },
  { id: 'sage', label: 'Sage', swatch: '#8fd3a6' },
  { id: 'sky', label: 'Sky', swatch: '#7cc4ff' },
  { id: 'lavender', label: 'Lavender', swatch: '#b9a7ff' },
  { id: 'rose', label: 'Rose', swatch: '#ff8fb1' },
  { id: 'mono', label: 'Mono', swatch: '#e8e2da' },
]

export const DEFAULT_TONE = 'warm'
export const DEFAULT_ACCENT = 'coral'

export function applyTone(tone) {
  document.documentElement.dataset.tone = TONES.some(t => t.id === tone) ? tone : DEFAULT_TONE
}

export function applyAccent(accent) {
  document.documentElement.dataset.accent = ACCENTS.some(a => a.id === accent) ? accent : DEFAULT_ACCENT
}

export async function loadAppearance() {
  const [tone, accent] = await Promise.all([
    window.api.store.get('tone'),
    window.api.store.get('accent'),
  ])
  return { tone: tone || DEFAULT_TONE, accent: accent || DEFAULT_ACCENT }
}
