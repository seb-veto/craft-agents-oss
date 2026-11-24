import AppKit
import Foundation

let directory = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
for (size, name) in [(16,"icon_16x16.png"),(32,"icon_16x16@2x.png"),(32,"icon_32x32.png"),(64,"icon_32x32@2x.png"),(128,"icon_128x128.png"),(256,"icon_128x128@2x.png"),(256,"icon_256x256.png"),(512,"icon_256x256@2x.png"),(512,"icon_512x512.png"),(1024,"icon_512x512@2x.png")] {
  let image = NSImage(size: NSSize(width: size, height: size))
  image.lockFocus()
  let n = CGFloat(size)
  NSColor(calibratedRed: 0.07, green: 0.12, blue: 0.13, alpha: 1).setFill()
  NSBezierPath(roundedRect: NSRect(x: n*0.04, y: n*0.04, width: n*0.92, height: n*0.92), xRadius: n*0.21, yRadius: n*0.21).fill()
  NSColor(calibratedRed: 0.55, green: 0.91, blue: 0.74, alpha: 1).setFill()
  let v = NSBezierPath()
  v.move(to: NSPoint(x:n*0.20,y:n*0.72)); v.line(to:NSPoint(x:n*0.38,y:n*0.72))
  v.line(to:NSPoint(x:n*0.50,y:n*0.35)); v.line(to:NSPoint(x:n*0.62,y:n*0.72))
  v.line(to:NSPoint(x:n*0.80,y:n*0.72)); v.line(to:NSPoint(x:n*0.58,y:n*0.24))
  v.line(to:NSPoint(x:n*0.42,y:n*0.24)); v.close(); v.fill()
  image.unlockFocus()
  let rep = NSBitmapImageRep(data:image.tiffRepresentation!)!
  try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:directory).appendingPathComponent(name))
}
