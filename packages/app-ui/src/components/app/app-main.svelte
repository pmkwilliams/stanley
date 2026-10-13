<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/** The content pane beside an `AppSidebar`: `bg-card/70` over the window's light blur. */
	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div bind:this={ref} data-slot="app-main" class={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-card/70", className)} {...restProps}>
	{@render children?.()}
</div>
