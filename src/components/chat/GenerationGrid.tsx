import type { Generation } from '@/types';
import { GenerationCard, getGenerationAspectRatio } from './GenerationCard';
import styles from './ImageVideo.module.css';

interface GenerationGridProps {
  generations: Generation[];
  itemsPerRow: number;
  onSelect: (generation: Generation) => void;
  onCopyPrompt: (prompt: string) => void;
}

export function GenerationGrid({ generations, itemsPerRow, onSelect, onCopyPrompt }: GenerationGridProps) {
  const rows = Array.from({ length: Math.ceil(generations.length / itemsPerRow) }, (_, index) =>
    generations.slice(index * itemsPerRow, (index + 1) * itemsPerRow),
  );

  return (
    <div className={styles.grid}>
      {rows.map(row => {
        const ratios = row.map(getGenerationAspectRatio);
        // Keep an incomplete final row at a normal height by reserving its empty slots.
        const averageRatio = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
        const tracks = Array.from({ length: itemsPerRow }, (_, index) => ratios[index] ?? averageRatio);
        return (
          <div key={row[0].id} className={styles.row} style={{ gridTemplateColumns: tracks.map(ratio => `minmax(0, ${ratio}fr)`).join(' ') }}>
            {row.map(generation => (
              <GenerationCard key={generation.id} generation={generation} onClick={() => onSelect(generation)} onCopyPrompt={onCopyPrompt} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
