import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowWorkerRunner } from './runner';
import type { FlowWorkerRunResult } from './worker';

afterEach(() => vi.useRealTimers());

describe('FlowWorkerRunner', () => {
	it('polls after idle and runs again without overlap', async () => {
		vi.useFakeTimers();
		const runOnce = vi
			.fn<() => Promise<FlowWorkerRunResult>>()
			.mockResolvedValueOnce({ status: 'idle' })
			.mockResolvedValueOnce({ status: 'succeeded', executionId: 'execution-1' })
			.mockResolvedValue({ status: 'idle' });
		const runner = new FlowWorkerRunner({ worker: { runOnce }, pollIntervalMs: 100 });

		runner.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(runOnce).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(99);
		expect(runOnce).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(runOnce).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(runOnce).toHaveBeenCalledTimes(3);
		runner.stop();
	});

	it('coalesces wakeups while work is in flight', async () => {
		vi.useFakeTimers();
		let resolve!: (result: FlowWorkerRunResult) => void;
		const runOnce = vi
			.fn<() => Promise<FlowWorkerRunResult>>()
			.mockImplementationOnce(() => new Promise((done) => (resolve = done)))
			.mockResolvedValue({ status: 'idle' });
		const runner = new FlowWorkerRunner({ worker: { runOnce }, pollIntervalMs: 100 });

		runner.start();
		await vi.advanceTimersByTimeAsync(0);
		runner.wake();
		runner.wake();
		expect(runOnce).toHaveBeenCalledTimes(1);
		resolve({ status: 'idle' });
		await vi.advanceTimersByTimeAsync(0);
		expect(runOnce).toHaveBeenCalledTimes(2);
		runner.stop();
	});

	it('stops future polls and contains worker errors', async () => {
		vi.useFakeTimers();
		const onError = vi.fn();
		const runOnce = vi.fn().mockRejectedValue(new Error('worker failure'));
		const runner = new FlowWorkerRunner({
			worker: { runOnce },
			pollIntervalMs: 100,
			onError
		});

		runner.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(onError).toHaveBeenCalledTimes(1);
		runner.stop();
		await vi.advanceTimersByTimeAsync(500);
		expect(runOnce).toHaveBeenCalledTimes(1);
	});
});
