// Beat grid + loudness for PortraitProject/mississippi.html.
//   swiftc -O scripts/mississippi_track.swift -o /tmp/mtrack
//   /tmp/mtrack assets/video/mississippi.mp4 > assets/video/mississippi-track.json
// Onset envelope from three bands, tempo by autocorrelation, beats by
// dynamic programming (Ellis 2007). rms/bass are sampled at "rate" Hz, normalised 0..1.
import AVFoundation
import Foundation
let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let at = asset.tracks(withMediaType: .audio)[0]
let reader = try! AVAssetReader(asset: asset)
let SR = 22050.0
let out = AVAssetReaderTrackOutput(track: at, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVNumberOfChannelsKey: 1, AVSampleRateKey: SR])
reader.add(out); reader.startReading()
var x = [Float]()
while let b = out.copyNextSampleBuffer() {
  let bb = CMSampleBufferGetDataBuffer(b)!
  let n = CMBlockBufferGetDataLength(bb)
  var tmp = [Float](repeating: 0, count: n / 4)
  CMBlockBufferCopyDataBytes(bb, atOffset: 0, dataLength: n, destination: &tmp)
  x += tmp
}
let N = x.count; let dur = Double(N) / SR
FileHandle.standardError.write("samples \(N) dur \(dur)\n".data(using: .utf8)!)
// band split with one-pole filters
func lp(_ s: [Float], _ fc: Double) -> [Float] { let k = Float(1 - exp(-2 * Double.pi * fc / SR)); var y = [Float](repeating: 0, count: s.count); var p: Float = 0; for i in 0..<s.count { p += k * (s[i] - p); y[i] = p }; return y }
let low = lp(lp(x, 180), 180)
let mid0 = lp(x, 2500)
var mid = [Float](repeating: 0, count: N), high = [Float](repeating: 0, count: N)
for i in 0..<N { mid[i] = mid0[i] - low[i]; high[i] = x[i] - mid0[i] }
let hop = 256, win = 1024
let F = (N - win) / hop
let fps = SR / Double(hop)
func energy(_ s: [Float]) -> [Double] { var e = [Double](repeating: 0, count: F); for f in 0..<F { var acc: Double = 0; let o = f * hop; for j in 0..<win { let v = Double(s[o + j]); acc += v * v }; e[f] = acc / Double(win) }; return e }
let eL = energy(low), eM = energy(mid), eH = energy(high), eA = energy(x)
var onset = [Double](repeating: 0, count: F)
for f in 1..<F {
  var o = 0.0
  for (e, w) in [(eL, 1.4), (eM, 1.0), (eH, 0.7)] { o += w * max(0, log(e[f] + 1e-9) - log(e[f-1] + 1e-9)) }
  onset[f] = o
}
// smooth & normalize
let mean = onset.reduce(0, +) / Double(F)
var sd = 0.0; for v in onset { sd += (v - mean) * (v - mean) }; sd = sqrt(sd / Double(F))
var on = onset.map { ($0 - mean) / sd }
// tempo via autocorrelation
var best: [(Double, Double)] = []
let minLag = Int(fps * 60 / 200), maxLag = Int(fps * 60 / 60)
for lag in minLag...maxLag {
  var s = 0.0; for f in 0..<(F - lag) { s += on[f] * on[f + lag] }
  s /= Double(F - lag)
  let bpm = 60 * fps / Double(lag)
  let w = exp(-0.5 * pow(log2(bpm / 120) / 1.0, 2))
  best.append((bpm, s * w))
}
best.sort { $0.1 > $1.1 }
FileHandle.standardError.write("tempo candidates: \(best.prefix(6).map { String(format: "%.1f:%.3f", $0.0, $0.1) })\n".data(using: .utf8)!)
let bpm = Double(a.count > 2 ? a[2] : "0")! > 0 ? Double(a[2])! : best[0].0
let period = fps * 60 / bpm
// Ellis DP beat tracker
let tight = 100.0
var score = [Double](repeating: 0, count: F), back = [Int](repeating: -1, count: F)
for f in 0..<F {
  var bs = -1e9, bi = -1
  let lo = f - Int(round(2 * period)), hi = f - Int(round(period / 2))
  if hi >= 0 { for p in max(0, lo)...hi { let d = log(Double(f - p) / period); let c = score[p] - tight * d * d; if c > bs { bs = c; bi = p } } }
  if bi >= 0 { score[f] = on[f] + bs; back[f] = bi } else { score[f] = on[f] }
}
var end = F - 1; var mx = -1e9
for f in max(0, F - Int(period))..<F { if score[f] > mx { mx = score[f]; end = f } }
var beats = [Int](); var c = end; while c >= 0 { beats.append(c); c = back[c] }
beats.reverse()
// envelopes at 20 Hz
let step = Int(fps / 20)
func env(_ e: [Double]) -> [Double] { var r = [Double](); var i = 0; while i < F { let j = min(F, i + step); r.append(sqrt(e[i..<j].reduce(0, +) / Double(j - i))); i = j }; let m = r.sorted()[Int(Double(r.count) * 0.97)]; return r.map { min(1, $0 / m) } }
let rms = env(eA), bass = env(eL)
// beat strength: onset value at beat normalized
let bstr = beats.map { max(0, on[$0]) }
let bm = bstr.sorted()[Int(Double(bstr.count) * 0.95)]
func r3(_ v: Double) -> String { String(format: "%.3f", v) }
func r2(_ v: Double) -> String { String(format: "%.2f", v) }
var js = "{\"bpm\":\(r2(bpm)),\"duration\":\(r3(dur)),\"rate\":\(r3(fps / Double(step))),"
js += "\"beats\":[" + beats.map { r3(Double($0 * hop + win / 2) / SR) }.joined(separator: ",") + "],"
js += "\"accent\":[" + bstr.map { r2(min(1, $0 / bm)) }.joined(separator: ",") + "],"
js += "\"rms\":[" + rms.map { r2($0) }.joined(separator: ",") + "],"
js += "\"bass\":[" + bass.map { r2($0) }.joined(separator: ",") + "]}"
print(js)
// summary per 10s
var line = "rms/10s:"; var k = 0; while k < rms.count { let j = min(rms.count, k + 200); line += " " + r2(rms[k..<j].reduce(0, +) / Double(j - k)); k = j }
FileHandle.standardError.write((line + "\nbeats \(beats.count) first \(beats.prefix(8).map { r2(Double($0 * hop) / SR) })\n").data(using: .utf8)!)
// intervals stats
let iv = zip(beats.dropFirst(), beats).map { Double($0 - $1) / fps }
FileHandle.standardError.write("interval min \(r3(iv.min()!)) max \(r3(iv.max()!))\n".data(using: .utf8)!)
