<script lang="ts">
	import ImageInput from '$lib/components/flows/ImageInput.svelte';
	let {
		fileId,
		onchange,
		disabled = false
	}: { fileId: string; onchange: (id: string) => void; disabled?: boolean } = $props();
</script>

<ImageInput
	value={fileId ? { kind: 'images', fileIds: [fileId] } : undefined}
	{disabled}
	onchange={(value) => onchange(value.fileIds.at(-1) ?? '')}
/>
