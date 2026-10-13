<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	/** Every app has a fixed size, so the window never jumps as its content changes. Clamped to what the shell allows. */
	export const appVariants = tv({
		base: "flex h-150 max-h-(--window-max-height,100vh) max-w-(--window-max-width,100vw) flex-col text-sm",
		variants: {
			size: {
				compact: "w-110",
				default: "w-150",
				wide: "w-220",
				/** Fills the space the shell allows (Web). */
				fill: "h-(--window-max-height,100vh) w-(--window-max-width,100vw)",
			},
		},
		defaultVariants: { size: "default" },
	});

	export type AppSize = VariantProps<typeof appVariants>["size"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "$ui/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		size,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & { size?: AppSize } = $props();
</script>

<section bind:this={ref} data-slot="app" class={cn(appVariants({ size }), className)} {...restProps}>
	{@render children?.()}
</section>
