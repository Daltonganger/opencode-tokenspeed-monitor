import type {
  AssistantMessage,
  Event,
  EventMessagePartUpdated,
  EventMessageUpdated,
  EventSessionIdle,
  StepFinishPart,
} from "@opencode-ai/sdk";
import type { PluginState, RequestMetrics } from "../types";
import { withComputedSpeed } from "./calculator";

type CompletedHandler = (metrics: RequestMetrics) => Promise<void> | void;

function isAssistantMessageEvent(event: Event): event is EventMessageUpdated {
  return event.type === "message.updated";
}

function isPartUpdatedEvent(event: Event): event is EventMessagePartUpdated {
  return event.type === "message.part.updated";
}

function isSessionIdleEvent(event: Event): event is EventSessionIdle {
  return event.type === "session.idle";
}

function isAssistantMessage(message: EventMessageUpdated["properties"]["info"]): message is AssistantMessage {
  return message.role === "assistant";
}

function isStepFinishPart(part: EventMessagePartUpdated["properties"]["part"]): part is StepFinishPart {
  return part.type === "step-finish";
}

function toRequestMetrics(partial: Partial<RequestMetrics>): RequestMetrics | null {
  if (!partial.sessionID || !partial.messageID || !partial.modelID || partial.startedAt === undefined) {
    return null;
  }

  return {
    id: partial.id ?? crypto.randomUUID(),
    sessionID: partial.sessionID,
    messageID: partial.messageID,
    modelID: partial.modelID,
    providerID: partial.providerID,
    agent: partial.agent,
    inputTokens: partial.inputTokens ?? 0,
    outputTokens: partial.outputTokens ?? 0,
    reasoningTokens: partial.reasoningTokens ?? 0,
    cacheReadTokens: partial.cacheReadTokens ?? 0,
    cacheWriteTokens: partial.cacheWriteTokens ?? 0,
    totalTokens: partial.totalTokens ?? 0,
    startedAt: partial.startedAt,
    completedAt: partial.completedAt,
    durationMs: partial.durationMs,
    outputTps: partial.outputTps,
    totalTps: partial.totalTps,
    cost: partial.cost,
  };
}

export class MetricsCollector {
  constructor(
    private readonly state: PluginState,
    private readonly onCompleted: CompletedHandler,
  ) {}

  async handle(event: Event): Promise<void> {
    if (isAssistantMessageEvent(event)) {
      const msg = event.properties.info;
      if (!isAssistantMessage(msg)) return;

      const existing = this.state.activeRequests[msg.id] ?? {};
      this.state.activeRequests[msg.id] = {
        ...existing,
        id: existing.id ?? crypto.randomUUID(),
        sessionID: msg.sessionID,
        messageID: msg.id,
        modelID: msg.modelID,
        providerID: msg.providerID,
        agent: existing.agent,
        startedAt: existing.startedAt ?? msg.time.created,
        completedAt: msg.time.completed ?? existing.completedAt,
      };
      return;
    }

    if (isPartUpdatedEvent(event)) {
      const part = event.properties.part;
      if (!isStepFinishPart(part)) return;

      const existing = this.state.activeRequests[part.messageID] ?? {
        id: crypto.randomUUID(),
        sessionID: part.sessionID,
        messageID: part.messageID,
        startedAt: Date.now(),
        modelID: "unknown",
      };

      this.state.activeRequests[part.messageID] = {
        ...existing,
        inputTokens: part.tokens.input,
        outputTokens: part.tokens.output,
        reasoningTokens: part.tokens.reasoning,
        cacheReadTokens: part.tokens.cache.read,
        cacheWriteTokens: part.tokens.cache.write,
        totalTokens: part.tokens.input + part.tokens.output + part.tokens.reasoning,
        cost: part.cost,
        completedAt: existing.completedAt ?? Date.now(),
      };
      return;
    }

    if (isSessionIdleEvent(event)) {
      const now = Date.now();
      const pendingEntries = Object.entries(this.state.activeRequests).filter(
        ([, value]) => value.sessionID === event.properties.sessionID,
      );

      for (const [messageID, partial] of pendingEntries) {
        const candidate = toRequestMetrics({
          ...partial,
          completedAt: partial.completedAt ?? now,
        });
        if (!candidate) continue;

        const finalized = withComputedSpeed(candidate);
        this.state.lastMetrics = finalized;
        delete this.state.activeRequests[messageID];
        await this.onCompleted(finalized);
      }
    }
  }
}
