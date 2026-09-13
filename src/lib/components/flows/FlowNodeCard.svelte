<script lang="ts">
	import { flowExecutionErrorMessage } from '$lib/flows/errors';
	import ImageOutput from './ImageOutput.svelte';
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import type { FlowCanvasNode } from '$lib/flows/canvas';

	let { data, isConnectable }: NodeProps<FlowCanvasNode> = $props();
	let state = $derived(data.execution?.state ?? 'idle');
</script>

<article class:has-state={state !== 'idle'} class={`state-${state}`}>
	{#if data.definition.type !== 'input'}
		<Handle type="target" position={Position.Left} {isConnectable} />
	{/if}
	<div class="heading">
		<span class="kind">{data.label}</span>
		<span class="status" aria-label={`Node state: ${state}`}>{state.replace('_', ' ')}</span>
	</div>
	<strong>{data.summary}</strong>
	<ImageOutput value={data.execution?.payload} compact />
	{#if data.execution?.errorCode}
		<small>{flowExecutionErrorMessage(data.execution.errorCode)}</small>
	{/if}
	{#if data.definition.type !== 'output'}
		<Handle type="source" position={Position.Right} {isConnectable} />
	{/if}
</article>

<style>
	article {
		width: 13rem;
		min-height: 5.7rem;
		padding: 0.9rem 1rem;
		border: 1px solid #3a4650;
		border-radius: 0.5rem;
		background: #11171c;
		box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.24);
		color: #f5f7f8;
	}
	.heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		margin-bottom: 0.65rem;
	}
	.kind {
		color: #6ee7b7;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.status {
		color: #7f8a95;
		font-size: 0.75rem;
		text-transform: capitalize;
	}
	strong,
	small {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	strong {
		font-size: 0.875rem;
		font-weight: 600;
	}
	small {
		margin-top: 0.4rem;
		color: #ffb1ba;
		font-size: 0.75rem;
	}
	.has-state {
		border-color: #6b6040;
	}
	.state-running {
		border-color: #f8d477;
		box-shadow: 0 0 0 2px rgba(248, 212, 119, 0.13);
	}
	.state-succeeded {
		border-color: #4d8b73;
		background: #101d18;
	}
	.state-failed,
	.state-cancelled {
		border-color: #8a4651;
		background: #211418;
	}
	.state-running .status,
	.state-pending .status {
		color: #f8d477;
	}
	.state-succeeded .status {
		color: #6ee7b7;
	}
	.state-failed .status,
	.state-cancelled .status {
		color: #ff9da8;
	}
	:global(.svelte-flow__handle) {
		width: 0.55rem;
		height: 0.55rem;
		border: 2px solid #11171c;
		background: #6ee7b7;
	}
</style>
