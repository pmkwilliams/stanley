<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/** A list pane and a detail pane (`AppBody`s), each scrolling on its own. */
	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="app-split"
	class={cn("grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] [&>*+*]:border-l", className)}
	{...restProps}
>
	{@render children?.()}
</div>
