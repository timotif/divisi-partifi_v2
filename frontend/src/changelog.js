// Public-facing release notes shown on the landing page.
// Newest first. Keep entries plain-language: what changed for the person
// using Divisi, never how it works inside.
// type: 'feature' | 'fix'

export const CHANGELOG = [
  {
    date: '2026-08-16',
    type: 'feature',
    text: 'Keep several versions of a score. Start a new one at any point, and switch between them while you work.',
  },
  {
    date: '2026-08-16',
    type: 'feature',
    text: 'Download finished parts straight from the library, and see which version they came from.',
  },
  {
    date: '2026-08-16',
    type: 'fix',
    text: 'Version names keep their accents, so "Fauré" stays "Fauré".',
  },
  {
    date: '2026-08-16',
    type: 'feature',
    text: 'Instrument names follow the whole score, so turning a page keeps the order you set.',
  },
  {
    date: '2026-08-16',
    type: 'feature',
    text: 'Choose which pages of a score to work on, and leave out the rest.',
  },
  {
    date: '2026-08-14',
    type: 'feature',
    text: 'Undo your last divider change with Ctrl+Z.',
  },
  {
    date: '2026-08-14',
    type: 'feature',
    text: 'Divider lines settle into the clear space between staves as you place them.',
  },
  {
    date: '2026-08-14',
    type: 'fix',
    text: 'Clicking near an existing divider no longer adds an extra one by mistake.',
  },
  {
    date: '2026-08-10',
    type: 'fix',
    text: 'Staves are found more reliably on dense pages and pages with several systems.',
  },
  {
    date: '2026-08-08',
    type: 'fix',
    text: 'Long scores keep their page controls in view instead of running off the edge.',
  },
  {
    date: '2026-08-02',
    type: 'feature',
    text: 'Your scores are saved to a library, so you can pick up where you left off.',
  },
];
