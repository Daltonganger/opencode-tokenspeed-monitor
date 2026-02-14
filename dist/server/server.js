import { getModelStats, getRecentRequests, getSessionStats, getSessions } from "../storage/database";
function sseData(event) {
    return `data: ${JSON.stringify(event)}\n\n`;
}
export function startApiServer(db, requestedPort) {
    const subscribers = new Set();
    const createSseResponse = () => {
        let heartbeat;
        const stream = new ReadableStream({
            start(controller) {
                const subscriber = {
                    enqueue: chunk => controller.enqueue(chunk),
                    close: () => controller.close(),
                };
                subscribers.add(subscriber);
                controller.enqueue(": connected\n\n");
                heartbeat = setInterval(() => {
                    try {
                        controller.enqueue(": heartbeat\n\n");
                    }
                    catch {
                        subscribers.delete(subscriber);
                        clearInterval(heartbeat);
                    }
                }, 15000);
            },
            cancel() {
                if (heartbeat)
                    clearInterval(heartbeat);
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
    const tryStart = (port) => Bun.serve({
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
    let server;
    try {
        server = tryStart(requestedPort);
    }
    catch {
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
                }
                catch {
                    subscribers.delete(subscriber);
                    try {
                        subscriber.close();
                    }
                    catch (error) {
                        void error;
                    }
                }
            }
        },
        async stop() {
            for (const subscriber of subscribers) {
                try {
                    subscriber.close();
                }
                catch (error) {
                    void error;
                }
            }
            subscribers.clear();
            await server.stop(true);
        },
    };
}
//# sourceMappingURL=server.js.map