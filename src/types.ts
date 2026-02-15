export interface RequestMetrics {
  id: string;
  sessionID: string;
  messageID: string;
  modelID: string;
  providerID?: string;
  agent?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  outputTps?: number;
  totalTps?: number;
  cost?: number;
}

export interface ModelStats {
  modelID: string;
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgOutputTps: number | null;
  minOutputTps: number | null;
  maxOutputTps: number | null;
  lastSeen: number | null;
}

export interface PluginState {
  enabled: boolean;
  backgroundEnabled: boolean;
  apiUrl: string | null;
  sessionStats: {
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  };
  activeRequests: Record<string, Partial<RequestMetrics>>;
  lastMetrics: RequestMetrics | null;
}

export interface ToastOptions {
  title: string;
  message: string;
  variant?: "info" | "success" | "warning" | "error";
  duration?: number;
}
