<script lang="ts">
	import type { FlowNodeV1, FlowTransformConfigV1 } from '$lib/flows/types';

	interface ModelOption {
		id: string;
		name: string;
	}

	interface Props {
		node: FlowNodeV1;
		models: ModelOption[];
		predecessorIds: string[];
		onupdate: (node: FlowNodeV1) => void;
		ondelete: (nodeId: string) => void;
		onclose: () => void;
	}

	let { node, models, predecessorIds, onupdate, ondelete, onclose }: Props = $props();

	function inputValue(event: Event): string {
		return (event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
			.value;
	}

	function optionalNumber(event: Event): number | undefined {
		const value = inputValue(event);
		return value === '' ? undefined : Number(value);
	}

	function transformConfig(operation: string): FlowTransformConfigV1 {
		if (operation === 'uppercase' || operation === 'lowercase' || operation === 'trim')
			return { operation };
		if (operation === 'replace') return { operation, search: '', replacement: '' };
		if (operation === 'extract') return { operation, path: 'value' };
		const predecessor = predecessorIds[0] ?? 'input';
		return { operation: 'template', template: `{{node.${predecessor}.output}}` };
	}

	function updateReplace(field: 'search' | 'replacement', value: string) {
		if (node.type !== 'transform' || node.config.operation !== 'replace') return;
		onupdate({ ...node, config: { ...node.config, [field]: value } });
	}

	function updateExtractPath(path: string) {
		if (node.type !== 'transform' || node.config.operation !== 'extract') return;
		onupdate({ ...node, config: { ...node.config, path } });
	}

	function updateTemplate(template: string) {
		if (node.type !== 'transform' || node.config.operation !== 'template') return;
		onupdate({ ...node, config: { ...node.config, template } });
	}
</script>

<section class="config" aria-labelledby="node-configuration">
	<header>
		<div>
			<p>Selected node</p>
			<h3 id="node-configuration">{node.type} settings</h3>
			<code>{node.id}</code>
		</div>
		<button class="close" type="button" aria-label="Close node settings" onclick={onclose}>×</button
		>
	</header>

	{#if node.type === 'input'}
		<label
			>Input key<input
				value={node.config.key}
				required
				maxlength="64"
				oninput={(event) =>
					onupdate({ ...node, config: { ...node.config, key: inputValue(event) } })}
			/></label
		>
		<label
			>Input type<select
				value={node.config.kind ?? 'text'}
				onchange={(event) =>
					onupdate({
						...node,
						config: {
							key: node.config.key,
							kind: inputValue(event) === 'images' ? 'images' : 'text'
						}
					})}
				><option value="text">Text</option><option value="images">Images or sketch</option></select
			></label
		>
		{#if node.config.kind !== 'images'}
			<label
				>Default value<textarea
					value={node.config.defaultValue ?? ''}
					rows="5"
					maxlength="16384"
					oninput={(event) => {
						const value = inputValue(event);
						onupdate({
							...node,
							config: {
								key: node.config.key,
								...(value === '' ? {} : { defaultValue: value })
							}
						});
					}}></textarea></label
			>
		{/if}
	{:else if node.type === 'image'}
		<label
			>Operation<select
				value={node.config.operation}
				onchange={(event) =>
					onupdate({
						...node,
						config: {
							...node.config,
							operation: inputValue(event) === 'edit' ? 'edit' : 'generate'
						}
					})}
				><option value="generate">Generate image</option><option value="edit"
					>Edit reference images</option
				></select
			></label
		>
		<label
			>Prompt template<textarea
				value={node.config.prompt}
				rows="7"
				maxlength="32768"
				oninput={(event) =>
					onupdate({ ...node, config: { ...node.config, prompt: inputValue(event) } })}
			></textarea><small
				>Reference a text input or Model output with <code>{'{{node.<id>.output}}'}</code>.</small
			></label
		>
		<label
			>Image size<select
				value={node.config.size ?? ''}
				onchange={(event) => {
					const size = inputValue(event) as '1024x1024' | '1536x1024' | '1024x1536' | '';
					onupdate({ ...node, config: { ...node.config, size: size || undefined } });
				}}
				><option value="">Open WebUI default</option><option value="1024x1024"
					>Square - 1024 - 1024</option
				><option value="1536x1024">Landscape - 1536 - 1024</option><option value="1024x1536"
					>Portrait - 1024 - 1536</option
				></select
			></label
		>
		<small
			>Uses the image model configured in Open WebUI. Supported sizes depend on that model. For
			editing, connect an Images input or a previous Image node.</small
		>
	{:else if node.type === 'model'}
		<label
			>Model<select
				value={node.config.modelId}
				required
				disabled={models.length === 0}
				onchange={(event) =>
					onupdate({ ...node, config: { ...node.config, modelId: inputValue(event) } })}
			>
				<option value="" disabled>Select a model</option>
				{#each models as model (model.id)}<option value={model.id}>{model.name}</option>{/each}
			</select></label
		>
		<label
			>Prompt template<textarea
				value={node.config.prompt}
				rows="8"
				required
				maxlength="32768"
				oninput={(event) =>
					onupdate({ ...node, config: { ...node.config, prompt: inputValue(event) } })}></textarea>
			<small>Reference earlier output with <code>{'{{node.<id>.output}}'}</code>.</small></label
		>
		<div class="numbers">
			<label
				>Temperature<input
					type="number"
					min="0"
					max="2"
					step="0.1"
					value={node.config.temperature ?? ''}
					oninput={(event) => {
						const temperature = optionalNumber(event);
						onupdate({
							...node,
							config: {
								...node.config,
								...(temperature === undefined ? { temperature: undefined } : { temperature })
							}
						});
					}}
				/></label
			>
			<label
				>Max tokens<input
					type="number"
					min="1"
					max="32768"
					step="1"
					value={node.config.maxTokens ?? ''}
					oninput={(event) => {
						const maxTokens = optionalNumber(event);
						onupdate({
							...node,
							config: {
								...node.config,
								...(maxTokens === undefined ? { maxTokens: undefined } : { maxTokens })
							}
						});
					}}
				/></label
			>
		</div>
	{:else if node.type === 'transform'}
		<label
			>Operation<select
				value={node.config.operation}
				onchange={(event) => onupdate({ ...node, config: transformConfig(inputValue(event)) })}
			>
				<option value="trim">Trim whitespace</option>
				<option value="uppercase">Uppercase</option>
				<option value="lowercase">Lowercase</option>
				<option value="replace">Replace text</option>
				<option value="extract">Extract JSON path</option>
				<option value="template">Template</option>
			</select></label
		>
		{#if node.config.operation === 'replace'}
			<label
				>Search<input
					value={node.config.search}
					required
					maxlength="1024"
					oninput={(event) => updateReplace('search', inputValue(event))}
				/></label
			>
			<label
				>Replacement<input
					value={node.config.replacement}
					maxlength="4096"
					oninput={(event) => updateReplace('replacement', inputValue(event))}
				/></label
			>
		{:else if node.config.operation === 'extract'}
			<label
				>JSON path<input
					value={node.config.path}
					required
					maxlength="256"
					placeholder="result.summary"
					oninput={(event) => updateExtractPath(inputValue(event))}
				/></label
			>
		{:else if node.config.operation === 'template'}
			<label
				>Template<textarea
					value={node.config.template}
					rows="7"
					required
					maxlength="32768"
					oninput={(event) => updateTemplate(inputValue(event))}></textarea></label
			>
		{/if}
	{:else}
		<label
			>Output format<select
				value={node.config.format}
				onchange={(event) => {
					const value = inputValue(event);
					const format = value === 'images' ? 'images' : value === 'json' ? 'json' : 'text';
					onupdate({ ...node, config: { format } });
				}}
			>
				<option value="text">Text</option>
				<option value="json">JSON</option>
				<option value="images">Images</option>
			</select></label
		>
	{/if}

	<footer>
		<button class="delete" type="button" onclick={() => ondelete(node.id)}>Delete node</button>
	</footer>
</section>

<style>
	.config {
		display: grid;
		gap: 1rem;
		width: min(21rem, calc(100vw - 4rem));
		max-height: calc(100% - 2rem);
		overflow-y: auto;
		padding: 1rem;
		border: 1px solid #34413c;
		border-radius: 0.75rem;
		background: rgba(11, 15, 19, 0.97);
		box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.45);
	}
	header {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
	}
	header p {
		margin: 0;
		color: #6ee7b7;
		font-size: var(--flow-help-font, 0.75rem);
		font-weight: 600;
		line-height: 1.5;
	}
	h3 {
		margin: 0.3rem 0 0.35rem;
		text-transform: capitalize;
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.5;
	}
	header code {
		color: #8d98a3;
		font-size: var(--flow-help-font, 0.75rem);
	}
	.close {
		display: grid;
		place-items: center;
		width: var(--flow-control-height, 2.25rem);
		height: var(--flow-control-height, 2.25rem);
		border-radius: var(--flow-radius, 0.375rem);
		border: 0;
		background: transparent;
		color: #aeb6bf;
		font-size: 1.5rem;
		cursor: pointer;
	}
	label {
		display: grid;
		gap: 0.4rem;
		color: #c7ced5;
		font-size: var(--flow-label-font, 0.8125rem);
	}
	input,
	textarea,
	select {
		width: 100%;
		border: 1px solid #303944;
		border-radius: var(--flow-radius, 0.375rem);
		background: #070a0d;
		color: #f5f7f8;
		min-height: var(--flow-control-height, 2.25rem);
		padding: 0.4375rem 0.625rem;
		font: inherit;
		font-size: var(--flow-control-font, 0.875rem);
		line-height: 1.25rem;
	}
	textarea {
		resize: vertical;
		line-height: 1.45;
	}
	small {
		color: #8d98a3;
		font-size: var(--flow-help-font, 0.75rem);
		line-height: 1.5;
	}
	.numbers {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.7rem;
	}
	footer {
		padding-top: 1rem;
		border-top: 1px solid #252d35;
	}
	.delete {
		border: 1px solid #743b45;
		border-radius: var(--flow-radius, 0.375rem);
		background: #2b171b;
		color: #ffc5cc;
		min-height: var(--flow-control-height, 2.25rem);
		padding: 0.4375rem 0.75rem;
		font: inherit;
		font-size: var(--flow-control-font, 0.875rem);
		line-height: 1.25rem;
		font-weight: 500;
		cursor: pointer;
	}

	input:focus-visible,
	textarea:focus-visible,
	select:focus-visible,
	button:focus-visible {
		outline: 2px solid #6ee7b7;
		outline-offset: 2px;
	}
	.close:hover {
		background: #222d34;
	}
	.delete:hover {
		background: #402129;
	}
</style>
