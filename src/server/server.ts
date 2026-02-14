import type { Database } from "bun:sqlite";
import { getModelStats, getRecentRequests, getSessionStats, getSessions } from "../storage/database";

export interface LiveMetricEvent {
  sessionID: string;
  messageID: string;
  modelID: string;
  outputTokens: number;
  outputTps?: number;
  durationMs?: number;
  completedAt?: number;
}

export interface ApiServerHandle {
  port: number;
  url: string;
  publish(event: LiveMetricEvent): void;
  stop(): Promise<void>;
}

type StreamController = {
  enqueue: (chunk: string) => void;
  close: () => void;
};

function sseData(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function startApiServer(db: Database, requestedPort: number): ApiServerHandle {
  const subscribers = new Set<StreamController>();

  const createSseResponse = () => {
    let heartbeat: Timer | undefined;

    const stream = new ReadableStream<string>({
      start(controller) {
        const subscriber: StreamController = {
          enqueue: chunk => controller.enqueue(chunk),
          close: () => controller.close(),
        };

        subscribers.add(subscriber);
        controller.enqueue(": connected\n\n");

        heartbeat = setInterval(() => {
          try {
            controller.enqueue(": heartbeat\n\n");
          } catch {
            subscribers.delete(subscriber);
            clearInterval(heartbeat);
          }
        }, 15000);
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };

  const tryStart = (port: number) =>
    Bun.serve({
      port,
      routes: {
        "/api/stats": () => Response.json(getSessionStats(db)),
        "/api/stats/models": () => Response.json(getModelStats(db)),
        "/api/history": req => {
          const url = new URL(req.url);
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw ? Number(limitRaw) : 100;
          return Response.json(getRecentRequests(db, Number.isFinite(limit) ? limit : 100));
        },
        "/api/sessions": req => {
          const url = new URL(req.url);
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw ? Number(limitRaw) : 100;
          return Response.json(getSessions(db, Number.isFinite(limit) ? limit : 100));
        },
        "/api/live": () => createSseResponse(),
      },
      fetch: () => new Response("Not Found", { status: 404 }),
    });

  let server: Bun.Server<unknown>;
  try {
    server = tryStart(requestedPort);
  } catch {
    server = tryStart(0);
  }

  return {
    port: server.port ?? requestedPort,
    url: server.url.toString(),
    publish(event) {
      const payload = sseData(event);
      for (const subscriber of subscribers) {
        try {
          subscriber.enqueue(payload);
        } catch {
          subscribers.delete(subscriber);
          try {
            subscriber.close();
          } catch (error) {
            void error;
          }
        }
      }
    },
    async stop() {
      for (const subscriber of subscribers) {
        try {
          subscriber.close();
        } catch (error) {
          void error;
        }
      }
      subscribers.clear();
      await server.stop(true);
    },
  };
}
