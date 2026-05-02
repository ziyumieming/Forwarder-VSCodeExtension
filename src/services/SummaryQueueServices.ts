import { logger } from '../utils/logger';

export class SummaryQueueService {
    private readonly pending = new Map<string, Promise<unknown>>();
    private readonly queue: Array<() => void> = [];
    private activeCount = 0;

    constructor(private readonly concurrency: number = 2) { }

    public enqueue<T>(key: string, execute: () => Promise<T>): Promise<T> {
        const existing = this.pending.get(key);
        if (existing) {
            logger.info(`[SummaryQueueService] Merged pending summary request: key=${key}`);
            return existing as Promise<T>;
        }

        const promise = new Promise<T>((resolve, reject) => {
            const run = () => {
                this.activeCount += 1;
                logger.info(`[SummaryQueueService] Started summary request: key=${key}, active=${this.activeCount}, queued=${this.queue.length}`);
                execute()
                    .then(result => {
                        logger.info(`[SummaryQueueService] Succeeded summary request: key=${key}`);
                        resolve(result);
                    }, error => {
                        logger.error(`[SummaryQueueService] Failed summary request: key=${key}, error=${error?.message || error}`);
                        reject(error);
                    })
                    .finally(() => {
                        this.activeCount -= 1;
                        this.pending.delete(key);
                        logger.info(`[SummaryQueueService] Settled summary request: key=${key}, active=${this.activeCount}, queued=${this.queue.length}`);
                        this.drain();
                    });
            };

            this.queue.push(run);
            this.drain();
        });

        this.pending.set(key, promise);
        return promise;
    }

    private drain(): void {
        const limit = Math.max(1, Math.floor(this.concurrency || 1));
        while (this.activeCount < limit && this.queue.length > 0) {
            const next = this.queue.shift();
            next?.();
        }
    }
}
