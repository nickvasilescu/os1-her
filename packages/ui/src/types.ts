/** Shared types for OS1 surfaces, orchestrator state bus, cards, approvals, memory, and computers. */

export type Phase =
  | "preflight"
  | "operator_welcome"
  | "operator_q1"
  | "operator_q1_hesitance"
  | "operator_q2"
  | "operator_q3"
  | "initiating"
  | "samantha_first_meeting"
  | "active"
  | "asleep";

export type AgentState = "initializing" | "idle" | "listening" | "thinking" | "speaking";

export type ActiveSurface =
  | "conversation"
  | "home"
  | "inbox_cascade"
  | "your_computer"
  | "her_computer"
  | "swarm"
  | "made_just_now"
  | "connectors"
  | "voice_picker"
  | "memory"
  | "apps"
  | "atlas";

export type Surface = "startup" | "preflight" | "boot" | "setup" | "waking" | "naming" | ActiveSurface;

export interface WorkItem {
  id: string;
  label: string;
  status: string;
}

export interface MoodState {
  warmth: number;
  pace: number;
  overwhelm: number;
  compactMode: boolean;
}

export interface SpeakableAction {
  label: string;
  speakablePhrase: string;
  actionId?: string;
  tone?: "primary" | "secondary" | "danger";
}

export type Os1Card =
  | {
      kind: "ComparisonCard";
      id: string;
      title: string;
      subtitle?: string;
      options: { title: string; subtitle?: string; highlights?: string[]; meta?: string; speakablePhrase: string }[];
    }
  | {
      kind: "ChoicePairCard";
      id: string;
      prompt: string;
      left: { title: string; detail?: string; speakablePhrase: string };
      right: { title: string; detail?: string; speakablePhrase: string };
    }
  | {
      kind: "QuickDecisionCard";
      id: string;
      eyebrow?: string;
      title: string;
      body?: string;
      actions: SpeakableAction[];
    }
  | {
      kind: "ReadbackConfirmCard";
      id: string;
      stakes: "shared" | "money" | "forget" | "computer";
      title: string;
      summaryLines: string[];
      confirmAction: SpeakableAction;
      cancelAction: SpeakableAction;
    }
  | {
      kind: "DraftPreviewCard";
      id: string;
      recipient: string;
      subject?: string;
      body: string;
      actions: SpeakableAction[];
    }
  | {
      kind: "TimelineCard";
      id: string;
      title: string;
      steps: { time: string; title: string; detail?: string; status?: "done" | "now" | "next" }[];
      actions?: SpeakableAction[];
    }
  | {
      kind: "AudioSketchCard";
      id: string;
      title: string;
      mood?: string;
      duration?: string;
      bars?: number[];
      actions: SpeakableAction[];
    };

export interface CanvasState {
  title: string;
  subtitle?: string;
  cards: Os1Card[];
  createdAt?: number;
}

export interface PendingAction {
  id: string;
  source: "hermes" | "cua" | "triage" | "memory" | "inbox" | "composio" | string;
  title: string;
  summaryLines: string[];
  stakes: "low" | "shared" | "money" | "forget" | "computer";
  options: { phrase: string; choice: string }[];
  runId?: string | null;
  requestId?: string | null;
  allowRememberRule?: boolean;
  createdAt?: number;
}

export interface UndoToast {
  id: string;
  label: string;
  expiresAt: number;
}

export interface RememberedShimmer {
  id: string;
  category: string;
  summary: string;
  at: number;
}

export type MemoryCategory = "people" | "places" | "things_you_love" | "things_that_hurt" | "promises";

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  summary: string;
  detail: string;
  source: string;
  created_at: number;
}

export type ConnectorPolicy = "full_access" | "ask_before_write" | "read_only" | "ask_every_time";

export interface ConnectorItem {
  slug: string;
  label: string;
  policy: ConnectorPolicy;
  connected: boolean;
  account_label: string;
  spoken_status: string;
  updated_at?: number;
}

export interface InboxItem {
  id: string;
  number: number;
  sender: string;
  subject: string;
  snippet: string;
  received_at: string;
  keeper_score: number;
  is_vip: boolean;
  category: string;
  status: string;
}

export interface ActivityItem {
  id: string;
  source: string;
  title: string;
  detail: string;
  status: string;
  created_at: number;
}

export interface VoiceSettings {
  voiceKey: string;
  speed: number;
  temperature: number;
  styleNote: string;
}

export interface CuaManifest {
  version: string;
  mode: string;
  allowedApps: string[];
  allowedPaths: string[];
  blockedApps: string[];
  telemetryEnabled: boolean;
}

export interface CuaState {
  connected: boolean;
  status: string;
  manifest: CuaManifest;
  recentActivity: ActivityItem[];
}

export interface HerComputerState {
  online: boolean;
  resolution: string;
  recentActivity: ActivityItem[];
}

export interface Os1BusState {
  connected: boolean;
  activeSurface: ActiveSurface;
  mood: MoodState;
  runs: WorkItem[];
  canvas: CanvasState | null;
  pendingAction: PendingAction | null;
  undoToast: UndoToast | null;
  rememberedShimmer: RememberedShimmer | null;
  memories: MemoryItem[];
  connectors: ConnectorItem[];
  inbox: InboxItem[];
  voice: VoiceSettings;
  cua: CuaState;
  herComputer: HerComputerState;
  visiblePhrases: string[];
}

export interface Os1State {
  connection: "idle" | "connecting" | "connected" | "error";
  error?: string;
  /** True when the orchestrator has no LiveKit: everything but live voice still works. */
  voiceOff?: boolean;
  phase: Phase;
  agentState: AgentState;
  chips: string[];
  work: WorkItem[];
  voice: string;
  agentLine: string;
  userLine: string;
}

export interface Os1Config {
  orchestratorUrl: string;
  clientToken?: string;
}

/** Raw orchestrator fetch (Bearer token added for you). */
export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Non-snapshot frames on WS /os1/events (e.g. voice "Open Jellyfin"). */
export type Os1BusEvent =
  | { type: "open_app"; appId: string }
  | { type: "refresh_apps" }
  | { type: string; [k: string]: unknown };

// ------------------------------------------------------------------ UAO Apps & services

export interface UaoApp {
  id: string;
  appId: string;
  name: string;
  description: string;
  url: string;
  originalUrl: string;
  iconUrl: string;
  category: string;
  board: string;
  status: "up" | "down" | "unknown";
  statusCode: number | null;
  latencyMs: number | null;
  embeddable: boolean;
}

export interface UaoAppsResponse {
  ok: boolean;
  dashboardUrl: string;
  boards: { id: string; name: string; title: string }[];
  count: number;
  apps: UaoApp[];
  fetchedAt: number;
}

// ------------------------------------------------------------------ Atlas

export interface AtlasAgent {
  id: string;
  name: string;
  glyph: string;
  accent: string;
  instructions: string;
  model: string | null;
  temperature: number | null;
  tools: string[];
  mutating: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface AtlasThread {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  agentGlyph: string;
  workspaceId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AtlasMessage {
  id: string;
  threadId: string;
  runId: string | null;
  role: "user" | "assistant" | string;
  content: string;
  interrupted?: boolean;
  createdAt: number;
}

export interface AtlasRun {
  id: string;
  agentId: string;
  threadId: string;
  task: string;
  status: string;
  model: string | null;
  steps: number;
  toolCalls: number;
  error: string | null;
  parentRunId: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface AtlasStep {
  id: string;
  [k: string]: unknown;
}

export interface AtlasThreadDetail {
  thread: AtlasThread;
  messages: AtlasMessage[];
  runs: AtlasRun[];
  steps: AtlasStep[];
  pending: Record<string, unknown> | null;
}

export interface AtlasWorkspace {
  id: string;
  name: string;
  description: string;
  fileCount: number;
  createdAt: number;
}

export interface AtlasFile {
  id: string;
  path: string;
  content: string;
  updatedAt: number;
}

export interface AtlasMemory {
  id: string;
  agentId: string;
  agentName: string;
  agentGlyph: string;
  agentAccent: string;
  text: string;
  sourceRunId: string | null;
  createdAt: number;
}

export interface AtlasActivity {
  agentGlyph: string;
  agentName: string;
  threadTitle: string;
  run: AtlasRun;
}

export interface AtlasModel {
  id: string;
  name: string;
  description: string;
  tools: unknown;
}

export interface AtlasMe {
  user: { name: string; email: string; sub: string };
  usage: { used: number; limit: number; resetsAt: number };
  capabilities: { ai: boolean; database: boolean; backend: { configured: boolean; reachable: boolean; models: number; url: string } };
}

export type AtlasSchedule = { id: string; [k: string]: unknown };

/** One Server-Sent Event from POST /run or /run/:id/approval. */
export type AtlasRunEvent =
  | { type: "start"; threadId: string; thread?: AtlasThread; run?: AtlasRun; assistantMessageId?: string; userMessage?: AtlasMessage }
  | { type: "tool_start"; step: AtlasStep }
  | { type: "step"; step: AtlasStep }
  | { type: "delta"; text: string }
  | { type: "paused"; message?: AtlasMessage; run?: AtlasRun }
  | { type: "done"; message?: AtlasMessage; run?: AtlasRun; usage?: unknown }
  | { type: "error"; message?: string };
