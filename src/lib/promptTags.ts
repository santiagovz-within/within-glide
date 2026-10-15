// Inline media tagging for prompts: "@image1", "@video1", …
//
// A tag is a piece of prompt text ("@image2") plus a PromptTag record that pins
// it to the reference port and connection it was picked from. The text alone is
// never trusted: "@image2" only renders as a chip while a matching PromptTag
// exists. Tags survive missing connections so the prompt can be repaired.

import type { Edge, Node } from '@xyflow/react';
import type { ImageGenNodeData, NodeData, PromptReferenceStyle, PromptTag, VideoGenNodeData } from '@/types';

export type { PromptReferenceStyle };

/**
 * Matches "@image12" as a standalone token: not "@image12abc" and not
 * "email@image12". Group 1 is the 1-based number.
 */
export const IMAGE_TAG_PATTERN = /(?<![\w])@image(\d+)(?![\w])/g;

/** Modality and 1-based index, with the same standalone-token boundaries. */
export const MEDIA_TAG_PATTERN = /(?<![\w])@(image|video)(\d+)(?![\w])/g;

export function imageTagLabel(portIndex: number): string {
  return `image${portIndex + 1}`;
}

/** Reference-port handle id → 0-based index, or null for non-reference handles. */
export function referenceHandleIndex(handle: string | null | undefined): number | null {
  if (!handle) return null;
  if (handle === 'reference_image') return 0;
  if (handle.startsWith('ref_')) {
    const idx = Number(handle.slice(4));
    return Number.isInteger(idx) ? idx : null;
  }
  return null;
}

/** A connected input the user can tag from the picker. */
export interface TaggableInput {
  mediaType?: 'image' | 'video';
  label: string;
  portIndex: number;
  /** Present for a generation node's own inputs; absent for positional (Prompt node) inputs. */
  edgeId?: string;
  sourceNodeId?: string;
  /** Current media URL on that port; may be empty if the source has no image yet. */
  url: string;
}

/** Build a PromptTag from a picked input, omitting pin fields when positional. */
export function tagFromInput(input: TaggableInput): PromptTag {
  const tag: PromptTag = { label: input.label, portIndex: input.portIndex };
  if (input.edgeId) tag.edgeId = input.edgeId;
  if (input.sourceNodeId) tag.sourceNodeId = input.sourceNodeId;
  return tag;
}

/** Connected reference inputs of `nodeId`, ordered by port index. */
export function getTaggableInputs(
  nodeId: string,
  edges: Edge[],
  inputImageUrls: string[] | undefined,
): TaggableInput[] {
  const inputs: TaggableInput[] = [];
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const portIndex = referenceHandleIndex(edge.targetHandle);
    if (portIndex === null) continue;
    inputs.push({
      label: imageTagLabel(portIndex),
      portIndex,
      edgeId: edge.id,
      sourceNodeId: edge.source,
      url: inputImageUrls?.[portIndex] ?? '',
    });
  }
  return inputs.sort((a, b) => a.portIndex - b.portIndex);
}

/** Generation nodes supporting reference tags fed by this prompt output. */
export function getPromptTargets(promptNodeId: string, nodes: Node<NodeData>[], edges: Edge[]): Node<NodeData>[] {
  const targetIds = new Set(
    edges.filter((e) => e.source === promptNodeId && e.sourceHandle === 'prompt').map((e) => e.target),
  );
  return nodes.filter((n) => targetIds.has(n.id) && ['imageGenNode', 'referenceVideoNode', 'videoGenNode'].includes(n.type ?? ''));
}

/**
 * Positional inputs for a Prompt node: the union of reference ports connected
 * on every image/reference-video generation node it feeds. Tags mean port N on each
 * of those nodes. The thumbnail is the first media found for that modality and port.
 */
export function getDownstreamTaggableInputs(
  promptNodeId: string,
  nodes: Node<NodeData>[],
  edges: Edge[],
  resolveReferenceInputs?: (nodeId: string) => TaggableInput[],
): TaggableInput[] {
  const byLabel = new Map<string, TaggableInput>();
  for (const target of getPromptTargets(promptNodeId, nodes, edges)) {
    const data = target.data as ImageGenNodeData;
    const inputs = target.type === 'referenceVideoNode'
      ? resolveReferenceInputs?.(target.id) ?? (['image', 'video'] as const).flatMap(kind =>
        edges.filter(edge => edge.target === target.id && edge.targetHandle === `reference_${kind}s`)
          .map((_, portIndex) => ({ label: `${kind}${portIndex + 1}`, portIndex, mediaType: kind, url: '' })))
      : target.type === 'videoGenNode'
        ? getVideoFrameTaggableInputs(target.id, edges, target.data as VideoGenNodeData)
        : getTaggableInputs(target.id, edges, data.inputImageUrls);
    for (const input of inputs) {
      const existing = byLabel.get(input.label);
      if (!existing) {
        byLabel.set(input.label, { label: input.label, portIndex: input.portIndex, mediaType: input.mediaType, url: input.url });
      } else if (!existing.url && input.url) {
        existing.url = input.url;
      }
    }
  }
  return [...byLabel.values()].sort((a, b) => a.portIndex - b.portIndex);
}

export type PromptSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; text: string; tag: PromptTag };

/** Split prompt text into plain runs and live chips (text that has a PromptTag). */
export function segmentPrompt(text: string, tags: PromptTag[]): PromptSegment[] {
  if (!text) return [];
  const byLabel = new Map(tags.map((t) => [t.label, t]));
  const segments: PromptSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MEDIA_TAG_PATTERN)) {
    const tag = byLabel.get(`${match[1]}${match[2]}`);
    if (!tag) continue;
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'tag', text: match[0], tag });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/** Labels ("image2") that appear as "@image2" in the text. */
export function labelsInText(text: string): Set<string> {
  const labels = new Set<string>();
  for (const match of text.matchAll(MEDIA_TAG_PATTERN)) labels.add(`${match[1]}${match[2]}`);
  return labels;
}

/**
 * Keep `tags` consistent with `text` and the currently connected inputs:
 *  - drop tags whose "@label" the user deleted from the text
 *  - register typed/pasted media tags even when their references are missing
 * Returns the same array instance when nothing changed.
 */
export function syncTagsWithText(
  text: string,
  tags: PromptTag[],
  taggable: TaggableInput[],
): PromptTag[] {
  const present = labelsInText(text);
  const kept = tags.filter((t) => present.has(t.label));
  const have = new Set(kept.map((t) => t.label));
  const added: PromptTag[] = [];
  for (const label of present) {
    if (have.has(label)) continue;
    const input = taggable.find((i) => i.label === label);
    added.push(input ? tagFromInput(input) : { label, portIndex: Number(label.replace(/^(image|video)/, '')) - 1 });
  }
  if (kept.length === tags.length && added.length === 0) return tags;
  return [...kept, ...added];
}

/** Turn "@image2" back into plain "image2" everywhere in the text. */
export function untagLabel(text: string, label: string): string {
  return text.replace(MEDIA_TAG_PATTERN, (token, kind: string, num: string) =>
    `${kind}${num}` === label ? label : token);
}

/**
 * The "@query" the caret is currently inside, if any. Used to open the picker
 * while typing. `query` is the text after the "@" up to the caret.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\w]*)$/.exec(before);
  if (!match) return null;
  const start = caret - match[2].length - 1; // index of "@"
  return { start, query: match[2] };
}

// ── Submit-time conversion ───────────────────────────────────────────────────
//
// Models differ in how (or whether) a prompt can point at a specific input
// image. Each image model declares a `promptReference` style in the model
// config; chips are rewritten to that style right before the request is sent.
//
//   native → the model has its own token syntax, e.g. "@Image{n}" (Seedance
//            reference-to-video) or "@Element{n}" (Kling elements). The token
//            is substituted verbatim.
//   plain  → the model only understands natural language; the chip becomes a
//            phrase like "the first image attached" or "image 1".
//
// `{n}` is the 1-based position of the image among the images actually sent,
// and `{ordinal}` is that position as a word ("first"). Positions are counted
// over the compacted list the API receives, not over port numbers, so a chip
// for port 3 becomes "the second image" when port 2 is empty.

export const DEFAULT_PROMPT_REFERENCE: PromptReferenceStyle = {
  kind: 'plain',
  template: 'the {ordinal} image attached',
};

const ORDINALS = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
  'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
];

export function ordinalWord(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

export function formatPromptReference(style: PromptReferenceStyle, position: number): string {
  return style.template
    .replaceAll('{n}', String(position))
    .replaceAll('{ordinal}', ordinalWord(position));
}

export interface CompiledPrompt {
  prompt: string;
  /** Tags whose port has no image to send. */
  unresolved: PromptTag[];
}

/**
 * Rewrite live chips in `prompt` for the model. `inputImageUrls` is the node's
 * port-indexed array (holes allowed); the model receives `filter(Boolean)` of
 * it, so positions are computed over the non-empty entries in port order.
 */
export function compilePromptForModel(
  prompt: string,
  tags: PromptTag[],
  inputImageUrls: string[] | undefined,
  style: PromptReferenceStyle = DEFAULT_PROMPT_REFERENCE,
): CompiledPrompt {
  const positionByPort = new Map<number, number>();
  let position = 0;
  (inputImageUrls ?? []).forEach((url, portIndex) => {
    if (url) positionByPort.set(portIndex, ++position);
  });

  const byLabel = new Map(tags.map((t) => [t.label, t]));
  const unresolved: PromptTag[] = [];
  const compiled = prompt.replace(IMAGE_TAG_PATTERN, (token, num: string) => {
    const tag = byLabel.get(`image${num}`);
    if (!tag) return token; // not a live chip: leave the text alone
    const pos = positionByPort.get(tag.portIndex);
    if (pos === undefined) {
      unresolved.push(tag);
      return token;
    }
    return formatPromptReference(style, pos);
  });

  return { prompt: compiled, unresolved };
}

// ── Keeping tags honest ──────────────────────────────────────────────────────

/** Resolve by connection identity, or a reconnect to the same source. */
export function resolvePromptTag(tag: PromptTag, inputs: TaggableInput[]): TaggableInput | undefined {
  const kind = tag.label.startsWith('video') ? 'video' : 'image';
  const sameKind = inputs.filter(input => (input.mediaType ?? 'image') === kind);
  if (!tag.edgeId) return sameKind.find(input => input.portIndex === tag.portIndex);
  const exact = sameKind.find(input => input.edgeId === tag.edgeId && input.sourceNodeId === tag.sourceNodeId);
  const sameSource = sameKind.filter(input => input.sourceNodeId === tag.sourceNodeId);
  return exact ?? (sameSource.length === 1 ? sameSource[0] : sameSource.find(input => input.portIndex === tag.portIndex));
}

export function missingPromptTags(tags: PromptTag[], inputs: TaggableInput[]): PromptTag[] {
  return tags.filter(tag => !resolvePromptTag(tag, inputs)?.url);
}

/** Keep visible reference labels stable when a reference list compacts. */
export function labelInputsForTags(inputs: TaggableInput[], tags: PromptTag[]): TaggableInput[] {
  const reserved = new Set(tags.map(tag => tag.label));
  const assigned = new Set<string>();
  return inputs.map(input => {
    const tag = tags.find(tag => resolvePromptTag(tag, inputs) === input);
    let label = tag?.label ?? input.label;
    if (assigned.has(label) || (!tag && reserved.has(label))) {
      const kind = input.mediaType ?? 'image';
      let number = 1;
      while (reserved.has(`${kind}${number}`) || assigned.has(`${kind}${number}`)) number++;
      label = `${kind}${number}`;
    }
    assigned.add(label);
    return { ...input, label };
  });
}

export function getVideoFrameTaggableInputs(nodeId: string, edges: Edge[], data: VideoGenNodeData): TaggableInput[] {
  return edges.filter(edge => edge.target === nodeId && ['start_frame', 'end_frame'].includes(edge.targetHandle ?? ''))
    .map(edge => {
      const portIndex = edge.targetHandle === 'start_frame' ? 0 : 1;
      return { edgeId: edge.id, sourceNodeId: edge.source, portIndex, label: imageTagLabel(portIndex),
        url: (portIndex === 0 ? data.startFrameUrl : data.endFrameUrl) ?? '', mediaType: 'image' as const };
    }).sort((a, b) => a.portIndex - b.portIndex);
}

/** Compile stable labels to the actual ordered media sent to the provider. */
export function compileMediaPromptTags(prompt: string, tags: PromptTag[], inputs: TaggableInput[], frames = false): string {
  const byLabel = new Map(tags.map(tag => [tag.label, tag]));
  return prompt.replace(MEDIA_TAG_PATTERN, (token, kind: string, number: string) => {
    const tag = byLabel.get(`${kind}${number}`);
    const input = tag && resolvePromptTag(tag, inputs);
    if (!input?.url) return token;
    return frames ? (input.portIndex === 0 ? 'the start frame' : 'the end frame') : `@${kind}${input.portIndex + 1}`;
  });
}

export function reconcilePromptTags(nodeId: string, prompt: string, tags: PromptTag[], edges: Edge[]) {
  return reconcileMediaPromptTags(prompt, tags, getTaggableInputs(nodeId, edges, undefined));
}

/** Prompt-node tags remain positional, including when no target currently supplies a reference. */
export function reconcilePositionalTags(promptNodeId: string, prompt: string, tags: PromptTag[], nodes: Node<NodeData>[], edges: Edge[]) {
  const next = syncTagsWithText(prompt, tags, getDownstreamTaggableInputs(promptNodeId, nodes, edges));
  return next === tags ? null : { prompt, tags: next };
}

export function findBrokenTags(nodeId: string, tags: PromptTag[], edges: Edge[], inputImageUrls: string[] | undefined): PromptTag[] {
  return missingPromptTags(tags, getTaggableInputs(nodeId, edges, inputImageUrls));
}

/** Preserve missing tags. Only an explicit reorder renumbers the prompt's labels. */
export function reconcileMediaPromptTags(prompt: string, tags: PromptTag[], inputs: TaggableInput[], renumber = false) {
  const synced = syncTagsWithText(prompt, tags, inputs);
  const reserved = new Set(synced.filter(tag => !resolvePromptTag(tag, inputs)).map(tag => tag.label));
  const replacements = new Map<string, string>();
  let changed = synced !== tags;
  const nextTags = synced.map(tag => {
    const input = resolvePromptTag(tag, inputs);
    if (!input) return tag;
    // Missing labels reserve their names. Keep all labels stable in that case
    // so renumbering cannot make two different references share a tag.
    const label = renumber && reserved.size === 0 ? input.label : tag.label;
    const next = { ...tagFromInput(input), label };
    if (next.label !== tag.label || next.portIndex !== tag.portIndex || next.edgeId !== tag.edgeId
      || next.sourceNodeId !== tag.sourceNodeId) changed = true;
    replacements.set(tag.label, `@${label}`);
    return next;
  });
  if (!changed) return null;
  return {
    prompt: renumber ? prompt.replace(MEDIA_TAG_PATTERN, (token, kind: string, num: string) => replacements.get(`${kind}${num}`) ?? token) : prompt,
    tags: nextTags,
  };
}

/** Remap only copied associations; absent references keep their original missing binding. */
export function remapCopiedPromptTags(tags: PromptTag[], nodeIds: Map<string, string>, edgeIds: Map<string, string>): PromptTag[] {
  return tags.map(tag => ({ ...tag,
    ...(tag.edgeId && edgeIds.has(tag.edgeId) ? { edgeId: edgeIds.get(tag.edgeId) } : {}),
    ...(tag.sourceNodeId && nodeIds.has(tag.sourceNodeId) ? { sourceNodeId: nodeIds.get(tag.sourceNodeId) } : {}),
  }));
}
