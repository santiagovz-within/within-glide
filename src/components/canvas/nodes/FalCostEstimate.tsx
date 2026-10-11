'use client';

import { useFalCostEstimate } from '@/lib/useFalCostEstimate';
import type { FalCostEstimateInput } from '@/lib/falPricing';
import styles from './ImageGenerationGlass.module.css';

interface FalCostEstimateProps {
  input: FalCostEstimateInput | FalCostEstimateInput[] | null;
  description?: string;
  unavailableText?: string;
}

export default function FalCostEstimate({ input, description, unavailableText }: FalCostEstimateProps) {
  const estimate = useFalCostEstimate(input);
  if (!estimate && !unavailableText) return null;
  return <span className={styles.costEstimate} title={estimate ? description : 'Waiting for pricing or reference media metadata.'}>{estimate ?? unavailableText}</span>;
}
