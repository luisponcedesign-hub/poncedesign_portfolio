// crop.swift — render one hero-showcase slide from a case study image.
//
//   swift scripts/crop.swift <src> <dst> <cx> <cy> <zoom> <outW> <outH> [photo|flat|vector] [colours] [soften] [fill_enclosed] [clean]
//
// cx/cy are the focus point as fractions of the image (0–1, from the top
// left). The frame is the largest outW:outH box the image can fill ("cover"),
// shrunk by `zoom` and centred on the focus, clamped inside the image.
// Called by scripts/showcase.py; needs only the macOS SDK.
//
// photo  Lanczos resample plus an unsharp mask sized to the enlargement,
//        written as JPEG. For real texture: photographs, paper, video frames.
// vector Same palette snapping as flat, then traced into an SVG: resolution-
//        independent, so it stays razor sharp at any size or pixel density.
// flat   For solid-colour artwork (charts, wireframes, icons, line drawings)
//        that an enlargement would only blur. The detail is resampled at twice
//        the output size, every pixel is snapped to the artwork's own palette
//        (k-means, `colours` entries), and the result is box-filtered back
//        down: edges come out as crisp as vector art, with clean anti-aliasing
//        from the 2x supersample. Written as PNG so compression adds no fringe.
//        `soften` (source pixels, default 0.45) is the blur taken before the
//        snap; raise it to melt hairline strokes the enlargement would wobble.

import CoreImage
import Foundation

let a = CommandLine.arguments
guard a.count >= 8,
      let cx = Double(a[3]), let cy = Double(a[4]), let zoom = Double(a[5]),
      let outW = Double(a[6]), let outH = Double(a[7]),
      let src = CIImage(contentsOf: URL(fileURLWithPath: a[1])) else {
    FileHandle.standardError.write("usage: crop.swift src dst cx cy zoom outW outH [photo|flat] [colours]\n".data(using: .utf8)!)
    exit(1)
}
let mode = a.count > 8 ? a[8] : "photo"
let colours = a.count > 9 ? max(2, Int(a[9]) ?? 4) : 4
let soften = a.count > 10 ? Double(a[10]) ?? 0.45 : 0.45
// "rrggbb>rrggbb[,rrggbb>rrggbb...]": regions of the first palette colour
// that are enclosed (not touching the frame edge) are repainted in the
// second; rules apply in order. Merges an inner stroke into the shape it
// outlines, or clears a motif out of the shape that holds it.
let fillEnclosed: [(String, String)] = {
    guard a.count > 11 else { return [] }
    return a[11].split(separator: ",").compactMap {
        let parts = $0.split(separator: ">").map(String.init)
        return parts.count == 2 ? (parts[0], parts[1]) : nil
    }
}()
// vector only: majority-filter radius before tracing (2 = 5x5)
let cleanR = a.count > 12 ? max(1, Int(a[12]) ?? 2) : 2

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

// Flatten any transparency onto white and take a few extra source pixels on
// every side (edge pixels repeated where the crop meets the image border).
// Lanczos and the unsharp mask read past the frame; without real pixels there
// they blend in transparent black and leave a dark hairline around every
// image. The final crop trims the padding.
let white = CIImage(color: .white).cropped(to: src.extent)
let pad = 6.0
let base = src.composited(over: white).clampedToExtent()
    .cropped(to: rect.insetBy(dx: -pad, dy: -pad))
    .transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))

func lanczos(_ img: CIImage, _ s: Double) -> CIImage {
    let f = CIFilter(name: "CILanczosScaleTransform")!
    f.setValue(img, forKey: kCIInputImageKey)
    f.setValue(s, forKey: kCIInputScaleKey)
    f.setValue(1.0, forKey: kCIInputAspectRatioKey)
    return f.outputImage!
}

let ctx = CIContext()
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let dst = URL(fileURLWithPath: a[2])

// ---------------------------------------------------------------- vector
// Trace a label map (one palette index per pixel) into an SVG: every colour's
// regions are outlined with marching squares, the pixel steps are simplified
// away (Ramer–Douglas–Peucker), and each outline is rebuilt as smooth
// quadratic curves that keep genuine corners sharp. Colours are painted from
// the largest area down, over a background rect, each with a hairline stroke
// of its own colour so abutting shapes leave no seam.
func writeSVG(labels: [UInt8], W: Int, H: Int, centres: [(Double, Double, Double)],
              outW: Double, outH: Double, to url: URL) {
    let sx = outW / Double(W), sy = outH / Double(H)
    func hex(_ c: (Double, Double, Double)) -> String {
        String(format: "#%02x%02x%02x", Int(c.0.rounded()), Int(c.1.rounded()), Int(c.2.rounded()))
    }
    var area = [Int](repeating: 0, count: centres.count)
    for l in labels { area[Int(l)] += 1 }
    let bg = area.indices.max { area[$0] < area[$1] }!
    var body = ""

    for k in area.indices.sorted(by: { area[$0] > area[$1] }) where k != bg && area[k] > 0 {
        // marching squares over the pixel-centre lattice; points are edge
        // midpoints, keyed on a doubled integer grid
        func inside(_ x: Int, _ y: Int) -> Bool {
            x >= 0 && y >= 0 && x < W && y < H && labels[y * W + x] == UInt8(k)
        }
        var adj: [Int: [Int]] = [:]
        func key(_ x2: Int, _ y2: Int) -> Int { (y2 + 4) * (2 * W + 8) + (x2 + 4) }
        func link(_ a: Int, _ b: Int) { adj[a, default: []].append(b); adj[b, default: []].append(a) }
        for cy in -1..<H { for cx in -1..<W {
            let tl = inside(cx, cy), tr = inside(cx + 1, cy), br = inside(cx + 1, cy + 1), bl = inside(cx, cy + 1)
            let c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)
            if c == 0 || c == 15 { continue }
            let T = key(2*cx + 1, 2*cy), R = key(2*cx + 2, 2*cy + 1), B = key(2*cx + 1, 2*cy + 2), L = key(2*cx, 2*cy + 1)
            switch c {
            case 1, 14: link(L, B)
            case 2, 13: link(B, R)
            case 3, 12: link(L, R)
            case 4, 11: link(T, R)
            case 6, 9:  link(T, B)
            case 7, 8:  link(L, T)
            case 5:  link(L, T); link(B, R)     // saddles: keep diagonal corners apart
            case 10: link(T, R); link(L, B)
            default: break
            }
        }}
        let stride2 = 2 * W + 8
        func pt(_ key: Int) -> (Double, Double) {
            // lattice point -> pixel coordinates (pixel centres sit at i + 0.5)
            (Double(key % stride2 - 4) / 2 + 0.5, Double(key / stride2 - 4) / 2 + 0.5)
        }

        var d = ""
        var used = Set<Int>()
        for start in adj.keys where !used.contains(start) {
            var loop: [Int] = [start]; used.insert(start)
            var prev = start, cur = adj[start]![0]
            while cur != start {
                loop.append(cur); used.insert(cur)
                let nb = adj[cur]!
                let next = nb[0] == prev && nb.count > 1 ? nb[1] : nb[0]
                if next == prev && nb.count == 1 { break }
                prev = cur; cur = next
                if loop.count > 2_000_000 { break }
            }
            var ps = loop.map(pt)
            // drop specks
            var a2 = 0.0
            for i in ps.indices { let p = ps[i], q = ps[(i + 1) % ps.count]; a2 += p.0 * q.1 - q.0 * p.1 }
            if abs(a2) / 2 < 24 { continue }
            ps = rdp(ps, eps: 0.9)
            if ps.count < 3 { continue }
            d += smoothPath(ps.map { ($0.0 * sx, $0.1 * sy) })
        }
        if d.isEmpty { continue }
        let h = hex(centres[k])
        body += "<path fill=\"\(h)\" stroke=\"\(h)\" stroke-width=\"0.6\" stroke-linejoin=\"round\" fill-rule=\"evenodd\" d=\"\(d)\"/>\n"
    }
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \(Int(outW)) \(Int(outH))\" width=\"\(Int(outW))\" height=\"\(Int(outH))\" shape-rendering=\"geometricPrecision\">\n"
        + "<rect width=\"100%\" height=\"100%\" fill=\"\(hex(centres[bg]))\"/>\n" + body + "</svg>\n"
    do { try svg.write(to: url, atomically: true, encoding: .utf8) } catch { fail(error) }
}

// Ramer–Douglas–Peucker on a closed loop: split at the two farthest-apart
// points so the loop's corners survive, then simplify each half.
func rdp(_ p: [(Double, Double)], eps: Double) -> [(Double, Double)] {
    func simplify(_ s: ArraySlice<(Double, Double)>) -> [(Double, Double)] {
        guard s.count > 2, let a = s.first, let b = s.last else { return Array(s) }
        let dx = b.0 - a.0, dy = b.1 - a.1, len = max(1e-9, (dx*dx + dy*dy).squareRoot())
        var worst = s.startIndex, wd = 0.0
        for i in s.indices.dropFirst().dropLast() {
            let d = abs(dy * s[i].0 - dx * s[i].1 + b.0 * a.1 - b.1 * a.0) / len
            if d > wd { wd = d; worst = i }
        }
        if wd <= eps { return [a, b] }
        let l = simplify(s[s.startIndex...worst]), r = simplify(s[worst...])
        return Array(l.dropLast()) + r
    }
    var far = 0, fd = 0.0
    for i in p.indices { let d = pow(p[i].0 - p[0].0, 2) + pow(p[i].1 - p[0].1, 2); if d > fd { fd = d; far = i } }
    let first = simplify(p[0...far]), second = simplify((p[far...] + [p[0]])[...])
    return Array(first.dropLast()) + Array(second.dropLast())
}

// Closed polyline -> path. Gentle turns become quadratic curves through the
// edge midpoints; turns sharper than ~50 degrees stay as true corners.
func smoothPath(_ p: [(Double, Double)]) -> String {
    let n = p.count
    func mid(_ i: Int) -> (Double, Double) { let a = p[i % n], b = p[(i + 1) % n]; return ((a.0 + b.0) / 2, (a.1 + b.1) / 2) }
    func f(_ v: Double) -> String { String(format: "%.1f", v) }
    func corner(_ i: Int) -> Bool {
        let a = p[(i - 1 + n) % n], b = p[i % n], c = p[(i + 1) % n]
        let u = (b.0 - a.0, b.1 - a.1), v = (c.0 - b.0, c.1 - b.1)
        let lu = (u.0*u.0 + u.1*u.1).squareRoot(), lv = (v.0*v.0 + v.1*v.1).squareRoot()
        if lu == 0 || lv == 0 { return false }
        return (u.0*v.0 + u.1*v.1) / (lu * lv) < 0.64      // cos 50deg
    }
    let m0 = mid(0)
    var s = "M\(f(m0.0)) \(f(m0.1))"
    for i in 1...n {
        let v = p[i % n], m = mid(i)
        if corner(i) { s += "L\(f(v.0)) \(f(v.1))L\(f(m.0)) \(f(m.1))" }
        else { s += "Q\(f(v.0)) \(f(v.1)) \(f(m.0)) \(f(m.1))" }
    }
    return s + "Z"
}

func fail(_ e: Any) -> Never {
    FileHandle.standardError.write("\(e)\n".data(using: .utf8)!)
    exit(1)
}

if mode == "flat" || mode == "vector" {
    // 1. resample at 2x the output size. A Gaussian of about half a source
    //    pixel first: the snap below is a threshold, and without it the
    //    threshold traces the source's pixel grid (stair-stepped curves)
    //    instead of the shape it drew.
    let SW = Int(outW) * 2, SH = Int(outH) * 2
    let up = Double(SW) / cw
    var big = lanczos(base, up)
    if up > 1.5 {
        big = big.clampedToExtent().applyingGaussianBlur(sigma: soften * up)
    }
    big = big.cropped(to: CGRect(x: 0, y: 0, width: SW, height: SH))
    var px = [UInt8](repeating: 0, count: SW * SH * 4)
    ctx.render(big, toBitmap: &px, rowBytes: SW * 4,
               bounds: CGRect(x: 0, y: 0, width: SW, height: SH), format: .RGBA8, colorSpace: cs)

    typealias RGB = (Double, Double, Double)
    func rgb(_ p: Int) -> RGB { (Double(px[p*4]), Double(px[p*4+1]), Double(px[p*4+2])) }
    func d2(_ p: RGB, _ q: RGB) -> Double {
        let r = p.0 - q.0, g = p.1 - q.1, b = p.2 - q.2
        return r*r + g*g + b*b
    }
    func lum(_ p: Int) -> Double { 0.2126 * Double(px[p*4]) + 0.7152 * Double(px[p*4+1]) + 0.0722 * Double(px[p*4+2]) }

    // 2. the artwork's palette: weighted k-means on a sample. Pixels inside
    //    flat areas count fully and pixels on edges barely, so the in-between
    //    tones of anti-aliasing never become palette colours of their own.
    //    Seeded farthest-first from the background tone, so small accents (a
    //    thin rule, a lone dot) still get a centre.
    var sample: [(RGB, Double)] = []
    let step = max(1, Int((Double(SW * SH) / 80000).squareRoot()))
    for y in Swift.stride(from: 1, to: SH - 1, by: step) {
        for x in Swift.stride(from: 1, to: SW - 1, by: step) {
            let p = y * SW + x
            let g = abs(lum(p + 1) - lum(p - 1)) + abs(lum(p + SW) - lum(p - SW))
            sample.append((rgb(p), g < 4 ? 1.0 : 0.04))
        }
    }
    var counts: [Int: Double] = [:]
    for (s, w) in sample { counts[(Int(s.0) >> 4) << 8 | (Int(s.1) >> 4) << 4 | (Int(s.2) >> 4), default: 0] += w }
    let bgKey = counts.max { $0.value < $1.value }!.key
    var centres = [sample.first { (Int($0.0.0) >> 4) << 8 | (Int($0.0.1) >> 4) << 4 | (Int($0.0.2) >> 4) == bgKey }!.0]
    let solid = sample.filter { $0.1 == 1.0 }.map { $0.0 }
    while centres.count < colours {
        let pool = solid.isEmpty ? sample.map { $0.0 } : solid
        centres.append(pool.max { a, b in centres.map { d2(a, $0) }.min()! < centres.map { d2(b, $0) }.min()! }!)
    }
    for _ in 0..<15 {
        var sum = [RGB](repeating: (0, 0, 0), count: colours)
        var n = [Double](repeating: 0, count: colours)
        for (s, w) in sample {
            var best = 0, bd = Double.infinity
            for (k, c) in centres.enumerated() { let d = d2(s, c); if d < bd { bd = d; best = k } }
            sum[best].0 += s.0 * w; sum[best].1 += s.1 * w; sum[best].2 += s.2 * w; n[best] += w
        }
        for k in 0..<colours where n[k] > 0 {
            centres[k] = (sum[k].0 / n[k], sum[k].1 / n[k], sum[k].2 / n[k])
        }
    }

    // Pull each non-background colour out to the strong end of its cluster.
    // A solid area is uniform, so this changes nothing there; a thin stroke is
    // mostly anti-aliased edge, and its average is a washed-out grey where the
    // artwork drew black.
    // Only for colours with no real solid area, though: a colour that fills
    // regions is exactly the mean of its solid pixels, and nudging it outward
    // would leave its true tone sitting between it and the background, where
    // the edge test below would snap whole regions to the background.
    let bg = centres[0]
    for k in 1..<colours {
        var members: [(RGB, Double)] = []
        var solidSum: RGB = (0, 0, 0), solidN = 0.0
        for (s, w) in sample {
            var best = 0, bd = Double.infinity
            for (j, c) in centres.enumerated() { let d = d2(s, c); if d < bd { bd = d; best = j } }
            if best == k {
                members.append((s, d2(s, bg)))
                if w == 1.0 { solidSum.0 += s.0; solidSum.1 += s.1; solidSum.2 += s.2; solidN += 1 }
            }
        }
        guard members.count > 8 else { continue }
        if solidN >= max(20, 0.05 * Double(members.count)) {
            centres[k] = (solidSum.0 / solidN, solidSum.1 / solidN, solidSum.2 / solidN)
            continue
        }
        members.sort { $0.1 < $1.1 }
        let strong = members[Int(Double(members.count - 1) * 0.85)...]
        let n = Double(strong.count)
        centres[k] = (strong.reduce(0) { $0 + $1.0.0 } / n, strong.reduce(0) { $0 + $1.0.1 } / n, strong.reduce(0) { $0 + $1.0.2 } / n)
    }

    // 3. snap. Each pixel is explained as a blend of the pair of palette
    //    colours whose line it sits closest to, and goes to whichever end it is
    //    nearer — so an edge between blue and white resolves to blue or white,
    //    never to some third palette tone that happens to lie near the middle
    //    (the halo a plain nearest-colour snap draws around every shape).
    var pairs: [(Int, Int)] = []
    for i in 0..<colours { for j in (i + 1)..<max(i + 1, colours) { pairs.append((i, j)) } }
    let OW = Int(outW), OH = Int(outH)
    var out = [UInt8](repeating: 255, count: OW * OH * 4)
    var snapped = [RGB](repeating: (0, 0, 0), count: SW * SH)
    var labels = [UInt8](repeating: 0, count: SW * SH)
    for p in 0..<(SW * SH) {
        let s = rgb(p)
        // A pixel that already reads as one palette colour keeps it. This
        // matters when a palette colour is itself a near-blend of two others
        // (a light blue between white and blue): the pair test alone would
        // call it an edge and ring it in white.
        var near = 0, nd = Double.infinity
        for (k, c) in centres.enumerated() { let d = d2(s, c); if d < nd { nd = d; near = k } }
        var bestPair = (0, 0), bestD = Double.infinity, bestT = 0.0
        for (i, j) in pairs {
            let c1 = centres[i], c2 = centres[j]
            let v = (c2.0 - c1.0, c2.1 - c1.1, c2.2 - c1.2)
            let vv = v.0*v.0 + v.1*v.1 + v.2*v.2
            var t = vv > 0 ? ((s.0 - c1.0)*v.0 + (s.1 - c1.1)*v.1 + (s.2 - c1.2)*v.2) / vv : 0
            t = min(1, max(0, t))
            let q = (c1.0 + v.0*t, c1.1 + v.1*t, c1.2 + v.2*t)
            let d = d2(s, q)
            if d < bestD { bestD = d; bestPair = (i, j); bestT = t }
        }
        // only trust the pair when it explains the pixel far better than the
        // nearest single colour does (a genuine in-between edge pixel)
        let lab = bestD < 0.2 * nd ? (bestT < 0.5 ? bestPair.0 : bestPair.1) : near
        labels[p] = UInt8(lab)
        snapped[p] = centres[lab]
    }
    for (fromHex, toHex) in fillEnclosed {
        func parse(_ h: String) -> RGB {
            let v = Int(h, radix: 16) ?? 0
            return (Double((v >> 16) & 255), Double((v >> 8) & 255), Double(v & 255))
        }
        func nearest(_ c: RGB) -> UInt8 {
            UInt8(centres.indices.min { d2(centres[$0], c) < d2(centres[$1], c) }!)
        }
        let from = nearest(parse(fromHex)), to = nearest(parse(toHex))
        // flood the `from` regions that touch the frame edge; the rest are enclosed
        var open = [Bool](repeating: false, count: SW * SH)
        var stack: [Int] = []
        for x in 0..<SW { stack.append(x); stack.append((SH - 1) * SW + x) }
        for y in 0..<SH { stack.append(y * SW); stack.append(y * SW + SW - 1) }
        while let p = stack.popLast() {
            if open[p] || labels[p] != from { continue }
            open[p] = true
            let x = p % SW, y = p / SW
            if x > 0 { stack.append(p - 1) }; if x < SW - 1 { stack.append(p + 1) }
            if y > 0 { stack.append(p - SW) }; if y < SH - 1 { stack.append(p + SW) }
        }
        for p in 0..<(SW * SH) where labels[p] == from && !open[p] {
            labels[p] = to; snapped[p] = centres[Int(to)]
        }
    }
    if mode == "vector" {
        // Majority filter before tracing: each pixel takes the most common
        // colour of its neighbourhood (5x5 by default, `clean` widens it), twice. Hairline spikes, specks and
        // one-pixel slivers along shared edges disappear; shapes wider than a
        // couple of pixels keep their outline. Faithful tracing of noise is
        // what makes a traced edge look hairy.
        for _ in 0..<2 {
            var cleaned = labels
            var hist = [Int](repeating: 0, count: colours)
            for y in cleanR..<(SH - cleanR) { for x in cleanR..<(SW - cleanR) {
                for k in 0..<colours { hist[k] = 0 }
                for dy in -cleanR...cleanR { let row = (y + dy) * SW
                    for dx in -cleanR...cleanR { hist[Int(labels[row + x + dx])] += 1 } }
                var best = Int(labels[y * SW + x]), bc = hist[best]
                for k in 0..<colours where hist[k] > bc { bc = hist[k]; best = k }
                cleaned[y * SW + x] = UInt8(best)
            }}
            labels = cleaned
        }
        writeSVG(labels: labels, W: SW, H: SH, centres: centres, outW: outW, outH: outH, to: dst)
        exit(0)
    }
    for y in 0..<OH { for xx in 0..<OW {
        var r = 0.0, g = 0.0, b = 0.0
        for dy in 0..<2 { for dx in 0..<2 {
            let c = snapped[(y*2 + dy) * SW + xx*2 + dx]; r += c.0; g += c.1; b += c.2
        }}
        let o = (y * OW + xx) * 4
        out[o] = UInt8((r / 4).rounded()); out[o+1] = UInt8((g / 4).rounded()); out[o+2] = UInt8((b / 4).rounded())
    }}
    let flat = CIImage(bitmapData: Data(out), bytesPerRow: OW * 4,
                       size: CGSize(width: OW, height: OH), format: .RGBA8, colorSpace: cs)
    do { try ctx.writePNGRepresentation(of: flat, to: dst, format: .RGBA8, colorSpace: cs) } catch { fail(error) }
} else {
    // photo: Lanczos, then an unsharp mask scaled to the enlargement. Its radius
    // tracks how far edges were spread by the resample, so a 2x upscale gets a
    // wider, firmer mask than a downscale; capped so fine detail never halos.
    let scale = outW / cw
    let usm = CIFilter(name: "CIUnsharpMask")!
    usm.setValue(lanczos(base, scale), forKey: kCIInputImageKey)
    usm.setValue(min(2.4, 0.6 + 0.6 * max(scale, 0.5)), forKey: kCIInputRadiusKey)
    usm.setValue(scale > 2 ? 0.85 : (scale > 1.5 ? 0.7 : (scale > 1 ? 0.55 : 0.35)), forKey: kCIInputIntensityKey)
    let img = usm.outputImage!.cropped(to: CGRect(x: 0, y: 0, width: outW, height: outH))
    let opts = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.9]
    do { try ctx.writeJPEGRepresentation(of: img, to: dst, colorSpace: cs, options: opts) } catch { fail(error) }
}
