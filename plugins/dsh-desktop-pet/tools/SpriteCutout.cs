// Turn a generated picture into a pet sprite: key the flat magenta backdrop out to transparency,
// trim the empty margin, and scale the result down to a sprite-sized PNG.
//
// Image models will not reliably produce an alpha channel — asked for "transparent" they tend to
// *draw* a checkerboard — so the reliable route is to ask for one flat magenta field and key it out
// here. (The pet window itself is per-pixel-alpha these days — PetHost.cs uses no colour key — so
// magenta is only the backdrop convention for generation, not anything the window relies on.)
//
//   csc.exe -nologo -target:exe -unsafe -out:SpriteCutout.exe SpriteCutout.cs
//   SpriteCutout.exe <in.png> <out.png> [maxSize] [--bounds] [--crop=x,y,w,h] [--key=auto]
//
// `--key=auto` takes the backdrop colour from the four corners instead of assuming magenta, which
// is what a generated UI plaque needs: it comes back on whatever ground the model felt like.
//
// The frames of one animation must all be cut to the SAME rectangle or the pet jitters as it plays,
// so a caller building a frame run measures every frame with `--bounds` (which prints
// `x y w h keptPercent` and writes nothing), takes the union, and cuts each frame again with
// `--crop=` on that union. `keptPercent` is how much of the picture survived the key: it is how a
// caller spots the frame where the backdrop stopped being the key colour and stops the run there.
//
// The key is chroma-based, not an exact match: `min(r,b) - g` is large only for magenta, so red
// (low blue) and white (high green) survive, and the edge pixels between art and backdrop are
// faded rather than cut, which is what keeps the outline from looking sawn off.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

static class SpriteCutout
{
    const int Solid = 150;   // min(r,b)-g at or above this is certainly backdrop
    const int Edge = 60;     // and below this is certainly artwork; between the two it is feathered

    static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: SpriteCutout <in.png> <out.png> [maxSize] [--bounds] [--crop=x,y,w,h]");
            return 2;
        }
        int maxSize = 512;
        bool boundsOnly = false;
        bool autoKey = false;
        Rectangle? forced = null;
        for (int i = 2; i < args.Length; i++)
        {
            if (args[i] == "--bounds") boundsOnly = true;
            else if (args[i] == "--key=auto") autoKey = true;
            else if (args[i].StartsWith("--crop="))
            {
                var parts = args[i].Substring(7).Split(',');
                if (parts.Length != 4) { Console.Error.WriteLine("--crop takes x,y,w,h"); return 2; }
                forced = new Rectangle(int.Parse(parts[0]), int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
            }
            else if (!int.TryParse(args[i], out maxSize) || maxSize <= 0)
            {
                Console.Error.WriteLine("unknown argument: " + args[i]);
                return 2;
            }
        }

        using (var source = new Bitmap(args[0]))
        {
            int w = source.Width, h = source.Height;
            var keyed = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            long kept = 0;
            // Per row and per column rather than a running box: a handful of stray pixels the key
            // left in a corner — compression noise along the frame edge, mostly — would otherwise
            // stretch the box to the whole picture and shrink the character to a stamp.
            var rows = new int[h];
            var cols = new int[w];

            var readRect = new Rectangle(0, 0, w, h);
            var src = source.Clone(readRect, PixelFormat.Format32bppArgb);
            // `--key=auto`: whatever colour the four corners agree on is the backdrop. The magenta
            // rule below only recognises magenta, and a picture generated to order does not always
            // come back on the field it was asked for — a UI plaque on a dark plum ground, say.
            Color keyColour = Color.Magenta;
            if (autoKey)
            {
                int cx = Math.Max(0, Math.Min(1, w - 1)), cy = Math.Max(0, Math.Min(1, h - 1));
                int fx = Math.Max(0, w - 2), fy = Math.Max(0, h - 2);
                var corners = new Color[] { src.GetPixel(cx, cy), src.GetPixel(fx, cy), src.GetPixel(cx, fy), src.GetPixel(fx, fy) };
                int cr = 0, cg = 0, cb = 0;
                foreach (var c in corners) { cr += c.R; cg += c.G; cb += c.B; }
                keyColour = Color.FromArgb(cr / 4, cg / 4, cb / 4);
            }
            int keyR = keyColour.R, keyG = keyColour.G, keyB = keyColour.B;
            // Distances, not a chroma difference: with an arbitrary backdrop there is no channel
            // trick to lean on, so it is "near the key colour" out and "far from it" in.
            const int NearSolid = 44;
            const int NearEdge = 96;
            var srcData = src.LockBits(readRect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var dstData = keyed.LockBits(readRect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            unsafe
            {
                for (int y = 0; y < h; y++)
                {
                    byte* sp = (byte*)srcData.Scan0 + y * srcData.Stride;
                    byte* dp = (byte*)dstData.Scan0 + y * dstData.Stride;
                    for (int x = 0; x < w; x++, sp += 4, dp += 4)
                    {
                        int b = sp[0], g = sp[1], r = sp[2];
                        int alpha;
                        int sourceAlpha = sp[3];
                        if (autoKey)
                        {
                            int dr = r - keyR, dg = g - keyG, db = b - keyB;
                            int distance = (int)Math.Sqrt(dr * dr + dg * dg + db * db);
                            alpha = distance <= NearSolid ? 0 : distance >= NearEdge ? 255 : (255 * (distance - NearSolid)) / (NearEdge - NearSolid);
                        }
                        else
                        {
                            int key = Math.Min(r, b) - g;
                            alpha = key >= Solid ? 0 : key <= Edge ? 255 : (255 * (Solid - key)) / (Solid - Edge);
                            if (alpha > 0 && key > Edge)
                            {
                                // Spill suppression: pull the magenta cast out of the half-transparent rim.
                                r = Math.Min(r, g + 24);
                                b = Math.Min(b, g + 24);
                            }
                        }
                        // Never MORE opaque than the source: a PNG that already carries alpha would
                        // otherwise get its transparent pixels back as opaque black.
                        alpha = Math.Min(alpha, sourceAlpha);
                        if (alpha == 0) { r = 0; g = 0; b = 0; }   // no key colour left to bleed into a resample
                        dp[0] = (byte)b; dp[1] = (byte)g; dp[2] = (byte)r; dp[3] = (byte)alpha;
                        if (alpha > 24) { kept++; rows[y]++; cols[x]++; }
                    }
                }
            }
            src.UnlockBits(srcData);
            keyed.UnlockBits(dstData);
            src.Dispose();

            // A row or column counts as part of the artwork once half a percent of it survived.
            int rowFloor = Math.Max(3, w / 200);
            int colFloor = Math.Max(3, h / 200);
            int minX = w, minY = h, maxX = -1, maxY = -1;
            for (int y = 0; y < h; y++) if (rows[y] >= rowFloor) { if (y < minY) minY = y; maxY = y; }
            for (int x = 0; x < w; x++) if (cols[x] >= colFloor) { if (x < minX) minX = x; maxX = x; }
            if (maxX < minX || maxY < minY) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
            int pad = Math.Max(2, Math.Min(w, h) / 100);
            minX = Math.Max(0, minX - pad); minY = Math.Max(0, minY - pad);
            maxX = Math.Min(w - 1, maxX + pad); maxY = Math.Min(h - 1, maxY + pad);
            var crop = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
            if (boundsOnly)
            {
                keyed.Dispose();
                // The fifth number is how much of the picture survived the key, as a percentage.
                // It is the honest test for "the backdrop is gone": a character on a flat field
                // keeps a fifth to a third of the frame, and a frame whose background stopped being
                // the key colour keeps nearly all of it — while the bounding box alone cannot tell
                // a wide pose from a broken shot.
                Console.WriteLine("{0} {1} {2} {3} {4}", crop.X, crop.Y, crop.Width, crop.Height,
                    (int)Math.Round(100.0 * kept / ((double)w * h)));
                return 0;
            }
            if (forced.HasValue) crop = Rectangle.Intersect(forced.Value, new Rectangle(0, 0, w, h));
            if (crop.Width <= 0 || crop.Height <= 0) crop = new Rectangle(0, 0, w, h);

            double scale = Math.Min(1.0, (double)maxSize / Math.Max(crop.Width, crop.Height));
            int outW = Math.Max(1, (int)Math.Round(crop.Width * scale));
            int outH = Math.Max(1, (int)Math.Round(crop.Height * scale));
            using (var outBmp = new Bitmap(outW, outH, PixelFormat.Format32bppArgb))
            {
                using (var g2 = Graphics.FromImage(outBmp))
                {
                    g2.Clear(Color.Transparent);
                    g2.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g2.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g2.SmoothingMode = SmoothingMode.HighQuality;
                    g2.CompositingQuality = CompositingQuality.HighQuality;
                    g2.DrawImage(keyed, new Rectangle(0, 0, outW, outH), crop, GraphicsUnit.Pixel);
                }
                outBmp.Save(args[1], ImageFormat.Png);
            }
            keyed.Dispose();
            Console.WriteLine("{0} {1}x{2} -> {3}x{4}", args[1], w, h, outW, outH);
        }
        return 0;
    }
}
