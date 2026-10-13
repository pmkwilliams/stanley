<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/**
	 * The left pane of a window made of panes, with an `AppMain` beside it. Lighter than the main pane
	 * (`bg-card/50` over the window's light blur). The view switcher on top, then a list that scrolls.
	 */
	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<aside bind:this={ref} data-slot="app-sidebar" class={cn("flex min-h-0 w-80 flex-none flex-col border-r bg-card/50", className)} {...restProps}>
	{@render children?.()}
</aside>
