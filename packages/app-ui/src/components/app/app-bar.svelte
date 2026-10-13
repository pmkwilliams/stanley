<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	/** Sits on the glass, not a material of its own: the title on the left, at most three controls on the right. */
	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<header bind:this={ref} data-slot="app-bar" class={cn("flex min-h-16 flex-none items-center gap-2 px-4 pt-3 pb-2", className)} {...restProps}>
	{@render children?.()}
</header>
