import { memo, type CSSProperties } from 'react';
import styles from './RecordingSessionThumbnail.module.css';

type Hues = readonly [number, number, number, number];

// Local subject matching keeps thumbnails instant, private, and free of API calls.
const SUBJECTS: ReadonlyArray<{ words: RegExp; hues: Hues }> = [
  { words: /\b(autumn|fall|sunset|sunrise|desert|fire|warm|golden|acoustic|folk|country|otono|amanecer)\b/g, hues: [12, 32, 49, 350] },
  { words: /\b(ocean|sea|water|rain|river|wave|waves|beach|coastal|underwater|mar|lluvia)\b/g, hues: [192, 214, 170, 242] },
  { words: /\b(forest|nature|garden|earth|jungle|spring|botanical|leaves|green|bosque|selva)\b/g, hues: [147, 175, 87, 120] },
  { words: /\b(winter|snow|ice|frost|arctic|glacier|cold|invierno|nieve)\b/g, hues: [200, 225, 179, 260] },
  { words: /\b(love|romantic|romance|rose|roses|heart|wedding|tender|amor)\b/g, hues: [344, 320, 283, 17] },
  { words: /\b(night|midnight|moon|space|cosmic|stars|dark|nocturne|noche)\b/g, hues: [239, 274, 205, 310] },
  { words: /\b(ambient|calm|meditation|dream|dreamy|sleep|peaceful|soft|ethereal|chill|lofi)\b/g, hues: [173, 211, 260, 292] },
  { words: /\b(summer|sunshine|tropical|happy|bright|playful|dance|pop|party|upbeat|verano)\b/g, hues: [34, 52, 333, 283] },
  { words: /\b(electronic|synth|synths|techno|neon|cyber|digital|future|city|urban)\b/g, hues: [187, 248, 296, 155] },
  { words: /\b(jazz|soul|blues|vintage|retro|vinyl|lounge|brass)\b/g, hues: [30, 354, 263, 48] },
  { words: /\b(cinematic|epic|orchestra|orchestral|dramatic|film|adventure|strings|piano)\b/g, hues: [210, 259, 340, 38] },
];

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function gradientStyle(id: string, title: string): CSSProperties {
  const subject = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const titleHue = hash(subject) % 360;
  let hues: Hues = [titleHue, titleHue + 35, titleHue + 75, titleHue - 30];
  let bestScore = 0;
  for (const palette of SUBJECTS) {
    const score = subject.match(palette.words)?.length ?? 0;
    if (score > bestScore) { hues = palette.hues; bestScore = score; }
  }

  // An ID-based tint and phase distinguish even sessions with identical titles.
  const seed = hash(id);
  const tint = seed % 17 - 8;
  const colors = hues.map((hue, index) => {
    const variation = hash(`${id}:${index}`);
    return `hsl(${(hue + tint + 360) % 360} ${60 + variation % 16}% ${53 + (variation >>> 8) % 13}%)`;
  });
  return {
    '--session-color-1': colors[0],
    '--session-color-2': colors[1],
    '--session-color-3': colors[2],
    '--session-color-4': colors[3],
    '--session-duration': `${18 + seed % 13}s`,
    '--session-phase': `-${seed % 18000}ms`,
  } as CSSProperties;
}

export const RecordingSessionThumbnail = memo(function RecordingSessionThumbnail({ id, title }: { id: string; title: string }) {
  return <span aria-hidden="true" className={styles.thumbnail} style={gradientStyle(id, title)} />;
});
