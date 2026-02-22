import type { Database } from "bun:sqlite";
export interface UploadDispatcherHandle {
    flushNow(): Promise<void>;
    stop(): void;
}
type UploadDispatcherOptions = {
    db: Database;
    hubURL: string;
    intervalSeconds?: number;
    logger?: (message: string) => Promise<void> | void;
};
export declare function startUploadDispatcher(options: UploadDispatcherOptions): UploadDispatcherHandle;
export {};
//# sourceMappingURL=dispatcher.d.ts.map