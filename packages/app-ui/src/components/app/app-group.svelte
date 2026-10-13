<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/**
	 * An inset grouped list: rows (`Item` size="row") on a muted tint. rounded-lg is the window's rounded-3xl
	 * less the body's 16px inset; rows sit 4px further in, so they're rounded-sm.
	 * Hairlines run between rows, inset to the text, and hide next to a hovered or selected row.
	 */
	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLUListElement>> = $props();
</script>

<ul
	bind:this={ref}
	data-slot="app-group"
	class={cn(
		"list-none rounded-lg bg-muted p-1",
		"*:relative [&>*+*]:before:absolute [&>*+*]:before:inset-x-3 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-border [&>*+*]:before:transition-opacity",
		"[&>:hover]:before:opacity-0 [&>:hover+*]:before:opacity-0",
		"[&>:has([data-selected=true])]:before:opacity-0 [&>:has([data-selected=true])+*]:before:opacity-0",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</ul>
