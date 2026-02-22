import { startHubServer } from "./server";
const server = startHubServer();
console.log(`TokenSpeed hub listening on ${server.url}`);
const shutdown = async () => {
    await server.stop();
    process.exit(0);
};
process.on("SIGINT", () => {
    void shutdown();
});
process.on("SIGTERM", () => {
    void shutdown();
});
//# sourceMappingURL=main.js.map