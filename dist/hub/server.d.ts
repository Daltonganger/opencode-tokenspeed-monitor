import type { Database } from "bun:sqlite";
export interface HubServerHandle {
    port: number;
    url: string;
    stop(): Promise<void>;
}
export type HubServerOptions = {
    db?: Database;
    signingKey?: string;
    inviteToken?: string;
    adminToken?: string;
    allowedDevices?: Set<string>;
    adminLoginWindowSeconds?: number;
    adminLoginMaxAttempts?: number;
};
export declare function startHubServer(requestedPort?: number, options?: HubServerOptions): HubServerHandle;
//# sourceMappingURL=server.d.ts.map