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
	 * The window the shell draws around an app: glass, lightly frosted. A window made of panes
	 * (`AppSidebar` + `AppMain`) is tinted by its panes instead. The blur stays here rather than on
	 * each pane, since a pane can't blur through the window as it fades in. It's on a layer behind the
	 * content rather than the window itself: Chromium won't run a backdrop blur inside an element that
	 * has one, so this way the app's own frosted surfaces (a sticky title) still blur what's under them.
	 * `data-fullscreen`: the window fills the screen edge to edge, and so does an app sized to `fill` it.
	 * It covers the status bar, which drags the OS window; `no-drag` lets clicks there reach the app.
	 */
	export const appWindow =
		"relative isolate flex max-h-(--window-max-height) max-w-(--window-max-width) flex-col overflow-hidden rounded-3xl border bg-card/70 shadow-window before:absolute before:inset-0 before:-z-10 before:backdrop-blur-sm before:backdrop-saturate-150 has-data-[slot=app-sidebar]:bg-transparent data-fullscreen:fixed data-fullscreen:inset-0 data-fullscreen:rounded-none data-fullscreen:border-0 data-fullscreen:shadow-none data-fullscreen:[--window-max-height:100vh] data-fullscreen:[--window-max-width:100vw] data-fullscreen:[-webkit-app-region:no-drag]";

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
