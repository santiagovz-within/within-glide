import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import type { Flow, NodeData } from '@/types';
import { useGenerationStore } from '@/lib/stores/generationStore';

function removeDeletedNodeJobs(flowId: string | undefined, nodes: Node<NodeData>[]) {
  if (!flowId) return;
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const job of Object.values(useGenerationStore.getState().jobs)) {
    if (job.flowId === flowId && !nodeIds.has(job.nodeId)) {
      useGenerationStore.getState().removeJob(job.id);
    }
  }
}

interface FlowStore {
  // Current flow meta
  currentFlow: Flow | null;
  setCurrentFlow: (flow: Flow | null) => void;
  consumeGcsOnlyEligibility: () => void;

  // React Flow state
  nodes: Node<NodeData>[];
  edges: Edge[];
  setNodes: (nodes: Node<NodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange<Node<NodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // Node operations
  addNode: (node: Node<NodeData>) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  removeNode: (nodeId: string) => void;

  // Save state
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
  isSaving: boolean;
  setSaving: (saving: boolean) => void;
  lastSaved: Date | null;
  setLastSaved: (date: Date) => void;
}

export const useFlowStore = create<FlowStore>((set, get) => ({
  currentFlow: null,
  setCurrentFlow: (flow) => {
    if (flow) {
      removeDeletedNodeJobs(flow.id, flow.flow_data.nodes as Node<NodeData>[]);
      set({
        currentFlow: flow,
        nodes: flow.flow_data.nodes as Node<NodeData>[],
        edges: flow.flow_data.edges,
        isDirty: false,
      });
    } else {
      set({ currentFlow: null, nodes: [], edges: [], isDirty: false });
    }
  },
  consumeGcsOnlyEligibility: () => {
    set((state) => ({
      currentFlow: state.currentFlow
        ? { ...state.currentFlow, gcs_only_eligible: false }
        : null,
    }));
  },

  nodes: [],
  edges: [],
  setNodes: (nodes) => {
    removeDeletedNodeJobs(get().currentFlow?.id, nodes);
    set({ nodes, isDirty: true });
  },
  setEdges: (edges) => set({ edges, isDirty: true }),

  onNodesChange: (changes) => {
    const nodes = applyNodeChanges(changes, get().nodes);
    if (changes.some((change) => change.type === 'remove')) {
      removeDeletedNodeJobs(get().currentFlow?.id, nodes);
    }
    set({
      nodes,
      isDirty: true,
    });
  },
  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
      isDirty: true,
    });
  },
  onConnect: (connection) => {
    set({
      edges: addEdge({ ...connection, animated: false }, get().edges),
      isDirty: true,
    });
  },

  addNode: (node) => {
    set({ nodes: [...get().nodes, node], isDirty: true });
  },
  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
      isDirty: true,
    });
  },
  removeNode: (nodeId) => {
    const nodes = get().nodes.filter((n) => n.id !== nodeId);
    removeDeletedNodeJobs(get().currentFlow?.id, nodes);
    set({
      nodes,
      edges: get().edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      ),
      isDirty: true,
    });
  },

  isDirty: false,
  setDirty: (dirty) => set({ isDirty: dirty }),
  isSaving: false,
  setSaving: (saving) => set({ isSaving: saving }),
  lastSaved: null,
  setLastSaved: (date) => set({ lastSaved: date }),
}));
