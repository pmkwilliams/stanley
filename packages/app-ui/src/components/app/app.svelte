<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";

	/** Every app has a fixed size, so the window never jumps as its content changes. Clamped to what the shell allows. */
	export const appVariants = tv({
		base: "flex h-150 max-h-(--window-max-height,100vh) max-w-(--window-max-width,100vw) flex-col text-sm has-[>[data-slot=app-sidebar]]:flex-row",
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

	/**
	 * The window the shell draws around an app: glass, heavily frosted. A window made of panes
	 * (`AppSidebar` + `AppMain`) is frosted lightly instead and tinted by its panes. The blur stays
	 * here rather than on each pane, since a pane can't blur through the window as it fades in.
	 */
	export const appWindow =
		"flex max-h-(--window-max-height) max-w-(--window-max-width) flex-col overflow-hidden rounded-3xl border bg-card/80 shadow-window backdrop-blur-2xl backdrop-saturate-150 has-data-[slot=app-sidebar]:bg-transparent has-data-[slot=app-sidebar]:backdrop-blur-sm";

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
