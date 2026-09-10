<script lang="ts">
	import { resolve } from '$app/paths';

	let { data } = $props();
	let previewItem = $state<(typeof data.items)[number] | null>(null);
	let failedThumbnails = $state<string[]>([]);
	const loginHref = resolve(`/auth/login?return=${encodeURIComponent(resolve('/media'))}`);
	const contentUrl = (id: string) => resolve('/media/[id]/content', { id });
	const nextQuery = () =>
		[
			data.query ? `q=${encodeURIComponent(data.query)}` : '',
			data.nextCursor ? `cursor=${encodeURIComponent(data.nextCursor)}` : ''
		]
			.filter(Boolean)
			.join('&');
	const formatBytes = (value: number | null) => {
		if (value === null) return 'Unknown size';
		if (value < 1024) return `${value} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let size = value / 1024;
		let unit = 0;
		while (size >= 1024 && unit < units.length - 1) {
			size /= 1024;
			unit += 1;
		}
		return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
	};
	const formatDate = (value: number | null) =>
		value === null
			? ''
			: new Date(value < 1_000_000_000_000 ? value * 1000 : value).toLocaleDateString();
	const closePreview = () => (previewItem = null);
</script>

<svelte:head>
	<title>Studio · Media</title>
	<meta name="description" content="Browse and preview media stored in Open WebUI" />
</svelte:head>

<svelte:window onkeydown={(event) => event.key === 'Escape' && closePreview()} />

<main>
	<nav>
		<a class="brand" href={resolve('/')}>Studio</a>
		<a href={resolve('/agents')}>Agents</a>
		<a class="active" href={resolve('/media')}>Media</a>
		<a href={resolve('/flows')}>Flows</a>
		{#if data.authenticated}
			<form method="POST" action={resolve('/auth/logout')}><button>Sign out</button></form>
		{/if}
	</nav>

	<header>
		<p class="eyebrow">Open WebUI files</p>
		<h1>Your media</h1>
		<p class="lede">Browse, preview and download images, video and audio you own.</p>
	</header>

	{#if !data.authenticated}
		<section class="state">
			<h2>Sign in to view your media.</h2>
			<a class="primary" href={loginHref}>Sign in</a>
		</section>
	{:else if data.state === 'ready'}
		<form class="search" method="GET" action={resolve('/media')}>
			<label for="media-search">Search filenames</label>
			<div>
				<input
					id="media-search"
					name="q"
					value={data.query}
					maxlength="200"
					placeholder="Search media"
				/>
				<button type="submit">Search</button>
				{#if data.query}<a href={resolve('/media')}>Clear</a>{/if}
			</div>
		</form>

		{#if data.items.length === 0}
			<section class="state">
				<h2>
					{data.nextCursor
						? 'No media in this batch.'
						: data.query
							? 'No matching media.'
							: 'No media yet.'}
				</h2>
				<p>
					{data.nextCursor
						? 'Continue to scan the next bounded batch.'
						: data.query
							? 'Try a different filename.'
							: 'Media stored in Open WebUI will appear here.'}
				</p>
				{#if data.nextCursor}<a class="next" href={resolve(`/media?${nextQuery()}`)}>Continue →</a
					>{/if}
			</section>
		{:else}
			<section class="grid" aria-label="Media results">
				{#each data.items as item (item.id)}
					<article>
						<button
							class="preview"
							type="button"
							onclick={() => (previewItem = item)}
							aria-label={`Preview ${item.filename}`}
						>
							{#if item.mediaType === 'image' && !failedThumbnails.includes(item.id)}
								<img
									src={contentUrl(item.id)}
									alt=""
									loading="lazy"
									decoding="async"
									onerror={() => (failedThumbnails = [...failedThumbnails, item.id])}
								/>
							{:else}
								<span class="preview-fallback" aria-hidden="true">
									<span class="media-symbol">
										{item.mediaType === 'image' ? '▧' : item.mediaType === 'video' ? '▶' : '♪'}
									</span>
									{#if item.mediaType === 'image'}<span>Preview unavailable</span>{/if}
								</span>
							{/if}
						</button>
						<div class="details">
							<h2 title={item.filename}>{item.filename}</h2>
							<p>
								{item.mediaType} · {formatBytes(item.size)}{item.updatedAt
									? ` · ${formatDate(item.updatedAt)}`
									: ''}
							</p>
							<div class="actions">
								<button type="button" onclick={() => (previewItem = item)}>Preview</button>
								<a href={resolve(`/media/${encodeURIComponent(item.id)}/content?download=1`)}
									>Download</a
								>
							</div>
						</div>
					</article>
				{/each}
			</section>
			{#if data.nextCursor}<a class="next" href={resolve(`/media?${nextQuery()}`)}>Next page →</a
				>{/if}
		{/if}
	{:else}
		<section class="state error">
			<h2>
				{data.state === 'permission_denied' ? 'Media access denied.' : 'Open WebUI is unavailable.'}
			</h2>
			<p>
				{data.state === 'permission_denied'
					? 'This account cannot access the requested media.'
					: 'Try again when the upstream service is available.'}
			</p>
		</section>
	{/if}
</main>

{#if previewItem}
	<div
		class="modal"
		role="presentation"
		onclick={(event) => event.currentTarget === event.target && closePreview()}
	>
		<div
			class="dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="preview-title"
			tabindex="-1"
		>
			<header>
				<div>
					<p class="eyebrow">Preview</p>
					<h2 id="preview-title">{previewItem.filename}</h2>
				</div>
				<button class="close" type="button" onclick={closePreview} aria-label="Close preview"
					>×</button
				>
			</header>
			<div class="viewer">
				{#if previewItem.mediaType === 'image'}
					<img src={contentUrl(previewItem.id)} alt={previewItem.filename} />
				{:else if previewItem.mediaType === 'video'}
					<video src={contentUrl(previewItem.id)} controls preload="metadata">
						<track kind="captions" />
					</video>
				{:else}
					<audio src={contentUrl(previewItem.id)} controls preload="metadata"></audio>
				{/if}
			</div>
			<footer>
				<a
					class="primary"
					href={resolve(`/media/${encodeURIComponent(previewItem.id)}/content?download=1`)}
					>Download</a
				>
			</footer>
		</div>
	</div>
{/if}

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		min-width: 320px;
		background:
			radial-gradient(circle at 80% 0%, rgba(110, 231, 183, 0.11), transparent 30rem), #0b0d10;
		color: #f5f7f8;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	main {
		width: min(78rem, calc(100% - 3rem));
		margin: auto;
		padding: 1.5rem 0 5rem;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}
	nav a,
	nav button {
		color: #aeb6bf;
		text-decoration: none;
		background: none;
		border: 0;
		font: inherit;
		cursor: pointer;
	}
	.brand {
		margin-right: auto;
		color: #f5f7f8;
		font-weight: 750;
	}
	nav .active {
		color: #6ee7b7;
	}
	main > header {
		padding: clamp(4rem, 10vh, 7rem) 0 2rem;
	}
	.eyebrow {
		margin: 0;
		color: #6ee7b7;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0.5rem 0 1rem;
		font-size: clamp(3.5rem, 9vw, 7rem);
		letter-spacing: -0.07em;
		line-height: 0.95;
	}
	.lede,
	.state p {
		color: #aeb6bf;
		font-size: 1.05rem;
	}
	.search {
		margin: 1rem 0 2rem;
	}
	.search label {
		display: block;
		margin-bottom: 0.55rem;
		color: #aeb6bf;
		font-size: 0.85rem;
	}
	.search div {
		display: flex;
		gap: 0.65rem;
		align-items: center;
	}
	.search input {
		min-width: 0;
		width: min(30rem, 100%);
		padding: 0.8rem 1rem;
		border: 1px solid #303842;
		border-radius: 0.75rem;
		background: #12161b;
		color: #f5f7f8;
		font: inherit;
	}
	.search button,
	.actions button {
		padding: 0.75rem 1rem;
		border: 0;
		border-radius: 0.7rem;
		background: #26313a;
		color: #f5f7f8;
		cursor: pointer;
	}
	.search a,
	.actions a {
		color: #6ee7b7;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 1rem;
	}
	article {
		overflow: hidden;
		border: 1px solid #242b32;
		border-radius: 1rem;
		background: #11151a;
	}
	.preview {
		position: relative;
		display: grid;
		width: 100%;
		aspect-ratio: 16 / 10;
		padding: 0;
		place-items: center;
		overflow: hidden;
		border: 0;
		background: #080a0d;
		color: #6ee7b7;
		cursor: pointer;
	}
	.preview img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.preview:focus-visible {
		outline: 2px solid #6ee7b7;
		outline-offset: -2px;
	}
	.preview-fallback {
		display: grid;
		gap: 0.5rem;
		place-items: center;
	}
	.media-symbol {
		font-size: 3rem;
	}
	.details {
		padding: 1rem;
	}
	.details h2 {
		overflow: hidden;
		margin: 0;
		font-size: 1rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.details p {
		margin: 0.4rem 0 1rem;
		color: #8f99a4;
		font-size: 0.8rem;
		text-transform: capitalize;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.actions button {
		padding: 0.5rem 0.75rem;
	}
	.state {
		padding: 3rem;
		border: 1px solid #242b32;
		border-radius: 1rem;
		background: #11151a;
	}
	.state h2 {
		margin-top: 0;
	}
	.state.error {
		border-color: #743b45;
		background: #2b171b;
	}
	.primary {
		display: inline-block;
		padding: 0.75rem 1.1rem;
		border-radius: 999px;
		background: #6ee7b7;
		color: #082a1d;
		text-decoration: none;
		font-weight: 750;
	}
	.next {
		display: inline-block;
		margin-top: 2rem;
		color: #6ee7b7;
	}
	.modal {
		position: fixed;
		z-index: 20;
		inset: 0;
		display: grid;
		padding: 1rem;
		place-items: center;
		background: rgba(0, 0, 0, 0.78);
	}
	.modal > .dialog {
		width: min(68rem, 100%);
		max-height: calc(100vh - 2rem);
		overflow: auto;
		border: 1px solid #333c45;
		border-radius: 1rem;
		background: #101419;
		box-shadow: 0 2rem 6rem rgba(0, 0, 0, 0.55);
	}
	.modal header {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
	}
	.modal h2 {
		max-width: 55rem;
		margin: 0.3rem 0 0;
		overflow-wrap: anywhere;
	}
	.close {
		border: 0;
		background: none;
		color: #f5f7f8;
		font-size: 2rem;
		cursor: pointer;
	}
	.viewer {
		display: grid;
		min-height: 18rem;
		padding: 1rem;
		place-items: center;
		background: #060708;
	}
	.viewer img,
	.viewer video {
		max-width: 100%;
		max-height: 68vh;
	}
	.viewer audio {
		width: min(38rem, 100%);
	}
	.modal footer {
		padding: 1rem 1.25rem;
		text-align: right;
	}
	@media (max-width: 700px) {
		main {
			width: min(100% - 2rem, 78rem);
		}
		nav {
			gap: 0.8rem;
		}
		.search div {
			flex-wrap: wrap;
		}
		.search input {
			width: 100%;
		}
		.state {
			padding: 1.5rem;
		}
	}
</style>
