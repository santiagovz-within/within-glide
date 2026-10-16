'use client';

import type {
  GenerationFailure,
  ImageGenNodeData,
  NodeData,
  NodeType,
  VideoGenNodeData,
} from '@/types';
import { useFlowStore } from '@/lib/stores/flowStore';
import { playSuccessSound } from '@/lib/utils/sound';
import { generationIdentity, isTerminalNode } from '@/lib/generationReconciliation';
import { preserveImageBatch } from '@/lib/imageGenerationResults';
import {
  generationJobId,
  type BackgroundGenerationJob,
  type BackgroundGenerationKind,
  type BackgroundGenerationRequest,
  useGenerationStore,
} from '@/lib/stores/generationStore';

interface ImageGenerationResponse {
  mediaUrls?: string[];
  requests?: Array<{ requestId: string; endpoint: string }>;
  error?: string;
  details?: string;
}

interface VideoGenerationResponse {
  mediaUrls?: string[];
  requestId?: string;
  endpoint?: string;
  error?: string;
  details?: string;
}

interface RecoveredGeneration {
  flowId: string;
  flowTitle: string;
  nodeId: string;
  nodeType: NodeType;
  nodeData: NodeData;
  requestId: string;
  endpoint: string;
  mediaType: 'image' | 'video';
  slotIndex?: number;
  createdAt: string;
  runId?: string;
  status?: string;
  mediaUrl?: string;
  errorMessage?: string;
}

const inFlightRequests = new Set<string>();
const inFlightSaves = new Set<string>();
const inFlightSubmissions = new Set<string>();
let isRecovering = false;
let activePollCount = 0;
const MAX_CONCURRENT_REQUESTS = 4;
const ORPHANED_SUBMISSION_TIMEOUT_MS = 10 * 60 * 1000;
const INCOMPLETE_RECOVERY_GRACE_MS = 60 * 1000;

function submissionKey(job: BackgroundGenerationJob): string {
  return `${job.id}:${job.runId ?? job.startedAt}`;
}

function isCurrentJob(job: BackgroundGenerationJob): boolean {
  const latest = useGenerationStore.getState().jobs[job.id];
  return latest?.startedAt === job.startedAt && latest?.runId === job.runId;
}

function activeNodeData(flowId: string, nodeId: string): NodeData | undefined {
  const flowState = useFlowStore.getState();
  if (flowState.currentFlow?.id !== flowId) return undefined;
  return flowState.nodes.find((node) => node.id === nodeId)?.data;
}

function applyNodeData(flowId: string, nodeId: string, data: Partial<NodeData>) {
  const flowState = useFlowStore.getState();
  if (flowState.currentFlow?.id !== flowId) return;
  if (!flowState.nodes.some((node) => node.id === nodeId)) return;
  flowState.updateNodeData(nodeId, data);
}

function submissionMetadata(job: BackgroundGenerationJob) {
  return {
    generationRunId: job.runId,
    previousIdentity: job.previousIdentity,
    generationSlotCount: job.slotCount,
  };
}

function propagateCompletedMedia(job: BackgroundGenerationJob, mediaUrl: string) {
  if (useFlowStore.getState().currentFlow?.id !== job.flowId) return;
  if (job.kind === 'image-generation') {
    document.dispatchEvent(new CustomEvent('node:image-propagate', {
      detail: { sourceNodeId: job.nodeId, imageUrl: mediaUrl },
    }));
    return;
  }
  document.dispatchEvent(new CustomEvent('node:video-propagate', {
    detail: { sourceNodeId: job.nodeId, videoUrl: mediaUrl },
  }));
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      response.ok
        ? 'The server returned an invalid response.'
        : `Server error ${response.status}. The generation may still be running on FAL.`,
    );
  }
}

function initialJob(input: {
  flowId: string;
  flowTitle: string;
  nodeId: string;
  nodeType: NodeType;
  kind: BackgroundGenerationKind;
  slotCount: number;
  previousIdentity?: string;
  imageHistory?: string[][];
  videoHistory?: string[];
}): BackgroundGenerationJob {
  return {
    ...input,
    id: generationJobId(input.flowId, input.nodeId),
    phase: 'submitting',
    runId: crypto.randomUUID(),
    startedAt: Date.now(),
    slots: Array<string | null>(input.slotCount).fill(null),
    failedSlots: [],
    requests: [],
    submissionsComplete: false,
    imageHistory: input.imageHistory ?? [],
    videoHistory: input.videoHistory ?? [],
  };
}

function markSlotCompleted(jobId: string, slotIndex: number, mediaUrl: string) {
  const job = useGenerationStore.getState().jobs[jobId];
  if (!job) return;
  const slots = Array.from(
    { length: Math.max(job.slotCount, slotIndex + 1) },
    (_, index) => job.slots[index] ?? null,
  );
  slots[slotIndex] = mediaUrl;
  useGenerationStore.getState().patchJob(jobId, {
    slots, failedSlots: job.failedSlots.filter((index) => index !== slotIndex),
  });
  syncJobToCurrentFlow(useGenerationStore.getState().jobs[jobId]);
}

function markSlotFailed(jobId: string, slotIndex: number) {
  const job = useGenerationStore.getState().jobs[jobId];
  if (!job || job.failedSlots.includes(slotIndex)) return;
  useGenerationStore.getState().patchJob(jobId, {
    failedSlots: [...job.failedSlots, slotIndex],
    slots: job.slots.map((url, index) => index === slotIndex ? null : url),
  });
}

function pendingNodeRequests(job: BackgroundGenerationJob) {
  return job.requests
    .filter((request) => request.status === 'pending')
    .map(({ requestId, endpoint, slotIndex }) => ({ requestId, endpoint, slotIndex }));
}

export function syncJobToCurrentFlow(job: BackgroundGenerationJob | undefined) {
  if (!job || job.phase === 'saving' || job.phase === 'checking') return;
  const current = activeNodeData(job.flowId, job.nodeId);
  if (!current) return;
  const identity = generationIdentity(current);
  const unsavedAttempt = job.runId && job.previousIdentity !== undefined
    && identity === job.previousIdentity && identity !== job.runId;
  if (isTerminalNode(current) && !unsavedAttempt) return;
  const expected = job.runId ?? job.requests.map((request) => request.requestId).sort().join(',');
  if (identity && identity !== expected && !unsavedAttempt) return;
  if (unsavedAttempt) applyNodeData(job.flowId, job.nodeId, { generationRunId: job.runId, resolvedRequestIds: undefined });
  if (job.kind === 'image-generation') {
    applyNodeData(job.flowId, job.nodeId, {
      status: 'processing',
      errorMessage: undefined,
      generationErrors: undefined,
      generatedImages: job.slots.filter((url): url is string => !!url),
      generationSlots: job.slots,
      pendingRequests: pendingNodeRequests(job),
    });
    return;
  }

  applyNodeData(job.flowId, job.nodeId, {
    status: 'processing',
    errorMessage: undefined,
    errorRequestId: undefined,
    pendingRequestId: job.requests.find((request) => request.status === 'pending')?.requestId,
    pendingEndpoint: job.requests.find((request) => request.status === 'pending')?.endpoint,
  });
}

// Requests we invented locally (submission errors, unrecoverable jobs) have no
// counterpart in FAL, so their IDs must not be shown as traceable request IDs.
function falRequestId(request: BackgroundGenerationRequest): string | undefined {
  const { requestId } = request;
  if (!requestId || requestId.startsWith('submission-')) return undefined;
  if (requestId === 'orphaned-submission' || requestId === 'incomplete-recovery') return undefined;
  return requestId;
}

/** The reason each slot failed, so every failed thumbnail can show its own message. */
function failuresBySlot(job: BackgroundGenerationJob): Array<GenerationFailure | null> {
  const length = job.requests.reduce(
    (max, request) => Math.max(max, request.slotIndex + 1),
    job.slotCount,
  );
  const failures = Array.from({ length }, () => null as GenerationFailure | null);
  for (const request of job.requests) {
    if (request.status !== 'failed' || !request.errorMessage) continue;
    if (request.slotIndex < 0 || failures[request.slotIndex]) continue;
    failures[request.slotIndex] = {
      message: request.errorMessage,
      requestId: falRequestId(request),
    };
  }
  return failures;
}

function errorMessageForJob(job: BackgroundGenerationJob): string {
  const messages = [...new Set(
    job.requests
      .map((request) => request.errorMessage)
      .filter((message): message is string => !!message),
  )];
  if (messages.length > 0) return messages.join(' · ');
  return job.kind === 'image-generation'
    ? 'One or more images could not be generated.'
    : 'FAL reported that the generation failed.';
}

function buildFinalData(job: BackgroundGenerationJob): Partial<NodeData> | null {
  const resolvedCount = job.slots.filter(Boolean).length + job.failedSlots.length;
  if (!job.submissionsComplete || resolvedCount < job.slotCount
    || job.requests.some((request) => request.status === 'pending')) return null;

  const failed = job.failedSlots.length > 0;
  const completedMedia = job.slots.filter((url): url is string => !!url);
  const currentData = activeNodeData(job.flowId, job.nodeId);

  if (job.kind === 'image-generation') {
    const history = (currentData as ImageGenNodeData | undefined)?.generationHistory
      ?? job.imageHistory;
    return failed
      ? {
          generatedImages: completedMedia,
          generationSlots: job.slots,
          generationErrors: failuresBySlot(job),
          generationHistory: preserveImageBatch(history, completedMedia),
          status: 'error',
          errorMessage: errorMessageForJob(job),
          pendingRequests: undefined,
        }
      : {
          generatedImages: completedMedia,
          generationSlots: undefined,
          generationErrors: undefined,
          generationHistory: preserveImageBatch(history, completedMedia),
          status: 'completed',
          errorMessage: undefined,
          pendingRequests: undefined,
        };
  }

  if (failed || !completedMedia[0]) {
    return {
      status: 'error',
      errorMessage: errorMessageForJob(job),
      errorRequestId: failuresBySlot(job).find((failure) => failure?.requestId)?.requestId,
      pendingRequestId: undefined,
      pendingEndpoint: undefined,
    };
  }

  if (job.kind === 'video-generation') {
    const history = (currentData as VideoGenNodeData | undefined)?.videoHistory
      ?? job.videoHistory;
    return {
      videoUrl: completedMedia[0],
      videoHistory: [...history, completedMedia[0]],
      status: 'completed',
      errorMessage: undefined,
      errorRequestId: undefined,
      pendingRequestId: undefined,
      pendingEndpoint: undefined,
    };
  }
  return {
    videoUrl: completedMedia[0],
    status: 'completed',
    errorMessage: undefined,
    errorRequestId: undefined,
    pendingRequestId: undefined,
    pendingEndpoint: undefined,
  };
}

async function saveFinalJob(job: BackgroundGenerationJob) {
  if (!job?.finalData || !isCurrentJob(job) || inFlightSaves.has(job.id)) return;
  inFlightSaves.add(job.id);

  try {
    const response = await fetch(`/api/flows/${job.flowId}/nodes/${job.nodeId}`, {
      method: 'PATCH',
      signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationRunId: job.runId,
        previousIdentity: job.previousIdentity,
        requestIds: job.requests.map(falRequestId).filter(Boolean),
        data: Object.fromEntries(
          Object.entries(job.finalData).filter(([, value]) => value !== undefined),
        ),
        unset: Object.entries(job.finalData)
          .filter(([, value]) => value === undefined)
          .map(([key]) => key),
      }),
    });
    if (!isCurrentJob(job)) return;
    if ([400, 403, 404].includes(response.status)) {
      // The node was removed, the Flow is gone, or the saved job is no longer
      // valid. Retrying can never succeed and would leave a phantom card.
      useGenerationStore.getState().removeJob(job.id);
      return;
    }
    if (!response.ok) throw new Error(`Could not persist generation result (${response.status}).`);

    const result = await response.json() as { superseded?: boolean };
    if (!isCurrentJob(job)) return;
    if (result.superseded) {
      useGenerationStore.getState().removeJob(job.id);
      return;
    }
    const current = activeNodeData(job.flowId, job.nodeId);
    if (current?.generationRunId && current.generationRunId !== job.runId) {
      useGenerationStore.getState().removeJob(job.id);
      return;
    }
    // The Flow may have loaded while the persistence request was in flight.
    applyNodeData(job.flowId, job.nodeId, job.finalData);
    const completedMedia = job.slots.find((url): url is string => !!url);
    if (completedMedia) {
      if (job.failedSlots.length === 0) playSuccessSound();
      propagateCompletedMedia(job, completedMedia);
    }
    useGenerationStore.getState().removeJob(job.id);
  } catch (error) {
    console.error('[BackgroundGeneration] Saving the completed node failed:', error);
  } finally {
    inFlightSaves.delete(job.id);
  }
}

async function finalizeReadyJobs() {
  for (const job of Object.values(useGenerationStore.getState().jobs)) {
    if (job.phase === 'saving') continue;
    const finalData = buildFinalData(job);
    if (!finalData) continue;
    useGenerationStore.getState().patchJob(job.id, { phase: 'saving', finalData: {
      ...finalData,
      ...(job.runId ? { generationRunId: job.runId } : {}),
      resolvedRequestIds: job.requests.map(falRequestId).filter(Boolean),
    } });
  }
  const ready = Object.values(useGenerationStore.getState().jobs)
    .filter((job) => job.phase === 'saving' && !inFlightSaves.has(job.id))
    .slice(0, Math.max(0, MAX_CONCURRENT_REQUESTS - inFlightSaves.size));
  await Promise.all(ready.map(saveFinalJob));
}

function requestStatusUrl(request: BackgroundGenerationRequest): string {
  return `/api/fal/status/${request.requestId}?endpoint=${encodeURIComponent(request.endpoint)}&mediaType=${request.mediaType}`;
}

function recordPollError(jobId: string, requestId: string, message: string) {
  const job = useGenerationStore.getState().jobs[jobId];
  const request = job?.requests.find((candidate) => candidate.requestId === requestId);
  if (!request || request.status !== 'pending') return;
  const pollErrorCount = (request.pollErrorCount ?? 0) + 1;
  // A polling/network failure says nothing about the Fal job itself. Keep the
  // request pending until Fal returns an explicit terminal status so a slow or
  // temporarily unreachable generation is never surfaced as failed.
  useGenerationStore.getState().patchRequest(jobId, requestId, {
    pollErrorCount, lastVerifiedAt: undefined,
    nextPollAt: Date.now() + Math.min(60_000, 3_000 * 2 ** Math.min(pollErrorCount, 5)),
  });
  useGenerationStore.getState().patchJob(jobId, { phase: 'checking' });
  if (pollErrorCount === 10 || pollErrorCount % 100 === 0) {
    console.warn(
      `[BackgroundGeneration] Still waiting to confirm ${requestId} after ${pollErrorCount} status errors: ${message}`,
    );
  }
}

function failOrphanedJobs() {
  const now = Date.now();
  for (let job of Object.values(useGenerationStore.getState().jobs)) {
    if (
      !job.submissionsComplete
      && !inFlightSubmissions.has(submissionKey(job))
      && now - job.startedAt >= ORPHANED_SUBMISSION_TIMEOUT_MS
    ) {
      // Closing/reloading loses submission callbacks, even for a partial batch.
      // Keep every known Fal request pending; only unsubmitted slots can fail.
      useGenerationStore.getState().patchJob(job.id, { submissionsComplete: true });
      job = useGenerationStore.getState().jobs[job.id];
    }

    const hasPendingRequest = job.requests.some((request) => request.status === 'pending');
    const resolvedCount = job.slots.filter(Boolean).length + job.failedSlots.length;
    if (
      job.submissionsComplete
      && !hasPendingRequest
      && resolvedCount < job.slotCount
      && now - job.startedAt >= INCOMPLETE_RECOVERY_GRACE_MS
    ) {
      const missingSlots = Array.from({ length: job.slotCount }, (_, index) => index)
        .filter((index) => !job.slots[index] && !job.failedSlots.includes(index));
      useGenerationStore.getState().patchJob(job.id, {
        failedSlots: [...job.failedSlots, ...missingSlots],
        requests: [...job.requests, {
          requestId: 'incomplete-recovery',
          endpoint: '',
          mediaType: job.kind === 'image-generation' ? 'image' : 'video',
          slotIndex: missingSlots[0] ?? 0,
          status: 'failed',
          errorMessage: 'Part of this generation could not be recovered.',
        }],
      });
    }
  }
}

async function pollRequest(jobId: string, request: BackgroundGenerationRequest) {
  const job = useGenerationStore.getState().jobs[jobId];
  if (!job || (request.nextPollAt ?? 0) > Date.now()) return;
  const requestKey = `${jobId}:${request.requestId}`;
  if (inFlightRequests.has(requestKey)) return;
  inFlightRequests.add(requestKey);
  activePollCount++;
  try {
    const response = await fetch(requestStatusUrl(request), { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      recordPollError(jobId, request.requestId, result.error ?? `Status request failed (${response.status}).`);
      return;
    }
    const result = await readJsonResponse<{
      status: string;
      mediaUrls?: string[];
      error?: string;
      detail?: string;
    }>(response);
    if (!isCurrentJob(job)) return;
    if (result.status === 'completed' && result.mediaUrls?.[0]) {
      useGenerationStore.getState().patchRequest(jobId, request.requestId, {
        status: 'completed',
        mediaUrl: result.mediaUrls[0],
      });
      markSlotCompleted(jobId, request.slotIndex, result.mediaUrls[0]);
    } else if (result.status === 'failed') {
      useGenerationStore.getState().patchRequest(jobId, request.requestId, {
        status: 'failed',
        errorMessage: result.error ?? result.detail ?? 'FAL reported that the generation failed.',
      });
      markSlotFailed(jobId, request.slotIndex);
    } else if (result.status === 'error') {
      recordPollError(
        jobId,
        request.requestId,
        result.error ?? result.detail ?? 'FAL status is unavailable.',
      );
    } else if (result.status === 'pending') {
      useGenerationStore.getState().patchRequest(jobId, request.requestId, {
        pollErrorCount: 0, lastVerifiedAt: Date.now(), nextPollAt: Date.now() + 3_000,
      });
      const latest = useGenerationStore.getState().jobs[jobId];
      const verified = latest.requests.filter((candidate) => candidate.status === 'pending')
        .every((candidate) => candidate.lastVerifiedAt && !candidate.pollErrorCount);
      useGenerationStore.getState().patchJob(jobId, { phase: verified ? 'processing' : 'checking' });
      syncJobToCurrentFlow(useGenerationStore.getState().jobs[jobId]);
    } else {
      recordPollError(jobId, request.requestId, 'The generation status could not be confirmed.');
    }
  } catch {
    recordPollError(jobId, request.requestId, 'The status service could not be reached.');
  } finally {
    inFlightRequests.delete(requestKey);
    activePollCount--;
  }
}

export async function progressBackgroundGenerations() {
  const jobs = Object.values(useGenerationStore.getState().jobs);
  for (const job of jobs) {
    if (job.phase === 'processing' && job.requests.some((request) => request.status === 'pending'
      && (!request.lastVerifiedAt || Date.now() - request.lastVerifiedAt > 60_000))) {
      useGenerationStore.getState().patchJob(job.id, { phase: 'checking' });
    }
  }
  const due = jobs.flatMap((job) => job.requests
    .filter((request) => request.status === 'pending' && (request.nextPollAt ?? 0) <= Date.now()
      && !inFlightRequests.has(`${job.id}:${request.requestId}`))
    .map((request) => ({ job, request })))
    .sort((a, b) => (a.request.nextPollAt ?? 0) - (b.request.nextPollAt ?? 0))
    .slice(0, Math.max(0, MAX_CONCURRENT_REQUESTS - activePollCount));
  await Promise.all(due.map(async ({ job, request }) => {
    await pollRequest(job.id, request);
    await finalizeReadyJobs();
  }));
  if (!isRecovering) failOrphanedJobs();
  await finalizeReadyJobs();
}

function recoveredKind(nodeType: NodeType): BackgroundGenerationKind | null {
  if (nodeType === 'imageGenNode') return 'image-generation';
  if (nodeType === 'videoGenNode' || nodeType === 'referenceVideoNode') return 'video-generation';
  return null;
}

export async function recoverBackgroundGenerations() {
  if (isRecovering) return;
  isRecovering = true;
  try {
    const snapshot = Object.values(useGenerationStore.getState().jobs);
    const response = await fetch('/api/generations/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: snapshot.map(({ id, flowId, nodeId, runId, previousIdentity, requests }) => ({ id, flowId, nodeId, runId, previousIdentity, requestIds: requests.map(falRequestId).filter(Boolean) })) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return;
    const { generations, removedJobIds = [] } = await readJsonResponse<{
      generations: RecoveredGeneration[];
      removedJobIds?: string[];
    }>(response);
    for (const id of removedJobIds) {
      const previous = snapshot.find((job) => job.id === id);
      const job = useGenerationStore.getState().jobs[id];
      if (!job || (job.startedAt !== previous?.startedAt || job.runId !== previous?.runId) || inFlightSubmissions.has(submissionKey(job))) continue;
      // A newly created node may not have autosaved yet. The open canvas is
      // authoritative for unsaved nodes; never infer deletion from list absence.
      const flow = useFlowStore.getState();
      if (flow.currentFlow?.id === job.flowId && flow.nodes.some((node) => node.id === job.nodeId)
        && !flow.currentFlow.flow_data.nodes.some((node) => node.id === job.nodeId)) continue;
      if (Date.now() - job.startedAt < INCOMPLETE_RECOVERY_GRACE_MS) continue;
      useGenerationStore.getState().removeJob(id);
    }
    const grouped = new Map<string, RecoveredGeneration[]>();
    for (const generation of generations) {
      const key = generationJobId(generation.flowId, generation.nodeId);
      grouped.set(key, [...(grouped.get(key) ?? []), generation]);
    }

    for (const [jobId, recovered] of grouped) {
      if (recovered.length === 0) continue;
      const first = recovered[0];
      const flow = useFlowStore.getState();
      const existing = useGenerationStore.getState().jobs[jobId];
      if (flow.currentFlow?.id === first.flowId) {
        const local = flow.nodes.find((node) => node.id === first.nodeId);
        const unsavedAttempt = local && existing?.runId && existing.previousIdentity !== undefined
          && generationIdentity(local.data) === existing.previousIdentity;
        if (!local || (isTerminalNode(local.data) && !unsavedAttempt)) {
          useGenerationStore.getState().removeJob(jobId);
          continue;
        }
      }
      if (isTerminalNode(first.nodeData)) continue;
      const kind = recoveredKind(first.nodeType);
      if (!kind) continue;
      const previous = snapshot.find((job) => job.id === jobId);
      if (previous && (!existing || previous.startedAt !== existing.startedAt)) continue;
      const imageData = first.nodeData as ImageGenNodeData;
      const videoData = first.nodeData as VideoGenNodeData;
      const savedRequestIds = new Set([
        ...(imageData.pendingRequests ?? []).map((request) => request.requestId),
        ...(videoData.pendingRequestId ? [videoData.pendingRequestId] : []),
      ]);
      const savedBatch = savedRequestIds.size > 0
        ? recovered.filter((generation) => savedRequestIds.has(generation.requestId))
        : [];
      // Recovery must identify the exact saved attempt, never guess a batch
      // from historical processing rows.
      const runBatch = recovered.filter((generation) => generation.runId && generation.runId === imageData.generationRunId);
      const relevantGenerations = runBatch.length ? runBatch : savedBatch;
      if (!relevantGenerations.length) continue;
      const recoveredSlotCount = Math.max(
        relevantGenerations.length,
        kind === 'image-generation' ? imageData.generationSlots?.length ?? imageData.numImages ?? 1 : 1,
        ...relevantGenerations.map((generation) => (generation.slotIndex ?? 0) + 1),
      );

      if (existing?.phase === 'saving') continue;
      if (existing?.runId && existing.runId !== first.runId) continue;
      if (!existing) {
        useGenerationStore.getState().startJob({
          ...initialJob({
            flowId: first.flowId,
            flowTitle: first.flowTitle,
            nodeId: first.nodeId,
            nodeType: first.nodeType,
            kind,
            slotCount: recoveredSlotCount,
            imageHistory: imageData.generationHistory ?? [],
            videoHistory: videoData.videoHistory ?? [],
          }),
          phase: 'checking',
          runId: first.runId,
          startedAt: Date.parse(first.createdAt) || Date.now(),
          slots: Array.from({ length: recoveredSlotCount }, (_, index) => imageData.generationSlots?.[index] ?? null),
          submissionsComplete: true,
        });
      } else if (existing.flowTitle !== first.flowTitle) {
        useGenerationStore.getState().patchJob(jobId, { flowTitle: first.flowTitle });
      }

      relevantGenerations.forEach((generation, index) => {
        // Recovery is additive, never reset terminal requests or merge an old
        // batch into a newer, fully submitted job on the same node.
        const known = existing?.requests.find((request) => request.requestId === generation.requestId);
        if (known && known.status !== 'pending') return;
        if (!known && existing?.submissionsComplete && (!existing.runId || existing.runId !== generation.runId)) return;
        const status = generation.status === 'completed' && generation.mediaUrl ? 'completed'
          : generation.status === 'failed' ? 'failed' : 'pending';
        if (known && status === 'pending') return;
        useGenerationStore.getState().addRequest(jobId, {
          requestId: generation.requestId,
          endpoint: generation.endpoint,
          mediaType: generation.mediaType,
          slotIndex: generation.slotIndex ?? index,
          status,
          mediaUrl: generation.mediaUrl,
          errorMessage: generation.errorMessage,
        });
        if (status === 'completed') markSlotCompleted(jobId, generation.slotIndex ?? index, generation.mediaUrl!);
        if (status === 'failed') markSlotFailed(jobId, generation.slotIndex ?? index);
      });

      const latest = useGenerationStore.getState().jobs[jobId];
      // A rehydrated submitting job has lost its browser request callbacks.
      // The database records above are now the authoritative submitted set.
      if (latest && !latest.submissionsComplete && !inFlightSubmissions.has(submissionKey(latest))
        && Date.now() - latest.startedAt >= ORPHANED_SUBMISSION_TIMEOUT_MS) {
        useGenerationStore.getState().patchJob(jobId, {
          phase: 'processing',
          submissionsComplete: true,
        });
      }
    }
    await finalizeReadyJobs();
  } catch (error) {
    console.error('[BackgroundGeneration] Recovery failed:', error);
  } finally {
    isRecovering = false;
  }
}

export async function startTrackedImageGeneration(input: {
  flowId: string;
  flowTitle: string;
  nodeId: string;
  data: ImageGenNodeData;
  endpoint: string;
  payload: Record<string, unknown>;
  slotCount: number;
}) {
  const job = initialJob({
    flowId: input.flowId,
    flowTitle: input.flowTitle,
    nodeId: input.nodeId,
    nodeType: 'imageGenNode',
    kind: 'image-generation',
    slotCount: input.slotCount,
    imageHistory: input.data.generationHistory ?? [],
    previousIdentity: generationIdentity(input.data),
  });
  useGenerationStore.getState().startJob(job);
  inFlightSubmissions.add(submissionKey(job));
  applyNodeData(job.flowId, job.nodeId, { generationRunId: job.runId, resolvedRequestIds: undefined,
    status: 'processing', pendingRequests: undefined, pendingRequestId: undefined, pendingEndpoint: undefined });
  syncJobToCurrentFlow(job);

  await Promise.all(Array.from({ length: input.slotCount }, async (_, slotIndex) => {
    try {
      const response = await fetch(input.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input.payload, slotIndex, ...submissionMetadata(job) }),
      });
      const result = await readJsonResponse<ImageGenerationResponse>(response);
      if (!isCurrentJob(job)) return;
      if (!response.ok) {
        throw new Error(result.details ?? result.error ?? `Server error ${response.status}`);
      }

      const mediaUrl = result.mediaUrls?.[0];
      const pending = result.requests?.[0];
      if (mediaUrl) {
        markSlotCompleted(job.id, slotIndex, mediaUrl);
      } else if (pending) {
        useGenerationStore.getState().addRequest(job.id, {
          requestId: pending.requestId,
          endpoint: pending.endpoint,
          mediaType: 'image',
          slotIndex,
          status: 'pending', lastVerifiedAt: Date.now(),
        });
        syncJobToCurrentFlow(useGenerationStore.getState().jobs[job.id]);
      } else {
        throw new Error(result.details ?? result.error ?? 'Image generation returned no output.');
      }
    } catch (error) {
      if (!isCurrentJob(job)) return;
      markSlotFailed(job.id, slotIndex);
      const current = useGenerationStore.getState().jobs[job.id];
      if (current) {
        useGenerationStore.getState().patchJob(job.id, {
          requests: [
            ...current.requests,
            {
              requestId: `submission-${slotIndex}`,
              endpoint: '',
              mediaType: 'image',
              slotIndex,
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Image generation failed.',
            },
          ],
        });
      }
    }
  })).finally(() => { inFlightSubmissions.delete(submissionKey(job)); });

  if (!isCurrentJob(job)) return;
  useGenerationStore.getState().patchJob(job.id, {
    submissionsComplete: true,
    phase: useGenerationStore.getState().jobs[job.id]?.requests.some(
      (request) => request.status === 'pending',
    ) ? 'processing' : 'submitting',
  });
  await progressBackgroundGenerations();
}

export async function startTrackedVideoGeneration(input: {
  flowId: string;
  flowTitle: string;
  nodeId: string;
  nodeType?: 'videoGenNode' | 'referenceVideoNode';
  data: VideoGenNodeData;
  endpoint: string;
  payload: Record<string, unknown>;
}) {
  const job = initialJob({
    flowId: input.flowId,
    flowTitle: input.flowTitle,
    nodeId: input.nodeId,
    nodeType: input.nodeType ?? 'videoGenNode',
    kind: 'video-generation',
    slotCount: 1,
    videoHistory: input.data.videoHistory ?? [],
    previousIdentity: generationIdentity(input.data),
  });
  useGenerationStore.getState().startJob(job);
  inFlightSubmissions.add(submissionKey(job));
  applyNodeData(job.flowId, job.nodeId, { generationRunId: job.runId, resolvedRequestIds: undefined,
    status: 'processing', pendingRequests: undefined, pendingRequestId: undefined, pendingEndpoint: undefined });
  syncJobToCurrentFlow(job);

  try {
    const response = await fetch('/api/fal/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input.payload, ...submissionMetadata(job) }),
    });
    const result = await readJsonResponse<VideoGenerationResponse>(response);
    if (!isCurrentJob(job)) return;
    if (!response.ok) {
      throw new Error(result.details ?? result.error ?? `Server error ${response.status}`);
    }
    if (result.mediaUrls?.[0]) {
      markSlotCompleted(job.id, 0, result.mediaUrls[0]);
    } else if (result.requestId) {
      useGenerationStore.getState().addRequest(job.id, {
        requestId: result.requestId,
        endpoint: result.endpoint ?? input.endpoint,
        mediaType: 'video',
        slotIndex: 0,
        status: 'pending', lastVerifiedAt: Date.now(),
      });
      syncJobToCurrentFlow(useGenerationStore.getState().jobs[job.id]);
    } else {
      throw new Error(result.details ?? result.error ?? 'Generation returned no request ID.');
    }
  } catch (error) {
    if (!isCurrentJob(job)) return;
    markSlotFailed(job.id, 0);
    useGenerationStore.getState().patchJob(job.id, {
      requests: [{
        requestId: 'submission-0',
        endpoint: input.endpoint,
        mediaType: 'video',
        slotIndex: 0,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Video generation failed.',
      }],
    });
  } finally {
    inFlightSubmissions.delete(submissionKey(job));
  }

  if (!isCurrentJob(job)) return;
  useGenerationStore.getState().patchJob(job.id, {
    submissionsComplete: true,
    phase: useGenerationStore.getState().jobs[job.id]?.requests.some(
      (request) => request.status === 'pending',
    ) ? 'processing' : 'submitting',
  });
  await progressBackgroundGenerations();
}
