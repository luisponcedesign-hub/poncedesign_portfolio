// crop.swift — render one hero-showcase slide from a case study image.
//
//   swift scripts/crop.swift <src> <dst.jpg> <cx> <cy> <zoom> <outW> <outH>
//
// cx/cy are the focus point as fractions of the image (0–1, from the top
// left). The frame is the largest outW:outH box the image can fill ("cover"),
// shrunk by `zoom` and centred on the focus, clamped inside the image. It is
// resampled with Lanczos, lightly unsharp-masked, and written as a JPEG, so
// the page can show it at native size instead of the browser upscaling a
// zoomed <img>. Called by scripts/showcase.py; needs only the macOS SDK.

import CoreImage
import Foundation

let a = CommandLine.arguments
guard a.count == 8,
      let cx = Double(a[3]), let cy = Double(a[4]), let zoom = Double(a[5]),
      let outW = Double(a[6]), let outH = Double(a[7]),
      let src = CIImage(contentsOf: URL(fileURLWithPath: a[1])) else {
    FileHandle.standardError.write("usage: crop.swift src dst cx cy zoom outW outH\n".data(using: .utf8)!)
    exit(1)
}

let W = src.extent.width, H = src.extent.height
let frame = outW / outH

// cover box, then zoom
var cw = W, ch = W / frame
if ch > H { ch = H; cw = H * frame }
cw /= zoom; ch /= zoom

// centre on the focus, keep inside the image (Core Image's origin is bottom left)
var x = W * cx - cw / 2, yTop = H * cy - ch / 2
x = min(max(0, x), W - cw)
yTop = min(max(0, yTop), H - ch)
let rect = CGRect(x: x, y: H - yTop - ch, width: cw, height: ch)

// flatten any transparency onto white, crop, move to the origin
let white = CIImage(color: .white).cropped(to: src.extent)
// Take a few extra source pixels on every side (edge pixels repeated where the
// crop meets the image border). Lanczos and the unsharp mask read past the
// frame, and without real pixels there they blend in transparent black and
// leave a dark hairline around every image; the final crop trims the padding.
let pad = 6.0
var img = src.composited(over: white).clampedToExtent()
    .cropped(to: rect.insetBy(dx: -pad, dy: -pad))
    .transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))

let scale = outW / cw
let lanczos = CIFilter(name: "CILanczosScaleTransform")!
lanczos.setValue(img, forKey: kCIInputImageKey)
lanczos.setValue(scale, forKey: kCIInputScaleKey)
lanczos.setValue(1.0, forKey: kCIInputAspectRatioKey)
img = lanczos.outputImage!

// Unsharp mask scaled to the enlargement: its radius tracks how far edges
// were spread by the resample, so a 2x upscale gets a wider, firmer mask
// than a downscale. Capped so UI text never grows halos.
let usm = CIFilter(name: "CIUnsharpMask")!
usm.setValue(img, forKey: kCIInputImageKey)
usm.setValue(min(2.0, 0.6 + 0.6 * max(scale, 0.5)), forKey: kCIInputRadiusKey)
usm.setValue(scale > 1.5 ? 0.7 : (scale > 1 ? 0.55 : 0.35), forKey: kCIInputIntensityKey)
img = usm.outputImage!.cropped(to: CGRect(x: 0, y: 0, width: outW, height: outH))

let ctx = CIContext()
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let opts = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.86]
do {
    try ctx.writeJPEGRepresentation(of: img, to: URL(fileURLWithPath: a[2]), colorSpace: cs, options: opts)
} catch {
    FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
    exit(1)
}
