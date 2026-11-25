// Lager QR-kode med macOS' innebygde CoreImage – ingen installasjon nødvendig.
//
//   osascript -l JavaScript verktoy/lag-qr.js "https://dittdomene.no" julekort/qr.png
//
// Kjør på nytt med ny adresse når domenet er på plass.

ObjC.import("AppKit");
ObjC.import("Quartz");

function run(argv) {
  const url = argv[0];
  const outPath = argv[1];
  const scale = parseInt(argv[2] || "24", 10);
  if (!url || !outPath) return "bruk: lag-qr.js <url> <ut.png> [skala]";

  const data = $.NSString.alloc.initWithUTF8String(url).dataUsingEncoding($.NSUTF8StringEncoding);
  const qr = $.CIFilter.filterWithName("CIQRCodeGenerator");
  qr.setValueForKey(data, "inputMessage");
  qr.setValueForKey($.NSString.alloc.initWithUTF8String("M"), "inputCorrectionLevel");

  // Blekk på kremhvitt, som resten av designet
  const fc = $.CIFilter.filterWithName("CIFalseColor");
  fc.setValueForKey(qr.outputImage, "inputImage");
  fc.setValueForKey($.CIColor.colorWithRedGreenBlue(0.165, 0.149, 0.122), "inputColor0"); // #2A261F
  fc.setValueForKey($.CIColor.colorWithRedGreenBlue(0.984, 0.965, 0.925), "inputColor1"); // #FBF6EC

  const img = fc.outputImage.imageBySamplingNearest.imageByApplyingTransform(
    $.CGAffineTransformMakeScale(scale, scale));

  const ctx = $.CIContext.context;
  const cs = $.CGColorSpaceCreateWithName($.kCGColorSpaceSRGB);
  const err = Ref();
  const ok = ctx.writePNGRepresentationOfImageToURLFormatColorSpaceOptionsError(
    img, $.NSURL.fileURLWithPath(outPath), $.kCIFormatRGBA8, cs, $.NSDictionary.dictionary, err);

  return ok ? "ok: " + outPath + " (" + img.extent.size.width + "px)" : "FEIL: kunne ikke skrive png";
}
