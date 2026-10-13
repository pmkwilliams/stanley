/**
 * Hard-coded avatars for the seed mail, by address: a photo for a person, a logo for a company, and
 * a letter on a colour for anything else. UI only, so the core stays free of assets.
 */
export interface Avatar {
  src?: string
  /** Shown when there is no image, or while it loads. */
  letter: string
  /** The letter's background. Fixed colours are fine here: like artwork, they're content. */
  class?: string
}

const photo = (file: string) => new URL(`./avatars/${file}`, import.meta.url).href

const avatars: Record<string, Omit<Avatar, 'letter'>> = {
  'sam.lee@fastmail.com': { src: photo('sam.jpg') },
  'priya@northwind.io': { src: photo('priya.jpg') },
  'no-reply@delta.com': { src: photo('delta.svg') },
  'linda.williams@gmail.com': { src: photo('mom.jpg') },
  'noreply@github.com': { src: photo('github.svg') },
  'alex.romero@acme.co': { src: photo('alex.jpg') },
  'hello@coastalrunning.org': { class: 'bg-teal-600 text-white' },
  'jordan.kim@northwind.io': { src: photo('jordan.jpg') },
}

/** The avatar for a sender; anyone unknown gets the first letter of their name. */
export function avatarFor(name: string, address: string | undefined): Avatar {
  return { letter: name.trim()[0]?.toUpperCase() ?? '?', ...(address ? avatars[address] : undefined) }
}
