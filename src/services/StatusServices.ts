import * as vscode from 'vscode';
import { AnalysisIndexStatus, GraphViewData } from '../models/GraphDefinition';

export interface AnalysisQueueState {
    isUpdating: boolean;
    queueLength: number;
    activeTask?: string;
    generation: number;
}

export class AnalysisIndexStatusService {
    private snapshotReadyPromise: Promise<void>;
    private resolveSnapshotReady!: () => void;
    private snapshotReady = false;
    private queueState: AnalysisQueueState = {
        isUpdating: false,
        queueLength: 0,
        generation: 0
    };
    private listeners: Set<(status: AnalysisIndexStatus) => void> = new Set();

    constructor() {
        this.snapshotReadyPromise = this.createSnapshotReadyPromise();
    }

    public onStatusChanged(listener: (status: AnalysisIndexStatus) => void): vscode.Disposable {
        this.listeners.add(listener);
        listener(this.getStatus());
        return new vscode.Disposable(() => {
            this.listeners.delete(listener);
        });
    }

    public getStatus(overrides: Partial<AnalysisIndexStatus> = {}): AnalysisIndexStatus {
        const status: AnalysisIndexStatus = {
            snapshotReady: this.snapshotReady,
            isUpdating: this.queueState.isUpdating,
            queueLength: this.queueState.queueLength,
            activeTask: this.queueState.activeTask,
            generation: this.queueState.generation
        };

        return {
            ...status,
            stale: status.isUpdating,
            ...overrides
        };
    }

    public waitForSnapshotReady(): Promise<void> {
        return this.snapshotReadyPromise;
    }

    public resetSnapshotReady(): void {
        this.snapshotReady = false;
        this.snapshotReadyPromise = this.createSnapshotReadyPromise();
        this.emit();
    }

    public markSnapshotReady(): void {
        if (!this.snapshotReady) {
            this.snapshotReady = true;
            this.resolveSnapshotReady();
        }
        this.emit();
    }

    public updateQueueState(state: AnalysisQueueState, overrides: Partial<AnalysisIndexStatus> = {}): void {
        this.queueState = { ...state };
        this.emit(overrides);
    }

    public attachToGraphView(result: GraphViewData): GraphViewData {
        return {
            ...result,
            meta: {
                ...(result.meta || {}),
                indexStatus: this.getStatus()
            }
        };
    }

    private emit(overrides: Partial<AnalysisIndexStatus> = {}): void {
        const status = this.getStatus(overrides);
        for (const listener of this.listeners) {
            listener(status);
        }
    }

    private createSnapshotReadyPromise(): Promise<void> {
        return new Promise((resolve) => {
            this.resolveSnapshotReady = resolve;
        });
    }
}
