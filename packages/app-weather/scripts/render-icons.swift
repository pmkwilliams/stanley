// Renders the weather glyphs from Apple's SF Symbols (multicolor, as in iOS Weather) to PNGs.
// SF Symbols are licensed for software on Apple platforms only, so these are for the Mac demo.
// `-dark` is for dark backgrounds (white clouds), `-light` for light ones.
// Run on macOS: swift packages/app-weather/scripts/render-icons.swift packages/app-weather/src/icons
import AppKit

let symbols = [
  "sun.max.fill", "cloud.sun.fill", "cloud.fill", "cloud.fog.fill", "cloud.drizzle.fill", "cloud.rain.fill",
  "cloud.heavyrain.fill", "cloud.sleet.fill", "cloud.snow.fill", "cloud.bolt.rain.fill",
]
let out = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? ".")
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

/** Square canvas, so every glyph lays out the same; 96pt at 3x covers the largest use. */
let side = 288.0
let config = NSImage.SymbolConfiguration(pointSize: 180, weight: .regular).applying(.preferringMulticolor())

/** Multicolor clouds are always white; for light backgrounds they're recoloured iOS system gray. */
let gray: (r: Double, g: Double, b: Double) = (142, 142, 147)

for name in symbols {
  guard let symbol = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config) else {
    print("missing \(name)"); continue
  }
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(side), pixelsHigh: Int(side), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = symbol.size
  let k = min(side / s.width, side / s.height)
  symbol.draw(in: NSRect(x: (side - s.width * k) / 2, y: (side - s.height * k) / 2, width: s.width * k, height: s.height * k))
  NSGraphicsContext.restoreGraphicsState()
  let base = out.appendingPathComponent(name.replacingOccurrences(of: ".", with: "-")).path
  try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(base)-dark.png"))

  // Premultiplied RGBA: a pixel is white when each channel equals its alpha.
  let px = rep.bitmapData!
  for i in stride(from: 0, to: rep.bytesPerRow * rep.pixelsHigh, by: 4) {
    let a = Double(px[i + 3])
    guard a > 0, Double(min(px[i], px[i + 1], px[i + 2])) > a * 0.9 else { continue }
    px[i] = UInt8(gray.r * a / 255); px[i + 1] = UInt8(gray.g * a / 255); px[i + 2] = UInt8(gray.b * a / 255)
  }
  try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(base)-light.png"))
  print(name)
}
