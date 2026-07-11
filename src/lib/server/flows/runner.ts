import type { FlowWorkerRunResult } from './worker';

export interface FlowWorkerLike {
	runOnce(): Promise<FlowWorkerRunResult>;
}

export interface FlowWorkerRunnerOptions {
	worker: FlowWorkerLike;
	pollIntervalMs?: number;
	onError?: () => void;
}

export class FlowWorkerRunner {
	private readonly pollIntervalMs: number;
	private running = false;
	private inFlight = false;
	private wakePending = false;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly options: FlowWorkerRunnerOptions) {
		this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
		if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 10)
			throw new Error('pollIntervalMs must be an integer of at least 10');
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.schedule(0);
	}

	stop(): void {
		this.running = false;
		this.wakePending = false;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	wake(): void {
		if (!this.running) return;
		if (this.inFlight) {
			this.wakePending = true;
			return;
		}
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.schedule(0);
	}

	private schedule(delay: number): void {
		if (!this.running || this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.tick();
		}, delay);
		this.timer.unref?.();
	}

	private async tick(): Promise<void> {
		if (!this.running || this.inFlight) return;
		this.inFlight = true;
		let result: FlowWorkerRunResult | undefined;
		try {
			result = await this.options.worker.runOnce();
		} catch {
			this.options.onError?.();
		} finally {
			this.inFlight = false;
		}
		if (!this.running) return;
		const immediate = this.wakePending || (result !== undefined && result.status !== 'idle');
		this.wakePending = false;
		this.schedule(immediate ? 0 : this.pollIntervalMs);
	}
}
