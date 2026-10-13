<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/**
	 * An inset grouped list: rows (`Item` size="row") on a muted tint. Groups never sit in the window's
	 * corners (the bar is above them, free space below), so rounded-xl is in proportion to the window's
	 * rounded-3xl rather than derived from it. Rows do sit in the group's corners, 4px in: rounded-lg.
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
		"list-none rounded-xl bg-muted p-1",
		"*:relative [&>*+*]:before:absolute [&>*+*]:before:inset-x-3 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-border [&>*+*]:before:transition-opacity",
		"[&>:hover]:before:opacity-0 [&>:hover+*]:before:opacity-0",
		"[&>:has([data-selected=true])]:before:opacity-0 [&>:has([data-selected=true])+*]:before:opacity-0",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</ul>
