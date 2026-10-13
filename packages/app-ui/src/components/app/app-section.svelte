<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	/** A titled block in a body: usually one group, with a sentence of explanation under it if needed. */
	let {
		ref = $bindable(null),
		class: className,
		title,
		titleId,
		footer,
		children,
		...restProps
	}: WithElementRef<Omit<HTMLAttributes<HTMLElement>, "title">> & {
		title?: string | Snippet;
		/** For aria-labelledby on whatever the section holds. */
		titleId?: string;
		footer?: string | Snippet;
	} = $props();
</script>

<section bind:this={ref} data-slot="app-section" class={cn("mt-6 first:mt-0", className)} {...restProps}>
	{#if title}
		<h2 id={titleId} class="mb-1.5 px-3 text-xs font-semibold text-muted-foreground">
			{#if typeof title === "string"}{title}{:else}{@render title()}{/if}
		</h2>
	{/if}
	{@render children?.()}
	{#if footer}
		<p class="mt-1.5 px-3 text-xs text-muted-foreground">
			{#if typeof footer === "string"}{footer}{:else}{@render footer()}{/if}
		</p>
	{/if}
</section>
