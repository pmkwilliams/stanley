<script lang="ts">
  import { icons, type IconDef, type IconName } from './icons'

  /** Decorative by default: give the button around it the accessible name. */
  let { name, size = 20, weight = 1.75 }: { name: IconName; size?: number; weight?: number } = $props()

  const icon: IconDef = $derived(icons[name])
</script>

<svg
  class="block shrink-0"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  aria-hidden="true"
  fill={icon.fill ? 'currentColor' : 'none'}
  stroke={icon.fill ? 'none' : 'currentColor'}
  stroke-width={weight}
  stroke-linecap="round"
  stroke-linejoin="round">{@html icon.svg}</svg
>

