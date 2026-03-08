const DEFAULT_SEQ_GAP_DRAIN_DELAY_MS = 80;

export interface InboundEnvelopeTracker {
  trackInboundSeq(source: string, inboundSeq: number): void;
  isDuplicate(envelopeId: string): boolean;
  remember(envelopeId: string): void;
  clearSourceHighWatermark(): void;
  dispose(): void;
}

export function createInboundEnvelopeTracker(params: {
  maxProcessedInboundEnvelopeIds: number;
  onSeqGapDrain: () => void;
  seqGapDrainDelayMs?: number;
}): InboundEnvelopeTracker {
  const processedInboundEnvelopeIds = new Map<string, number>();
  const inboundHighestSeqBySource = new Map<string, number>();
  let seqGapDrainTimer: ReturnType<typeof setTimeout> | null = null;
  const seqGapDrainDelayMs = Number.isFinite(params.seqGapDrainDelayMs)
    ? Math.max(0, Math.floor(params.seqGapDrainDelayMs ?? DEFAULT_SEQ_GAP_DRAIN_DELAY_MS))
    : DEFAULT_SEQ_GAP_DRAIN_DELAY_MS;

  const scheduleSeqGapDrain = (source: string, expectedNext: number, actual: number) => {
    console.warn(
      `[remote] 检测到 inbound seq 缺口 source=${source} expected>${expectedNext} got=${actual}`,
    );
    if (seqGapDrainTimer) return;
    seqGapDrainTimer = setTimeout(() => {
      seqGapDrainTimer = null;
      params.onSeqGapDrain();
    }, seqGapDrainDelayMs);
  };

  const remember = (envelopeId: string) => {
    processedInboundEnvelopeIds.set(envelopeId, Date.now());
    if (processedInboundEnvelopeIds.size > params.maxProcessedInboundEnvelopeIds) {
      const oldest = processedInboundEnvelopeIds.keys().next().value as string | undefined;
      if (oldest) processedInboundEnvelopeIds.delete(oldest);
    }
  };

  return {
    trackInboundSeq(source: string, inboundSeq: number) {
      const previous = inboundHighestSeqBySource.get(source) ?? 0;
      if (inboundSeq > previous + 1) {
        scheduleSeqGapDrain(source, previous + 1, inboundSeq);
      }
      if (inboundSeq > previous) inboundHighestSeqBySource.set(source, inboundSeq);
    },
    isDuplicate(envelopeId: string) {
      return processedInboundEnvelopeIds.has(envelopeId);
    },
    remember,
    clearSourceHighWatermark() {
      inboundHighestSeqBySource.clear();
    },
    dispose() {
      if (seqGapDrainTimer) {
        clearTimeout(seqGapDrainTimer);
        seqGapDrainTimer = null;
      }
      processedInboundEnvelopeIds.clear();
      inboundHighestSeqBySource.clear();
    },
  };
}
