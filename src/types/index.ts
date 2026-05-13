// ============================================================
// DATABASE TYPES
// ============================================================

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  theme: 'dark' | 'light';
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Flow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  flow_data: FlowData;
  is_template: boolean;
  created_at: string;
  updated_at: string;
}

export interface Generation {
  id: string;
  user_id: string;
  source_type: 'canvas' | 'chat';
  source_id: string | null;
  node_id: string | null;
  model: string;
  prompt: string | null;
  negative_prompt: string | null;
  parameters: Record<string, unknown>;
  reference_image_urls: string[] | null;
  media_type: 'image' | 'video';
  media_url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  fal_request_id: string | null;
  created_at: string;
  expires_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'system';
  content: string | null;
  generation_ids: string[] | null;
  created_at: string;
}

// ============================================================
// REACT FLOW TYPES
// ============================================================

export type NodeType =
  | 'promptNode'
  | 'imageInputNode'
  | 'imageGenNode'
  | 'videoGenNode'
  | 'upscaleNode'
  | 'modifyNode'
  | 'outputNode'
  | 'galleryOutputNode'
  | 'groupNode';

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FlowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: FlowViewport;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  animated?: boolean;
}

export interface PaletteColor {
  name: string;
  hex: string;
}

// Node-specific data types — all extend Record<string, unknown> for React Flow compatibility
export interface PromptNodeData extends Record<string, unknown> {
  prompt: string;
  label?: string;
  paletteEnabled?: boolean;
  palette?: PaletteColor[];
}

export interface ImageInputNodeData extends Record<string, unknown> {
  imageUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  label?: string;
}

export interface ImageGenNodeData extends Record<string, unknown> {
  model: string;
  aspectRatio: string;
  resolution: string;
  numImages: number;
  prompt?: string;
  promptConnected?: boolean;
  inputImageUrls?: string[];
  imagePortCount?: number;
  generatedImages?: string[];
  status: NodeStatus;
  label?: string;
}

export interface VideoGenNodeData extends Record<string, unknown> {
  model: string;
  aspectRatio: string;
  duration?: number;
  prompt?: string;
  promptConnected?: boolean;
  startFrameUrl?: string;
  endFrameUrl?: string;
  videoUrl?: string;
  status: NodeStatus;
  label?: string;
}

export interface UpscaleNodeData extends Record<string, unknown> {
  model: string;
  scaleFactor: number;
  inputImageUrl?: string;
  outputImageUrl?: string;
  status: NodeStatus;
  label?: string;
}

export interface OutputNodeData extends Record<string, unknown> {
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  label?: string;
}

export interface GalleryOutputNodeData extends Record<string, unknown> {
  label?: string;
}

export interface GroupNodeData extends Record<string, unknown> {
  label?: string;
  color?: string;
}

export interface ModifyNodeData extends Record<string, unknown> {
  model: string;
  prompt?: string;
  promptConnected?: boolean;
  inputImageUrl?: string;
  outputImageUrl?: string;
  status: NodeStatus;
  label?: string;
}

export type NodeData =
  | PromptNodeData
  | ImageInputNodeData
  | ImageGenNodeData
  | VideoGenNodeData
  | UpscaleNodeData
  | ModifyNodeData
  | OutputNodeData
  | GalleryOutputNodeData
  | GroupNodeData;

export type NodeStatus = 'idle' | 'processing' | 'completed' | 'error';

// ============================================================
// API TYPES
// ============================================================

export type MediaType = 'image' | 'video';
export type Provider = 'fal' | 'google';

export interface ModelConfig {
  id: string;
  name: string;
  provider: Provider;
  type: 'image' | 'video' | 'upscale' | 'prompt';
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  maxBatchSize: number;
  supportsImageInput: boolean;
  supportsNegativePrompt: boolean;
  estimatedTimeSeconds: number;
}

export interface GenerateImageRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  numImages?: number;
  referenceImageUrls?: string[];
  seed?: number;
}

export interface GenerateVideoRequest {
  model: string;
  prompt: string;
  aspectRatio?: string;
  duration?: number;
  startFrameUrl?: string;
  endFrameUrl?: string;
}

export interface GenerateResponse {
  generationId: string;
  mediaUrls: string[];
  requestId?: string;
  status: 'completed' | 'pending';
}

export interface UpscaleRequest {
  model: string;
  imageUrl: string;
  scaleFactor?: number;
}

export interface EnhancePromptRequest {
  prompt: string;
  mediaType: 'image' | 'video';
  modelName: string;
}

// ============================================================
// UI STATE TYPES
// ============================================================

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export interface ModalState {
  isOpen: boolean;
  type?: 'generation-detail' | 'confirm-delete' | 'rename';
  data?: unknown;
}

export type Theme = 'dark' | 'light';

// ============================================================
// CHAT TYPES
// ============================================================

export type ChatMode = 'image' | 'video';

export interface ChatSettings {
  model: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
  numGenerations: number;
}

export interface ChatMessageWithGenerations extends ChatMessage {
  generations?: Generation[];
}
