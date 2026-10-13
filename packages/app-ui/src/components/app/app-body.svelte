<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/** Scrolls under the bar, 16px in from the window's sides. */
	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div bind:this={ref} data-slot="app-body" class={cn("flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-1 pb-4", className)} {...restProps}>
	{@render children?.()}
</div>
