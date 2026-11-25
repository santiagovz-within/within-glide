import type { Edge, Node } from '@xyflow/react';
import type { NodeData } from '@/types';

interface CanvasSnapshot {
  nodes: Node<NodeData>[];
  edges: Edge[];
}

interface CanvasState extends CanvasSnapshot {
  currentFlow: { id: string } | null;
  setCanvas: (nodes: Node<NodeData>[], edges: Edge[]) => void;
}

interface CanvasStore {
  getState: () => CanvasState;
  subscribe: (listener: (state: CanvasState, previous: CanvasState) => void) => () => void;
}

const HISTORY_LIMIT = 30;
// React Flow changes these during selection and layout, including after restore.
const NODE_UI_FIELDS = new Set(['selected', 'dragging', 'resizing', 'measured']);
const EDGE_UI_FIELDS = new Set(['selected']);

// Compare JSON-shaped canvas content without serializing or copying media data.
// Identity checks skip unchanged subtrees. Missing and undefined are equivalent.
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => sameValue(value, b[index]));
  }
  return sameObject(a, b);
}

function sameObject(a: object, b: object, ignored?: Set<string>): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return Object.keys(left).every(key => ignored?.has(key) || sameValue(left[key], right[key]))
    && Object.keys(right).every(key => ignored?.has(key) || key in left || right[key] === undefined);
}

function sameItems<T extends object>(a: T[], b: T[], ignored: Set<string>): boolean {
  return a === b || (a.length === b.length
    && a.every((item, index) => item === b[index] || sameObject(item, b[index], ignored)));
}

/** Session-only history. Snapshots share immutable store objects, including URLs. */
export function createCanvasHistory(store: CanvasStore) {
  const past: CanvasSnapshot[] = [];
  const future: CanvasSnapshot[] = [];
  let restoring = false;

  function snapshot(): CanvasSnapshot {
    const { nodes, edges } = store.getState();
    return { nodes, edges };
  }

  function push(stack: CanvasSnapshot[], value: CanvasSnapshot) {
    stack.push(value);
    if (stack.length > HISTORY_LIMIT) stack.shift();
  }

  function clear() {
    past.length = 0;
    future.length = 0;
  }

  function restore(from: CanvasSnapshot[], to: CanvasSnapshot[]) {
    const next = from.pop();
    if (!next) return;
    push(to, snapshot());
    restoring = true;
    try {
      // One store notification: subscribers never see mismatched nodes and edges.
      store.getState().setCanvas(next.nodes, next.edges);
    } finally {
      restoring = false;
    }
  }

  return {
    record() {
      push(past, snapshot());
      future.length = 0;
    },
    undo: () => restore(past, future),
    redo: () => restore(future, past),
    subscribe() {
      const unsubscribe = store.subscribe((state, previous) => {
        if (state.currentFlow?.id !== previous.currentFlow?.id) {
          clear();
        } else if (!restoring && future.length > 0
          && (!sameItems(state.nodes, previous.nodes, NODE_UI_FIELDS)
            || !sameItems(state.edges, previous.edges, EDGE_UI_FIELDS))) {
          // New edits (including async results) must not be overwritten by redo.
          // Selection, measurements and equivalent autosave merges keep redo.
          future.length = 0;
        }
      });
      return () => { unsubscribe(); clear(); };
    },
  };
}

export function getCanvasHistoryAction(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'defaultPrevented'>,
  isMac: boolean,
): 'undo' | 'redo' | null {
  if (event.defaultPrevented || event.isComposing || event.altKey
    || !(isMac ? event.metaKey : event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (!isMac && key === 'y' && !event.shiftKey) return 'redo';
  return null;
}
