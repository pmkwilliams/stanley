import type { Track } from './core'

/**
 * A track on SoundCloud, played through its embedded player, which needs no API key. `artwork` is
 * the cover's file on SoundCloud's image host; without one, the UI draws a generated cover.
 */
const soundcloud = (id: number, path: string, artwork: string, title: string, artist: string, album: string, durationSec: number): Track => ({
  id: `s${id}`,
  title,
  artist,
  durationSec,
  audio: `https://api.soundcloud.com/tracks/${id}`,
  image: artwork && `https://i1.sndcdn.com/${artwork}`,
  album,
  url: `https://soundcloud.com/${path}`,
})

/**
 * The playlist: the first ten tracks of the SoundCloud set "Chill Beats"
 * (soundcloud.com/chill-bill-16/sets/chill-beats-lofi-jazz-hop-lo) that play here, in its order, with two
 * ambient tracks third and fourth. Left out: tracks that only stream a 30-second preview, and
 * DRM-encrypted ones, which Electron can't decrypt.
 */
export const playlist: Track[] = [
  soundcloud(1867836108, 'hipdozer/konteks-hallucinogens-hd', 'artworks-Qw5oZ00BRARev5Zp-TOkljg-t500x500.jpg', 'Hallucinogens', 'Konteks', 'Hip Dozer, Vol.9', 114),
  soundcloud(1852566057, 'hipdozer/hulkhodn-tura', 'artworks-DE3abHcRQp9RIFQS-sSmsvw-t500x500.jpg', 'Tura', 'Hulk Hodn', 'Hip Dozer, Vol.9', 120),
  soundcloud(479099646, 'freeambientmusic/interstellar-ambient-space-music-paul-landry-cosmos', 'artworks-000381935169-uilk0m-t500x500.jpg', 'Interstellar', 'Paul Landry', 'Cosmos', 285),
  soundcloud(748793281, 'desertdwellers/14-breathing-the-mysteries', 'artworks-000673534555-5txlhj-t500x500.jpg', "Breathing The Mysteries (Bluetech's Berlin School Mix)", 'Desert Dwellers', 'Breathing The Mysteries', 399),
  soundcloud(1777809723, 'hipdozer/1-organic-fruits', 'artworks-krxtXHj0sRlegN9U-3icLTg-t500x500.jpg', 'Organic Fruits', 'Mujo', 'Ipanema', 73),
  soundcloud(1849796058, 'hipdozer/kalaido-umbrella-season', 'artworks-Ra5yPdsAkIKejSeO-TlZfoQ-t500x500.jpg', 'Umbrella Season', 'Kalaido', 'Hip Dozer, Vol.9', 164),
  soundcloud(1831936410, 'hipdozer/shuko-in-my-timberlands', 'artworks-9KpSCVsLKmbF2SRa-9mQrug-t500x500.jpg', 'In my Timberlands', 'Shuko', 'Hip Dozer, Vol.9', 130),
  soundcloud(1924652648, 'goldentickettapes/soulmade-doin-it', 'artworks-IrszwkaBzO7qaual-DYGWfg-t500x500.jpg', "Doin' It", 'Soulmade', "Doin' It", 162),
  soundcloud(530516577, 'backseatlovers/maple-syrup', 'artworks-000440531616-uv7fsy-t500x500.jpg', 'Maple Syrup', 'The Backseat Lovers', 'Maple Syrup', 244),
  soundcloud(1911366485, 'kickmeup/iamkosmos-blink-twice', 'artworks-puKGG8hTGWhVwh8S-LuCXXw-t500x500.jpg', 'Blink Twice', 'Iamkosmos', 'Blink Twice', 112),
  soundcloud(1318623727, 'ninetofiverecords/homage-phil-tyler-vin-blanc', 'artworks-F2zl2h1aoTSyzf77-BtzqyQ-t500x500.jpg', 'Vin Blanc', 'Homage & Phil Tyler', 'Vin Blanc', 107),
  soundcloud(1822545792, 'slofive/ginseng-brew', 'artworks-hXXclFgmaz1cv5Yj-nK5tQQ-t500x500.png', 'Ginseng Brew (w/ yungmerrin)', 'Slo Five, yungmerrin', 'Bubble Beats', 113),
]
