<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/** The window's only large text: the app's name or the current place. */
	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLHeadingElement>> = $props();
</script>

<h1 bind:this={ref} data-slot="app-title" class={cn("mr-auto truncate text-xl font-bold tracking-tight", className)} {...restProps}>
	{@render children?.()}
</h1>
