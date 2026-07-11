<svelte:head>
	<title>Open WebUI Studio</title>
	<meta
		name="description"
		content="Studio workspace for Open WebUI agents, media, timelines, and flows"
	/>
</svelte:head>

<main>
	<div class="eyebrow">Open WebUI companion</div>
	<h1>Studio</h1>
	<p class="lede">
		A separate workspace for agents, media, timelines, and flows. Open WebUI remains the authority
		for identity and access.
	</p>

	<section aria-labelledby="foundation-heading">
		<div>
			<p class="section-label">Foundation status</p>
			<h2 id="foundation-heading">The boundary is in place.</h2>
		</div>
		<ul>
			<li><span>Identity</span><strong>Server-side</strong></li>
			<li><span>OWUI data</span><strong>API only</strong></li>
			<li><span>Studio data</span><strong>Independent</strong></li>
		</ul>
	</section>

	<p class="note">
		Authentication and the typed Open WebUI adapter are the next implementation slice.
	</p>
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		min-width: 320px;
		background:
			radial-gradient(circle at 75% 8%, rgba(110, 231, 183, 0.12), transparent 28rem), #0b0d10;
		color: #f5f7f8;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}

	main {
		width: min(70rem, calc(100% - 3rem));
		margin: 0 auto;
		padding: clamp(5rem, 14vh, 9rem) 0 4rem;
	}

	.eyebrow,
	.section-label {
		color: #6ee7b7;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0.4rem 0 0;
		font-size: clamp(4rem, 13vw, 9rem);
		font-weight: 650;
		letter-spacing: -0.075em;
		line-height: 0.95;
	}

	.lede {
		max-width: 45rem;
		margin: 2rem 0 4rem;
		color: #aeb6bf;
		font-size: clamp(1.1rem, 2vw, 1.45rem);
		line-height: 1.55;
	}

	section {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 3rem;
		padding: 2.25rem;
		border: 1px solid #252a31;
		border-radius: 1.25rem;
		background: rgba(20, 23, 28, 0.78);
		box-shadow: 0 2rem 5rem rgba(0, 0, 0, 0.2);
	}

	h2 {
		max-width: 22rem;
		margin: 0.6rem 0 0;
		font-size: clamp(1.8rem, 4vw, 3rem);
		letter-spacing: -0.04em;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 0;
		border-bottom: 1px solid #2b3037;
		color: #aeb6bf;
	}

	li:last-child {
		border: 0;
	}

	strong {
		color: #f5f7f8;
	}

	.note {
		margin-top: 1.25rem;
		color: #77808b;
		font-size: 0.88rem;
	}

	@media (max-width: 700px) {
		main {
			width: min(100% - 2rem, 70rem);
		}

		section {
			grid-template-columns: 1fr;
			gap: 1.5rem;
			padding: 1.5rem;
		}
	}
</style>
