// dsh-desktop-pet-cws desktop host (variant A: WinForms sprite; variant B: an Edge app window).
//
// Compiled on demand by the plugin with the .NET Framework compiler that ships with Windows
// (C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe), so the suite needs no SDK and no
// NuGet packages. It is a thin shell: everything it shows comes from the plugin over loopback
// HTTP, and everything the user does goes back the same way.
//
//   PetHost.exe --port 3080 --pet pet-1 --variant winforms --width 220 --height 260
//               --x 900 --y 500 --opacity 1 --top 1 --bubble 12 --title "小助手"
//
// Variant B starts Microsoft Edge in app mode on the plugin's own pet page and then styles that
// window frameless + always-on-top through Win32; if the styling is refused the window still
// works, it just keeps its normal frame.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace DshDesktopPet
{
    static class Program
    {
        // Per-monitor DPI awareness, before any window exists. Without it Windows renders the pet at
        // 96dpi and then bitmap-stretches the whole window to the display's scale — which is why an
        // unaware app looks soft on a 4K screen: the sprite AND the text in the bubble are blown up
        // copies rather than drawn at the size they are shown.
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        static readonly IntPtr PerMonitorAwareV2 = new IntPtr(-4);

        static void ClaimDpi()
        {
            // Windows 10 1703 and up take the context; anything older gets the old system-wide call.
            try { if (SetProcessDpiAwarenessContext(PerMonitorAwareV2)) return; } catch { }
            try { SetProcessDPIAware(); } catch { }
        }

        /// <summary>
        /// One pet window on the desktop, ever. A host left behind by an earlier dsh run does not
        /// know it was replaced, so the newcomer ends it: two pets talking over each other, each
        /// polling the same queue, is the worst of both.
        /// </summary>
        static void EndOtherHosts()
        {
            string myPath = "";
            try { myPath = System.Reflection.Assembly.GetEntryAssembly().Location; } catch { }
            var mine = Process.GetCurrentProcess();
            Process[] others;
            try { others = Process.GetProcessesByName(mine.ProcessName); } catch { return; }
            foreach (var other in others)
            {
                try
                {
                    if (other.Id == mine.Id) continue;
                    // Ours by identity or by home: every dsh pet host lives at <home>\pets\_host\PetHost.exe,
                    // wherever that home is — one pet slot on the desktop covers all of them.
                    // Fails CLOSED: a process whose path cannot be read is not killed.
                    string theirPath = "";
                    try { theirPath = other.MainModule.FileName; } catch { /* other bitness or session */ }
                    if (theirPath.Length == 0) continue;
                    if (!(myPath.Length > 0 && string.Equals(myPath, theirPath, StringComparison.OrdinalIgnoreCase))
                        && !theirPath.EndsWith("\\pets\\_host\\PetHost.exe", StringComparison.OrdinalIgnoreCase)) continue;
                    other.Kill();
                    other.WaitForExit(3000);
                }
                catch { /* gone, or not ours to end */ }
                finally { other.Dispose(); }
            }
            mine.Dispose();
        }

        [STAThread]
        static void Main(string[] args)
        {
            ClaimDpi();
            EndOtherHosts();
            var opt = ParseArgs(args);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (Get(opt, "variant", "winforms") == "webview") { new WebViewHost(opt).Run(); return; }
            Application.Run(new PetForm(opt));
        }

        internal static Dictionary<string, string> ParseArgs(string[] args)
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--")) continue;
                string key = args[i].Substring(2);
                string value = (i + 1 < args.Length && !args[i + 1].StartsWith("--")) ? args[++i] : "1";
                map[key] = value;
            }
            return map;
        }

        internal static string Get(Dictionary<string, string> map, string key, string fallback)
        {
            string value;
            return map.TryGetValue(key, out value) && value.Length > 0 ? value : fallback;
        }

        internal static int GetInt(Dictionary<string, string> map, string key, int fallback)
        {
            int value;
            return int.TryParse(Get(map, key, ""), out value) ? value : fallback;
        }

        internal static double GetDouble(Dictionary<string, string> map, string key, double fallback)
        {
            double value;
            return double.TryParse(Get(map, key, ""), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value) ? value : fallback;
        }
    }

    /// <summary>How the pet's speech looks. The plugin passes the owner's choices on the command
    /// line; every window here is drawn from this one record so the pet looks like itself.</summary>
    class Theme
    {
        public Color Bg = Color.FromArgb(20, 24, 33);
        public Color Text = Color.FromArgb(233, 237, 246);
        public Color Accent = Color.FromArgb(106, 163, 255);
        public int Radius = 16;
        public int Blur = 18;
        public double Opacity = 0.72;
        public float FontSize = 10.5f;
        /// <summary>"art" means the pieces the image model drew are the chat furniture.</summary>
        public string Ui = "plain";
        /// <summary>How far in from each edge of those drawings the stretchable middle starts, %.</summary>
        public int Slice = 28;
        public Image BubbleArt, InputArt, ButtonArt;
        public bool Drawn { get { return Ui == "art" && BubbleArt != null; } }

        public static Theme From(Dictionary<string, string> opt)
        {
            var t = new Theme();
            t.Bg = Parse(Program.Get(opt, "bubble-bg", ""), t.Bg);
            t.Text = Parse(Program.Get(opt, "bubble-text", ""), t.Text);
            t.Accent = Parse(Program.Get(opt, "accent", ""), t.Accent);
            t.Radius = Math.Max(0, Math.Min(28, Program.GetInt(opt, "radius", t.Radius)));
            t.Blur = Math.Max(0, Math.Min(40, Program.GetInt(opt, "blur", t.Blur)));
            t.Opacity = Math.Max(0.25, Math.Min(1, Program.GetDouble(opt, "bubble-opacity", t.Opacity)));
            // The panel's number is a CSS pixel size; WinForms wants points, and 0.78 is the ratio.
            t.FontSize = (float)Math.Max(8, Math.Min(16, Program.GetInt(opt, "font-size", 13) * 0.78));
            t.Ui = Program.Get(opt, "ui", "plain");
            t.Slice = Math.Max(8, Math.Min(45, Program.GetInt(opt, "slice", 28)));
            return t;
        }

        static Color Parse(string hex, Color fallback)
        {
            if (hex == null || hex.Length != 7 || hex[0] != '#') return fallback;
            try
            {
                return Color.FromArgb(
                    Convert.ToInt32(hex.Substring(1, 2), 16),
                    Convert.ToInt32(hex.Substring(3, 2), 16),
                    Convert.ToInt32(hex.Substring(5, 2), 16));
            }
            catch { return fallback; }
        }

        /// <summary>
        /// Draw one picture to fill a rectangle without stretching its corners: the four corners go
        /// down at their own size, the four edges stretch along one axis and the middle stretches
        /// both ways. It is what lets one drawing be a bubble around any sentence.
        /// </summary>
        public void DrawNineSlice(Graphics g, Image art, Rectangle into)
        {
            if (art == null || into.Width <= 0 || into.Height <= 0) return;
            int sw = art.Width, sh = art.Height;
            int sx = Math.Max(1, sw * Slice / 100), sy = Math.Max(1, sh * Slice / 100);
            // Never let the kept corners exceed the space there is to put them in.
            int dx = Math.Min(sx, into.Width / 2), dy = Math.Min(sy, into.Height / 2);
            var src = new int[][] { new[] { 0, sx, sw - 2 * sx }, new[] { 0, sy, sh - 2 * sy } };
            var dst = new int[][] { new[] { 0, dx, into.Width - 2 * dx }, new[] { 0, dy, into.Height - 2 * dy } };
            int[] sxs = { 0, sx, sw - sx }, sws = { sx, sw - 2 * sx, sx };
            int[] sys = { 0, sy, sh - sy }, shs = { sy, sh - 2 * sy, sy };
            int[] dxs = { into.X, into.X + dx, into.Right - dx }, dws = { dx, into.Width - 2 * dx, dx };
            int[] dys = { into.Y, into.Y + dy, into.Bottom - dy }, dhs = { dy, into.Height - 2 * dy, dy };
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            for (int row = 0; row < 3; row++)
            {
                for (int col = 0; col < 3; col++)
                {
                    if (sws[col] <= 0 || shs[row] <= 0 || dws[col] <= 0 || dhs[row] <= 0) continue;
                    g.DrawImage(art,
                        new Rectangle(dxs[col], dys[row], dws[col], dhs[row]),
                        sxs[col], sys[row], sws[col], shs[row], GraphicsUnit.Pixel);
                }
            }
        }

        /// <summary>Fetch the drawn set once, best-effort: without it the plain look is used.</summary>
        public void LoadArt(PetApi api)
        {
            if (Ui != "art") return;
            BubbleArt = Fetch(api, "bubble");
            InputArt = Fetch(api, "input");
            ButtonArt = Fetch(api, "button");
        }

        static Image Fetch(PetApi api, string part)
        {
            try
            {
                var bytes = api.GetBytes("/dsh-desktop-pet/ui?pet=" + Uri.EscapeDataString(api.PetId) + "&part=" + part);
                if (bytes == null || bytes.Length < 16) return null;
                return Image.FromStream(new MemoryStream(bytes));
            }
            catch { return null; }
        }

        /// <summary>A rounded rectangle for the window region — square corners are the giveaway.</summary>
        public GraphicsPath RoundedPath(int w, int h)
        {
            int r = Math.Max(0, Math.Min(Radius, Math.Min(w, h) / 2));
            var path = new GraphicsPath();
            if (r == 0) { path.AddRectangle(new Rectangle(0, 0, w, h)); return path; }
            int d = r * 2;
            path.AddArc(0, 0, d, d, 180, 90);
            path.AddArc(w - d, 0, d, d, 270, 90);
            path.AddArc(w - d, h - d, d, d, 0, 90);
            path.AddArc(0, h - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    /// <summary>The menu in the pet's own colours. The stock one is white with black text, which
    /// next to a drawn pet looks like a system dialog wandered in.</summary>
    /// <summary>
    /// Holographic drawing helpers. Bloom works by stroking into a third-scale ARGB
    /// surface and scaling it back up with bilinear filtering — a cheap, real blur.
    /// </summary>
    static class Holo
    {
        public static void BloomPath(Graphics g, GraphicsPath path, Color c, int alpha, float strokeWidth, int w, int h)
        {
            const int f = 3;
            using (var small = new Bitmap(Math.Max(1, w / f), Math.Max(1, h / f), PixelFormat.Format32bppArgb))
            {
                using (var sg = Graphics.FromImage(small))
                {
                    sg.SmoothingMode = SmoothingMode.AntiAlias;
                    sg.ScaleTransform(1f / f, 1f / f);
                    using (var pen = new Pen(Color.FromArgb(alpha, c), strokeWidth * f))
                    {
                        pen.LineJoin = LineJoin.Round;
                        sg.DrawPath(pen, path);
                    }
                }
                var old = g.InterpolationMode;
                g.InterpolationMode = InterpolationMode.HighQualityBilinear;
                g.DrawImage(small, new Rectangle(0, 0, w, h), 0, 0, small.Width, small.Height, GraphicsUnit.Pixel);
                g.InterpolationMode = old;
            }
        }

        public static void BloomEllipse(Graphics g, RectangleF rc, Color c, int alpha, int w, int h)
        {
            using (var path = new GraphicsPath())
            {
                path.AddEllipse(rc);
                BloomPath(g, path, c, alpha, Math.Max(2f, rc.Width / 3f), w, h);
            }
        }

        /// <summary>Style-guide text: ghost .11 far behind, shadow .33, main .88.</summary>
        public static void Text(Graphics g, string text, Font font, Color main, float x, float y, int alpha)
        {
            using (var ghost = new SolidBrush(Color.FromArgb(28 * alpha / 255, 244, 255, 255)))
            {
                g.DrawString(text, font, ghost, x + 2.5f, y + 3f);
                g.DrawString(text, font, ghost, x + 3.5f, y + 3f);
            }
            using (var shadow = new SolidBrush(Color.FromArgb(84 * alpha / 255, 0, 0, 0))) g.DrawString(text, font, shadow, x + 1, y + 1);
            using (var ink = new SolidBrush(Color.FromArgb(Math.Min(224, alpha), main))) g.DrawString(text, font, ink, x, y);
        }

        public static void DotGrid(Graphics g, Rectangle rc, int step, int alpha)
        {
            using (var dot = new SolidBrush(Color.FromArgb(alpha, 244, 255, 255)))
                for (int y = rc.Top + step / 2; y < rc.Bottom; y += step)
                    for (int x = rc.Left + step / 2; x < rc.Right; x += step)
                        g.FillRectangle(dot, x, y, 1, 1);
        }

        public static void Scanlines(Graphics g, Rectangle rc, int alpha)
        {
            using (var line = new Pen(Color.FromArgb(alpha, 0, 0, 0)))
                for (int y = rc.Top; y < rc.Bottom; y += 3)
                    g.DrawLine(line, rc.Left, y, rc.Right, y);
        }

        /// <summary>Double-line corner brackets, the projection's frame.</summary>
        public static void Brackets(Graphics g, Rectangle rc, Color accent, int alpha, int len, float weight)
        {
            using (var outer = new Pen(Color.FromArgb(alpha, accent), weight))
            using (var inner = new Pen(Color.FromArgb(alpha / 2, accent), Math.Max(1f, weight / 2)))
            {
                int o = 0, i2 = (int)(weight * 3);
                foreach (var corner in new[] { 0, 1, 2, 3 })
                {
                    int cx = (corner == 0 || corner == 2) ? rc.Left : rc.Right - 1;
                    int cy = (corner < 2) ? rc.Top : rc.Bottom - 1;
                    int dx = (corner == 0 || corner == 2) ? 1 : -1;
                    int dy = (corner < 2) ? 1 : -1;
                    g.DrawLine(outer, cx + o * dx, cy, cx + len * dx, cy);
                    g.DrawLine(outer, cx, cy + o * dy, cx, cy + len * dy);
                    g.DrawLine(inner, cx + i2 * dx, cy + i2 * dy, cx + (len - 2) * dx, cy + i2 * dy);
                    g.DrawLine(inner, cx + i2 * dx, cy + i2 * dy, cx + i2 * dx, cy + (len - 2) * dy);
                }
            }
        }
    }

    /// <summary>Win11 acrylic-behind for popup shapes; a silent no-op where unsupported.</summary>
    /// <summary>
    /// The glass behind the menu and the status panel.
    ///
    /// `ACCENT_ENABLE_ACRYLICBLURBEHIND` (SetWindowCompositionAttribute) is the Windows 10 way. On
    /// Windows 11 it paints a Win32 popup FULLY TRANSPARENT rather than blurred — dark text over
    /// whatever is behind the window — while a screen capture still composites the intended plate,
    /// so the bug is invisible in screenshots. There, DWM's supported backdrop attribute is asked
    /// for instead; if it is refused, nothing is applied and each window's own opaque paint stands.
    /// Both callers paint an opaque background, so "no effect" is always readable.
    /// </summary>
    static class Acrylic
    {
        [StructLayout(LayoutKind.Sequential)]
        struct AccentPolicy { public int AccentState, AccentFlags, GradientColor, AnimationId; }
        [StructLayout(LayoutKind.Sequential)]
        struct CompositionData { public int Attribute; public IntPtr Data; public int SizeOfData; }
        [DllImport("user32.dll")] static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref CompositionData data);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        const int DwmSystemBackdropType = 38;   // DWMWA_SYSTEMBACKDROP_TYPE
        const int TransientWindow = 3;          // DWMSBT_TRANSIENTWINDOW: the menu / flyout material
        const int DwmDarkMode = 20;             // DWMWA_USE_IMMERSIVE_DARK_MODE

        static int build = -1;
        /// <summary>The real OS build. Environment.OSVersion lies without a supportedOS manifest, so read it.</summary>
        static int Build
        {
            get
            {
                if (build >= 0) return build;
                build = 0;
                try
                {
                    using (var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
                        if (key != null) int.TryParse(Convert.ToString(key.GetValue("CurrentBuildNumber")), out build);
                }
                catch { build = 0; }
                return build;
            }
        }

        public static void Enable(IntPtr handle, int tintAbgr)
        {
            if (Build >= 22000)
            {
                try
                {
                    var dark = 1;
                    DwmSetWindowAttribute(handle, DwmDarkMode, ref dark, sizeof(int));
                    var backdrop = TransientWindow;
                    DwmSetWindowAttribute(handle, DwmSystemBackdropType, ref backdrop, sizeof(int));
                }
                catch { /* the opaque plate stands */ }
                return;
            }
            try
            {
                var policy = new AccentPolicy { AccentState = 4, AccentFlags = 2, GradientColor = tintAbgr };
                var size = Marshal.SizeOf(policy);
                var mem = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(policy, mem, false);
                    var data = new CompositionData { Attribute = 19, Data = mem, SizeOfData = size };
                    SetWindowCompositionAttribute(handle, ref data);
                }
                finally { Marshal.FreeHGlobal(mem); }
            }
            catch { /* older Windows: the plain plate stays */ }
        }
    }

    class PetMenuColors : ProfessionalColorTable
    {
        readonly Theme t;
        public PetMenuColors(Theme t) { this.t = t; UseSystemColors = false; }
        Color Plate { get { return Blend(t.Bg, Color.White, 0.045); } }
        Color Hot { get { return Blend(t.Bg, t.Accent, 0.30); } }
        static Color Blend(Color a, Color b, double k)
        {
            return Color.FromArgb(
                (int)(a.R + (b.R - a.R) * k), (int)(a.G + (b.G - a.G) * k), (int)(a.B + (b.B - a.B) * k));
        }
        public override Color ToolStripDropDownBackground { get { return Plate; } }
        public override Color MenuItemSelected { get { return Hot; } }
        public override Color MenuItemSelectedGradientBegin { get { return Hot; } }
        public override Color MenuItemSelectedGradientEnd { get { return Hot; } }
        public override Color MenuItemBorder { get { return Color.Transparent; } }
        public override Color MenuBorder { get { return Blend(t.Bg, t.Accent, 0.45); } }
        public override Color ImageMarginGradientBegin { get { return Plate; } }
        public override Color ImageMarginGradientMiddle { get { return Plate; } }
        public override Color ImageMarginGradientEnd { get { return Plate; } }
        public override Color SeparatorDark { get { return Blend(t.Bg, Color.White, 0.18); } }
        public override Color SeparatorLight { get { return Plate; } }
        public override Color MenuItemPressedGradientBegin { get { return Hot; } }
        public override Color MenuItemPressedGradientEnd { get { return Hot; } }
    }

    class PetMenuRenderer : ToolStripProfessionalRenderer
    {
        readonly Theme t;
        public PetMenuRenderer(Theme t) : base(new PetMenuColors(t)) { this.t = t; RoundedEdges = true; }
        public const int MenuRadius = 10;
        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            if (!(e.ToolStrip is ToolStripDropDown)) { base.OnRenderToolStripBorder(e); return; }
            var g = e.Graphics;
            var old = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TranslateTransform(0.5f, 0.5f);
            using (var path = RoundedRect(new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1), MenuRadius))
            using (var pen = new Pen(ColorTable.MenuBorder)) g.DrawPath(pen, path);
            g.ResetTransform();
            g.SmoothingMode = old;
        }
        internal static GraphicsPath RoundedRect(Rectangle r, int rad)
        {
            rad = Math.Max(1, Math.Min(rad, Math.Min(r.Width, r.Height) / 2));
            var p = new GraphicsPath();
            p.AddArc(r.X, r.Y, rad * 2, rad * 2, 180, 90);
            p.AddArc(r.Right - rad * 2, r.Y, rad * 2, rad * 2, 270, 90);
            p.AddArc(r.Right - rad * 2, r.Bottom - rad * 2, rad * 2, rad * 2, 0, 90);
            p.AddArc(r.X, r.Bottom - rad * 2, rad * 2, rad * 2, 90, 90);
            p.CloseFigure();
            return p;
        }
        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            if (!e.Item.Selected || !e.Item.Enabled) { base.OnRenderMenuItemBackground(e); return; }
            var g = e.Graphics;
            var old = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float k = Math.Max(1f, e.Item.Height / 22f);
            var rc = new Rectangle((int)(2 * k), 1, e.Item.Width - (int)(4 * k), e.Item.Height - 2);
            using (var fill = new SolidBrush(t.Accent))
                g.FillRectangle(fill, rc);
            g.SmoothingMode = old;
        }
        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = e.Item.Selected && e.Item.Enabled
                ? Color.FromArgb(10, 12, 15)
                : (e.Item.Enabled ? Color.FromArgb(244, 255, 255) : Color.FromArgb(140, t.Text));
            base.OnRenderItemText(e);
        }
    }

    /// <summary>
    /// Painting a window by handing Windows a whole ARGB bitmap. What it buys is per-pixel alpha:
    /// the soft edge of a drawing blends with the desktop, and the parts of the window the drawing
    /// does not cover are not there at all — no plate of background colour around the artwork.
    /// </summary>
    static class Layered
    {
        const int UlwAlpha = 0x00000002;
        const byte AcSrcOver = 0x00;
        const byte AcSrcAlpha = 0x01;

        [StructLayout(LayoutKind.Sequential)] struct PointL { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] struct SizeL { public int Cx, Cy; }
        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        struct BlendFunction { public byte Op, Flags, Alpha, Format; }

        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hDC);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hDC);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr hObject);
        [DllImport("user32.dll")]
        static extern bool UpdateLayeredWindow(IntPtr hWnd, IntPtr hdcDst, ref PointL pptDst, ref SizeL psize,
            IntPtr hdcSrc, ref PointL pptSrc, int crKey, ref BlendFunction pblend, int dwFlags);

        public static void Push(IntPtr handle, int left, int top, Bitmap bitmap, byte alpha)
        {
            if (handle == IntPtr.Zero || bitmap == null) return;
            IntPtr screen = GetDC(IntPtr.Zero);
            IntPtr memory = CreateCompatibleDC(screen);
            IntPtr bits = IntPtr.Zero;
            IntPtr previous = IntPtr.Zero;
            try
            {
                bits = bitmap.GetHbitmap(Color.FromArgb(0));
                previous = SelectObject(memory, bits);
                var size = new SizeL(); size.Cx = bitmap.Width; size.Cy = bitmap.Height;
                var at = new PointL(); at.X = left; at.Y = top;
                var from = new PointL();
                var blend = new BlendFunction();
                blend.Op = AcSrcOver; blend.Flags = 0; blend.Alpha = alpha; blend.Format = AcSrcAlpha;
                UpdateLayeredWindow(handle, screen, ref at, ref size, memory, ref from, 0, ref blend, UlwAlpha);
            }
            finally
            {
                if (previous != IntPtr.Zero) SelectObject(memory, previous);
                if (bits != IntPtr.Zero) DeleteObject(bits);
                DeleteDC(memory);
                ReleaseDC(IntPtr.Zero, screen);
            }
        }
    }

    /// <summary>The frosted backdrop behind a window. Windows has drawn one for its own surfaces
    /// since 10; `SetWindowCompositionAttribute` is how everything else asks for the same thing. It
    /// is undocumented, so a failure here is silent and the window is merely translucent.</summary>
    static class Glass
    {
        [StructLayout(LayoutKind.Sequential)]
        struct AccentPolicy { public int AccentState, AccentFlags, GradientColor, AnimationId; }
        [StructLayout(LayoutKind.Sequential)]
        struct WindowCompositionAttributeData { public int Attribute; public IntPtr Data; public int SizeOfData; }

        const int AccentEnableAcrylic = 4;
        const int AccentEnableBlurBehind = 3;
        const int WcaAccentPolicy = 19;

        [DllImport("user32.dll")]
        static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

        public static void Apply(IntPtr handle, Color tint, int blur)
        {
            if (handle == IntPtr.Zero || blur <= 0) return;
            var policy = new AccentPolicy();
            policy.AccentState = Environment.OSVersion.Version.Major >= 10 ? AccentEnableAcrylic : AccentEnableBlurBehind;
            // The tint rides in as 0xAABBGGRR, and the alpha is how much of the pet's own colour
            // survives over the blur.
            int alpha = Math.Max(0, Math.Min(255, blur * 5));
            policy.GradientColor = (alpha << 24) | (tint.B << 16) | (tint.G << 8) | tint.R;
            policy.AccentFlags = 2;
            int size = Marshal.SizeOf(typeof(AccentPolicy));
            IntPtr memory = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(policy, memory, false);
                var data = new WindowCompositionAttributeData();
                data.Attribute = WcaAccentPolicy;
                data.Data = memory;
                data.SizeOfData = size;
                SetWindowCompositionAttribute(handle, ref data);
            }
            catch { /* an older Windows, or the export moved: the window stays translucent */ }
            finally { Marshal.FreeHGlobal(memory); }
        }
    }

    /// <summary>Loopback client for the plugin's routes. Every call is best-effort: the pet must
    /// never crash because dsh restarted.</summary>
    /// <summary>WebClient with a deadline: its default is 100 seconds, and three of these run
    /// synchronously during startup — a stalled port meant a five-minute ghost process.</summary>
    class TimedWebClient : WebClient
    {
        protected override WebRequest GetWebRequest(Uri address)
        {
            var request = base.GetWebRequest(address);
            if (request != null) request.Timeout = 3000;
            // Timeout bounds connect + headers only; a body that stalls is ReadWriteTimeout's
            // problem, whose default is five minutes.
            var http = request as HttpWebRequest;
            if (http != null) http.ReadWriteTimeout = 3000;
            return request;
        }
    }

    class PetApi
    {
        readonly string baseUrl;
        readonly string petId;
        readonly string token;
        readonly JavaScriptSerializer json = new JavaScriptSerializer();

        public PetApi(string baseUrl, string petId) : this(baseUrl, petId, "") { }
        public PetApi(string baseUrl, string petId, string token) { this.baseUrl = baseUrl; this.petId = petId; this.token = token ?? ""; }
        public string PetId { get { return petId; } }
        public string BaseUrl { get { return baseUrl; } }

        WebClient NewClient()
        {
            var client = new TimedWebClient();
            client.Encoding = Encoding.UTF8;
            client.Headers[HttpRequestHeader.ContentType] = "application/json";
            // This window IS the pet's own window; the plugin minted this token for this run and
            // gave it to us on the command line. Without it the routes that only the panel and this
            // window may use — answering a permission card, above all — refuse us.
            if (token.Length > 0) client.Headers["x-dsh-pet-host"] = token;
            return client;
        }

        public Dictionary<string, object> GetJson(string path)
        {
            try
            {
                using (var client = NewClient())
                {
                    string text = client.DownloadString(baseUrl + path);
                    return json.Deserialize<Dictionary<string, object>>(text);
                }
            }
            catch { return null; }
        }

        public Dictionary<string, object> PostJson(string path, Dictionary<string, object> body)
        {
            try
            {
                using (var client = NewClient())
                {
                    string text = client.UploadString(baseUrl + path, "POST", json.Serialize(body));
                    return json.Deserialize<Dictionary<string, object>>(text);
                }
            }
            catch { return null; }
        }

        public byte[] GetBytes(string path)
        {
            try { using (var client = NewClient()) { return client.DownloadData(baseUrl + path); } }
            catch { return null; }
        }

        public static string Str(Dictionary<string, object> map, string key)
        {
            object value;
            if (map != null && map.TryGetValue(key, out value) && value != null) return value.ToString();
            return "";
        }

        /// <summary>A JSON number, whatever CLR type the deserializer chose for it.</summary>
        public static int Int(Dictionary<string, object> map, string key, int fallback)
        {
            int parsed;
            string raw = Str(map, key);
            return int.TryParse(raw, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
        }
    }

    /// <summary>Variant A: a transparent always-on-top sprite with a speech bubble.</summary>
    class PetForm : Form
    {
        readonly PetApi api;
        readonly Timer poll = new Timer();
        readonly Timer bubbleTimer = new Timer();
        readonly BubbleForm bubble;
        readonly int bubbleSeconds;
        readonly NotifyIcon tray = new NotifyIcon();
        readonly Timer anim = new Timer();
        readonly ChatForm chat;
        StatusPanel statusPanel;
        SizeHandle sizeHandle;
        /// <summary>The drawings of the sprite showing now, and the order they are played in.</summary>
        List<Image> frames = new List<Image>();
        /// <summary>The frames scaled to the window, premultiplied, keyed by frame index. The
        /// sources are 2048² drawings and the window is a few hundred pixels: scaling one with
        /// HighQualityBicubic measured ~29 ms, which at 14 fps was a third of a core sitting idle
        /// and, at the drag's 60 Hz, more than the whole tick — mouse moves queued behind it and
        /// the pet trailed the cursor. Scaled once per window size, drawn 1:1 from then on. Bounded by
        /// the frame count (MaxFrames 24): at most 24 × window² × 4 bytes — ~5 MB for the default
        /// 220×260, 188 MB at the 1400² ceiling — and dropped whenever the window changes size.</summary>
        readonly Dictionary<int, Bitmap> scaledFrames = new Dictionary<int, Bitmap>();
        Size scaledFor;
        int[] order = new int[] { 0 };
        int frameAt;
        /// <summary>Bumped on every load: a slow fetch that lands after the next one is dropped.</summary>
        int loadToken;
        /// <summary>Set once a load has come back. Until then the window draws nothing at all: a
        /// placeholder shown while the real drawing is still being fetched is a flash of something
        /// that is not the pet, every single time it is woken.</summary>
        bool triedSprite;
        string spriteName = "";
        long since = 0;
        bool muted;
        volatile bool polling;
        string lastAudioFile;
        Point dragStart;
        bool dragging;
        // Drag feel: the sprite leans into the motion and stretches with vertical speed, then springs
        // back when released. A timer owns it — not the mouse events — so a fast drag never queues
        // one render per pixel of travel.
        readonly Timer dragAnim = new Timer();
        // Millisecond clock for drag velocity: Environment.TickCount steps by ~16 ms, which made
        // consecutive samples read as either instantaneous or slow.
        static readonly Stopwatch dragClock = Stopwatch.StartNew();
        Point dragLast;
        long dragLastTick;
        bool dragMoving;
        double tilt, tiltVel, tiltTarget;          // degrees, pivot near the top of the drawing
        double stretch = 1, stretchTarget = 1;     // vertical scale
        StreamWriter dragTrace;                    // maintainer switch: --drag-log <file>
        bool dragged;
        /// <summary>Dragging the bottom-right corner resizes instead of moving.</summary>
        bool sizing;
        Size sizeStart;
        Point sizeFrom;
        double opacity = 1;
        Bitmap surface;
        bool gripHot;

        public PetForm(Dictionary<string, string> opt)
        {
            api = new PetApi("http://127.0.0.1:" + Program.GetInt(opt, "port", 3080), Program.Get(opt, "pet", "pet-1"), Program.Get(opt, "token", ""));
            bubbleSeconds = Program.GetInt(opt, "bubble", 12);
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = Program.Get(opt, "top", "1") != "0";
            // No colour key: the window is layered and gets the sprite's own alpha channel, so the
            // soft edge of a cut-out drawing blends with the desktop instead of against a key colour
            // that would leave a coloured rim around it. `Opacity` is not set for the same reason —
            // WinForms would drive the same layering a different way — it rides in the blend below.
            opacity = Program.GetDouble(opt, "opacity", 1);
            Width = Program.GetInt(opt, "width", 220);
            Height = Program.GetInt(opt, "height", 260);
            StartPosition = FormStartPosition.Manual;
            var screen = Screen.PrimaryScreen.WorkingArea;
            int x = Program.GetInt(opt, "x", -1);
            int y = Program.GetInt(opt, "y", -1);
            Location = new Point(x >= 0 ? x : screen.Right - Width - 40, y >= 0 ? y : screen.Bottom - Height - 40);
            Text = Program.Get(opt, "title", "dsh 桌宠");
            DoubleBuffered = true;

            var theme = Theme.From(opt);
            theme.LoadArt(api);
            float dpiScale = 1f;
            try { using (var probe = Graphics.FromHwnd(IntPtr.Zero)) dpiScale = probe.DpiX / 96f; } catch { }
            bubble = new BubbleForm(theme, dpiScale);
            bubbleTimer.Interval = Math.Max(2, bubbleSeconds) * 1000;
            bubbleTimer.Tick += delegate { bubbleTimer.Stop(); bubble.Hide(); };

            chat = new ChatForm(SendText, theme, dpiScale);
            statusPanel = new StatusPanel(api, theme, dpiScale);
            int dragStartW = 0;
            double dragRatio = 1;
            sizeHandle = new SizeHandle(theme, dpiScale,
                delegate { dragStartW = Width; dragRatio = (double)Height / Math.Max(1, Width); },
                delegate(int dx)
                {
                    int target = Math.Max(120, Math.Min(900, dragStartW + dx));
                    ScaleTo(new Size(target, (int)Math.Round(target * dragRatio)), 1.0);
                    PlacePanel();
                    PlaceHandle();
                },
                delegate { RememberWindow(); });

            var menu = new ContextMenuStrip();
            menu.RenderMode = ToolStripRenderMode.Professional;
            menu.Renderer = new PetMenuRenderer(theme);
            menu.BackColor = theme.Bg;
            menu.ForeColor = theme.Text;
            menu.Font = new Font("Microsoft YaHei UI", Math.Max(8.5f, theme.FontSize - 0.5f));
            menu.ShowImageMargin = false;
            menu.Items.Add("发送消息…", null, delegate { ToggleChat(); });
            menu.Items.Add("在浏览器中打开对话页", null, delegate { OpenChat(); });
            menu.Items.Add("打开 dsh 面板", null, delegate { OpenSettings(); });
            var sizeHint = new ToolStripMenuItem("调整大小:拖动右下角,或 Ctrl+滚轮");
            sizeHint.Enabled = false;
            menu.Items.Add(sizeHint);
            var muteItem = new ToolStripMenuItem("静音");
            // The check glyph lives in the image margin this menu turns off, so the state is worn
            // in the text instead.
            muteItem.Click += delegate { muted = !muted; muteItem.Checked = muted; muteItem.Text = muted ? "取消静音" : "静音"; };
            menu.Items.Add(muteItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("关闭桌宠", null, delegate { Close(); });
            menu.Padding = new Padding(4, 6, 4, 6);
            menu.Opened += delegate
            {
                try { using (var mp = PetMenuRenderer.RoundedRect(new Rectangle(0, 0, menu.Width, menu.Height), PetMenuRenderer.MenuRadius)) menu.Region = new Region(mp); } catch { /* square is fine */ }
                // A context menu has to be readable before it is pretty: the plate underneath is
                // opaque, and the effect below is only ever an addition to it.
                Acrylic.Enable(menu.Handle, unchecked((int)0xDD16110E));
            };
            ContextMenuStrip = menu;

            tray.Icon = SystemIcons.Application;
            tray.Text = Text;
            tray.Visible = true;
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { ToggleChat(); };

            MouseDown += delegate(object s, MouseEventArgs e)
            {
                if (e.Button != MouseButtons.Left) return;
                Capture = true;
                if (InGrip(e.Location))
                {
                    sizing = true;
                    sizeStart = Size;
                    sizeFrom = Cursor.Position;
                    return;
                }
                dragging = true; dragged = false; dragStart = e.Location;
                // The lean timer starts when this turns into a drag (in MouseMove), not on the press:
                // a press-and-hold would otherwise render an unchanged sprite at 60 Hz until release.
            };
            // WM_CAPTURECHANGED (Alt+Tab, a menu opening, another window clicked mid-drag) does not
            // synthesize a MouseUp; without this the next innocent hover teleported the window.
            MouseCaptureChanged += delegate { dragging = false; sizing = false; };
            MouseMove += delegate(object s, MouseEventArgs e)
            {
                if ((MouseButtons & MouseButtons.Left) == 0) { dragging = false; sizing = false; }
                if (sizing)
                {
                    // Both sides by the same fraction: the drawing has one shape and stretching it
                    // to whatever rectangle the cursor traced is what makes a pet look cheap.
                    int moved = Math.Max(Cursor.Position.X - sizeFrom.X, Cursor.Position.Y - sizeFrom.Y);
                    double scale = 1 + (double)moved / Math.Max(80, sizeStart.Width);
                    ScaleTo(sizeStart, scale);
                    return;
                }
                if (!dragging)
                {
                    bool hot = InGrip(e.Location);
                    Cursor = hot ? Cursors.SizeNWSE : Cursors.Default;
                    if (hot != gripHot) { gripHot = hot; Render(); }
                    return;
                }
                // A couple of pixels of wobble while pressing is a click, not a drag: without this
                // the pet would slide away from under the cursor every time it is talked to.
                if (!dragged)
                {
                    if (Math.Abs(e.X - dragStart.X) <= 3 && Math.Abs(e.Y - dragStart.Y) <= 3) return;
                    dragged = true;
                    // Velocity samples start here, not at the press: a hold-then-flick would
                    // otherwise average its first sample over the whole hold.
                    dragLast = Cursor.Position; dragLastTick = dragClock.ElapsedMilliseconds; dragMoving = false;
                    dragAnim.Start();
                }
                Location = new Point(Location.X + e.X - dragStart.X, Location.Y + e.Y - dragStart.Y);
                // Velocity from the screen cursor (window-relative deltas drift while the window moves).
                // Moving the window under a still cursor raises a second MouseMove with no screen
                // travel at all — an echo of the move just made, not motion — and it must not zero
                // the lean the real move just set.
                var now = Cursor.Position;
                if (now.X == dragLast.X && now.Y == dragLast.Y) return;
                long tick = dragClock.ElapsedMilliseconds;
                double dt = Math.Max(4, tick - dragLastTick);
                double vx = (now.X - dragLast.X) / dt, vy = (now.Y - dragLast.Y) / dt;   // px per ms
                dragLast = now; dragLastTick = tick;
                // The bottom leads the motion — the feet kick out ahead of the hand (RotateTransform
                // is clockwise for a positive angle, so a leftward drag swings the feet left). A
                // pendulum hanging from the hand would want the opposite sign; this was chosen by eye.
                tiltTarget = Math.Max(-16, Math.Min(16, -vx * 14));
                stretchTarget = Math.Max(0.90, Math.Min(1.10, 1 - vy * 0.06));
                dragMoving = true;
                if (dragTrace != null) DragTrace("move vx=" + vx.ToString("F2") + " dt=" + dt + " target=" + tiltTarget.ToString("F1") + " timer=" + dragAnim.Enabled);
            };
            MouseLeave += delegate { if (gripHot) { gripHot = false; Render(); } };
            MouseUp += delegate(object s, MouseEventArgs e)
            {
                // Snapshot FIRST: setting Capture = false sends WM_CAPTURECHANGED synchronously,
                // which runs the cancel handler below and clears these very flags — with the
                // release first, the click never opened the chat and geometry never persisted.
                bool wasSizing = sizing, wasDragging = dragging, wasDragged = dragged;
                sizing = false; dragging = false;
                Capture = false;
                if (wasSizing) { RememberWindow(); return; }
                if (!wasDragging) return;
                if (!wasDragged) { ToggleChat(); return; }   // clicked, not moved: talk to it
                DragTraceFlush();
                RememberWindow();
            };

            // Ctrl + wheel is the other way to size it, for anyone who never finds the corner.
            MouseWheel += delegate(object s, MouseEventArgs e)
            {
                if ((ModifierKeys & Keys.Control) == 0) return;
                ScaleTo(Size, e.Delta > 0 ? 1.1 : 1 / 1.1);
                RememberWindow();
            };

            anim.Tick += delegate { NextFrame(); };

            dragAnim.Interval = 16;
            dragAnim.Tick += delegate
            {
                if (!dragging) { tiltTarget = 0; stretchTarget = 1; }
                else if (!dragMoving) { tiltTarget *= 0.8; stretchTarget = 1 + (stretchTarget - 1) * 0.8; }
                dragMoving = false;
                double accel = (tiltTarget - tilt) * 0.28 - tiltVel * 0.42;
                tiltVel += accel;
                tilt += tiltVel;
                stretch += (stretchTarget - stretch) * 0.35;
                bool settled = !dragging && Math.Abs(tilt) < 0.08 && Math.Abs(tiltVel) < 0.08 && Math.Abs(stretch - 1) < 0.003;
                if (settled) { tilt = 0; tiltVel = 0; stretch = 1; dragAnim.Stop(); }
                if (dragTrace != null) DragTrace("tick dragging=" + dragging + " tilt=" + tilt.ToString("F1") + " target=" + tiltTarget.ToString("F1") + " stretch=" + stretch.ToString("F3") + (settled ? " settled" : ""));
                // The settle line is the last one a trace needs; flush after it, not before it.
                if (settled) DragTraceFlush();
                Render();
            };

            poll.Interval = 1200;
            poll.Tick += delegate { PumpAsync(); };
            poll.Start();
            // The sprite the plugin says this pet is wearing, fetched before the first poll: waiting
            // for the poll is the second reason for that flash.
            LoadSpriteAsync(Program.Get(opt, "sprite", ""), Program.GetInt(opt, "frames", 1),
                Program.GetInt(opt, "fps", 12), Program.Get(opt, "loop", "pingpong"));
            // The layered surface is pushed, never painted, so the first one is pushed on show.
            Shown += delegate
            {
                // Maintainer switch: `--demo-tilt 14` freezes the drag lean at that angle (with the
                // 1.06 stretch of a mid-drag) so the render path can be looked at without a mouse.
                int demoTilt = Program.GetInt(opt, "demo-tilt", 0);
                if (demoTilt != 0) { tilt = demoTilt; stretch = 1.06; }
                string traced = Program.Get(opt, "drag-log", "");
                if (traced.Length > 0) try { dragTrace = new StreamWriter(traced, false); } catch { dragTrace = null; }
                Render();
                PumpAsync();
                if (Program.GetInt(opt, "open-chat", 0) == 1)
                {
                    var opener = new System.Windows.Forms.Timer();
                    opener.Interval = 600;
                    opener.Tick += delegate { opener.Stop(); opener.Dispose(); if (!chat.Visible) ToggleChat(); };
                    opener.Start();
                }
            };
            Move += delegate
            {
                PlacePanel();
                PlaceHandle();
                if (chat.Visible) PlaceChat();
                if (bubble.Visible) PlaceBubble();
            };
            Resize += delegate { Render(); };
            FormClosed += delegate
            {
                tray.Visible = false;
                tray.Dispose();
                anim.Stop();
                dragAnim.Stop();
                if (dragTrace != null) { try { dragTrace.Dispose(); } catch { } dragTrace = null; }
                bubble.Dispose();
                chat.Dispose();
                foreach (var f in frames) f.Dispose();
                frames.Clear();
                DropScaledFrames();
                if (surface != null) { surface.Dispose(); surface = null; }
                try { mciSendString("close petaudio", null, 0, IntPtr.Zero); } catch { }
                CleanTempAudio();
            };
        }

        void OpenChat()
        {
            try { Process.Start(api.BaseUrl + "/dsh-desktop-pet/window?pet=" + Uri.EscapeDataString(api.PetId)); } catch { }
        }

        /// <summary>The pet's own settings live in the dsh page, under Settings.</summary>
        void OpenSettings()
        {
            try { Process.Start(api.BaseUrl + "/"); } catch { }
        }

        /// <summary>Click the pet and a one-line box opens under it; click again and it closes.</summary>
        Point PanelPoint()
        {
            // Diegetic: the board's lower edge overlaps the empty headroom of the sprite
            // canvas, so it reads as attached to the pet rather than floating in space.
            int px = Left + (Width - statusPanel.Width) / 2;
            int py = Top + (int)Math.Round(Height * 0.10) - statusPanel.Height;
            var area = Screen.FromControl(this).WorkingArea;
            px = Math.Max(area.Left, Math.Min(px, area.Right - statusPanel.Width));
            if (py < area.Top) py = Math.Min(Top + (int)Math.Round(Height * 0.80), area.Bottom - statusPanel.Height);
            return new Point(px, py);
        }

        void PlacePanel()
        {
            if (statusPanel != null && statusPanel.Visible) statusPanel.Location = PanelPoint();
        }

        Point HandlePoint()
        {
            return new Point(Left + Width - sizeHandle.Width * 2 / 3, Top + Height - sizeHandle.Height * 2 / 3);
        }

        void PlaceHandle()
        {
            if (sizeHandle != null && sizeHandle.Visible) sizeHandle.Location = HandlePoint();
        }

        void ToggleChat()
        {
            if (chat.Visible)
            {
                chat.Hide();
                if (statusPanel != null) statusPanel.Hide();
                if (sizeHandle != null) sizeHandle.Hide();
                return;
            }
            PlaceChat();
            chat.Show();
            chat.TopMost = true;
            chat.Focus();
            if (statusPanel != null) statusPanel.ShowAt(PanelPoint());
            if (sizeHandle != null) { sizeHandle.Location = HandlePoint(); sizeHandle.Show(); }
        }

        /// <summary>Send what was typed in the box. The reply arrives in the bubble.</summary>
        void SendText(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            var body = new Dictionary<string, object>();
            body["pet"] = api.PetId; body["text"] = text;
            ShowBubble("…");
            System.Threading.ThreadPool.QueueUserWorkItem(delegate
            {
                var reply = api.PostJson("/dsh-desktop-pet/say", body);
                string said = PetApi.Str(reply, "text");
                // The poll loop shows this line too; whichever arrives first wins, and the other is
                // the same sentence, so the owner never waits on the slower of the two.
                if (said.Length > 0) BeginInvoke((MethodInvoker)delegate { ShowBubble(said); });
            });
        }

        /// <summary>Poll on a worker thread: WebClient is synchronous and dsh may be restarting,
        /// and a 100-second stall on the UI thread would freeze the sprite completely.</summary>
        void PumpAsync()
        {
            if (polling) return;
            polling = true;
            System.Threading.ThreadPool.QueueUserWorkItem(delegate
            {
                Dictionary<string, object> state = null;
                try { state = api.GetJson("/dsh-desktop-pet/window-state?pet=" + Uri.EscapeDataString(api.PetId) + "&since=" + since); }
                catch { }
                try { BeginInvoke((MethodInvoker)delegate { Apply(state); }); } catch { }
                polling = false;
            });
        }

        /// <summary>Apply one polled state on the UI thread.</summary>
        void Apply(Dictionary<string, object> state)
        {
            if (state == null) return;
            object seq;
            if (state.TryGetValue("seq", out seq)) long.TryParse(seq.ToString(), out since);
            string expression = PetApi.Str(state, "expression");
            if (expression.Length > 0 && expression != spriteName)
            {
                LoadSpriteAsync(expression, PetApi.Int(state, "frames", 1), PetApi.Int(state, "fps", 12), PetApi.Str(state, "loop"));
            }
            string text = PetApi.Str(state, "text");
            // Every queued card is answered, not just the last one the merge kept.
            var cards = new List<string[]>();
            object rawItems;
            if (state.TryGetValue("items", out rawItems))
            {
                var items = rawItems as System.Collections.IEnumerable;
                if (items != null)
                {
                    foreach (var item in items)
                    {
                        var row = item as Dictionary<string, object>;
                        if (row == null) continue;
                        string id = PetApi.Str(row, "permission");
                        // `text` already opens with the effect sentence the plugin wrote.
                        if (id.Length > 0) cards.Add(new string[] { id, PetApi.Str(row, "text").Length > 0 ? PetApi.Str(row, "text") : PetApi.Str(row, "effect") });
                    }
                }
            }
            // Cards first, then whatever else came in the same drain: `since` has already moved
            // past these items, so anything skipped here would never be delivered.
            foreach (var card in cards) AskPermission(card[0], card[1]);
            if (text.Length > 0) ShowBubble(text);
            string audio = PetApi.Str(state, "audio");
            if (audio.Length > 0 && !muted) PlayAudio(audio);
            if (PetApi.Str(state, "stop") == "True" || PetApi.Str(state, "stop") == "true") Close();
        }

        /// <summary>The pet asked to see the screen or drive the mouse: the owner answers here.</summary>
        void AskPermission(string id, string detail)
        {
            // The dialog pumps messages, so the poll timer would raise the NEXT card on top of this
            // one — a stack of modals. Paused, the cards arrive one at a time.
            poll.Stop();
            DialogResult answer;
            try { answer = MessageBox.Show(this, detail + "\n\n是否允许?", Text + " · 权限请求", MessageBoxButtons.YesNo, MessageBoxIcon.Question); }
            finally { poll.Start(); }
            var body = new Dictionary<string, object>();
            body["id"] = id;
            body["allowed"] = answer == DialogResult.Yes;
            System.Threading.ThreadPool.QueueUserWorkItem(delegate { api.PostJson("/dsh-desktop-pet/permission", body); });
        }

        /// <summary>Fetch every drawing of a sprite and start playing them.</summary>
        void LoadSpriteAsync(string name, int count, int fps, string loop)
        {
            // `spriteName` is only written when the drawings actually land (below). Setting it here
            // opened a race that left the pet permanently invisible: the fetch can finish before the
            // window handle exists, the BeginInvoke throws and is swallowed — and every later poll
            // then sees "that sprite is already showing" and never retries. Until a load succeeds,
            // the polls keep calling this; `loadToken` makes the extra attempts harmless.
            int token = ++loadToken;
            int total = Math.Max(1, Math.Min(MaxFrames, count));
            int rate = Math.Max(1, Math.Min(30, fps));
            bool pingpong = loop != "forward";
            System.Threading.ThreadPool.QueueUserWorkItem(delegate
            {
                var loaded = new List<Image>();
                for (int n = 1; n <= total; n++)
                {
                    byte[] bytes = null;
                    try
                    {
                        bytes = api.GetBytes("/dsh-desktop-pet/sprite?pet=" + Uri.EscapeDataString(api.PetId)
                            + "&name=" + Uri.EscapeDataString(name) + "&frame=" + n);
                    }
                    catch { }
                    if (bytes == null || bytes.Length <= 8) break;   // a short run is played as far as it goes
                    try { loaded.Add(Image.FromStream(new MemoryStream(bytes))); } catch { break; }
                }
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        // A newer load started while this one was fetching: that one owns the sprite.
                        if (token != loadToken) { foreach (var f in loaded) f.Dispose(); return; }
                        triedSprite = true;
                        // Nothing arrived (art still in production, or a bad name): keep what is
                        // on screen. The placeholder blob is only for a pet with no art at all.
                        if (loaded.Count == 0 && frames.Count > 0) return;
                        spriteName = name;
                        var old = frames;      // the drawings are disposed, or every mood leaks a set
                        frames = loaded;
                        DropScaledFrames();
                        order = BuildOrder(loaded.Count, pingpong);
                        frameAt = 0;
                        anim.Stop();
                        if (loaded.Count > 1) { anim.Interval = Math.Max(33, 1000 / rate); anim.Start(); }
                        foreach (var f in old) f.Dispose();
                        Render();
                    });
                }
                catch { foreach (var f in loaded) f.Dispose(); }
            });
        }

        /// <summary>Forwards, then back again: a drawn run rarely ends where it began.</summary>
        static int[] BuildOrder(int count, bool pingpong)
        {
            if (count < 2) return new int[] { 0 };
            var list = new List<int>();
            for (int n = 0; n < count; n++) list.Add(n);
            if (pingpong) for (int n = count - 2; n > 0; n--) list.Add(n);
            return list.ToArray();
        }

        void NextFrame()
        {
            if (order.Length < 2) { anim.Stop(); return; }
            frameAt = (frameAt + 1) % order.Length;
            Render();
        }

        /// <summary>The plugin clamps a sprite to this many drawings; the host agrees with it.</summary>
        const int MaxFrames = 24;

        void ShowBubble(string text)
        {
            bubble.SetText(text);
            PlaceBubble();
            bubble.Show();
            bubble.TopMost = true;
            bubbleTimer.Stop();
            bubbleTimer.Start();
        }

        void PlaceBubble()
        {
            // The pet's own monitor, not "y >= 0": on a layout with a screen above the primary,
            // clamping to zero yanked the bubble onto the wrong monitor entirely.
            var screen = Screen.FromControl(this).WorkingArea;
            int x = Math.Min(Math.Max(screen.Left, Location.X + Width / 2 - bubble.Width / 2), screen.Right - bubble.Width);
            int y = Math.Max(screen.Top, Location.Y - bubble.Height - 6);
            bubble.Location = new Point(x, y);
        }

        /// <summary>The bottom-right corner, where a drag resizes instead of moving.</summary>
        int GripSize { get { return Math.Max(22, Math.Min(40, Width / 7)); } }
        bool InGrip(Point at)
        {
            return at.X >= Width - GripSize && at.Y >= Height - GripSize;
        }

        /// <summary>Three little bars in the corner, shown while the cursor is over them: a resize
        /// handle nobody can find is the same as no resize at all.</summary>
        void DrawGrip(Graphics g)
        {
            // The pad exists for HIT-TESTING, not for the eye: a layered window is click-through
            // wherever its alpha is 0, so the corner needs SOME alpha for the cursor to find it —
            // but alpha 1 of 255 is imperceptible on any wallpaper, where the old 14 read as a
            // grey square parked next to the pet. The visible affordance only appears on hover.
            int size = GripSize;
            using (var pad = new SolidBrush(Color.FromArgb(gripHot ? 46 : 1, 255, 255, 255)))
                g.FillRectangle(pad, Width - size, Height - size, size, size);
            if (!gripHot) return;
            int x = Width - size + 4, y = Height - size + 4;
            using (var pen = new Pen(Color.FromArgb(210, 255, 255, 255), 2f))
            using (var shadow = new Pen(Color.FromArgb(120, 0, 0, 0), 3.5f))
            {
                for (int i = 0; i < 3; i++)
                {
                    int offset = i * 6;
                    var from = new Point(x + size - 12 - offset, y + size - 8);
                    var to = new Point(x + size - 8, y + size - 12 - offset);
                    g.DrawLine(shadow, from, to);
                    g.DrawLine(pen, from, to);
                }
            }
        }

        /// <summary>Scale the window about its top-left corner, within sane bounds.</summary>
        void ScaleTo(Size from, double scale)
        {
            // Both sides clamped as a pair: clamping each independently flattened the aspect at
            // the top of the range, growing dead transparent space the grip then hid in.
            double ratio = from.Height / (double)Math.Max(1, from.Width);
            int w = (int)Math.Round(from.Width * scale);
            w = Math.Max(90, Math.Min(1400, w));
            int h = (int)Math.Round(w * ratio);
            if (h > 1400) { h = 1400; w = Math.Max(90, (int)Math.Round(h / Math.Max(0.05, ratio))); }
            if (h < 90) { h = 90; w = Math.Min(1400, (int)Math.Round(h / Math.Max(0.05, ratio))); }
            if (w == Width && h == Height) return;
            Size = new Size(w, h);          // the Resize handler renders once; a second here doubled it
            PlaceBubble();
            PlaceChat();
        }

        /// <summary>Tell dsh where the pet ended up and how big it is now.</summary>
        void RememberWindow()
        {
            var body = new Dictionary<string, object>();
            body["pet"] = api.PetId;
            body["x"] = Location.X; body["y"] = Location.Y;
            body["width"] = Width; body["height"] = Height;
            // Off the UI thread: WebClient is synchronous, and remembering the window is not worth
            // freezing the pet for however long dsh takes to answer.
            System.Threading.ThreadPool.QueueUserWorkItem(delegate { api.PostJson("/dsh-desktop-pet/window-position", body); });
        }

        void PlaceChat()
        {
            var screen = Screen.FromControl(this).WorkingArea;
            // At the feet, overlapping the sprite canvas's bottom margin: one tight column.
            int y = Location.Y + Height - (int)Math.Round(Height * 0.04);
            if (y + chat.Height > screen.Bottom) y = Math.Max(screen.Top, Location.Y - chat.Height - 4);
            int x = Math.Min(Math.Max(screen.Left, Location.X + Width / 2 - chat.Width / 2), screen.Right - chat.Width);
            chat.Location = new Point(x, y);
        }

        void PlayAudio(string url)
        {
            System.Threading.ThreadPool.QueueUserWorkItem(delegate
            {
                string file = null;
                try
                {
                    byte[] bytes = api.GetBytes(url);
                    if (bytes == null) return;
                    file = Path.Combine(Path.GetTempPath(), "dsh-pet-" + Guid.NewGuid().ToString("N") + ".mp3");
                    File.WriteAllBytes(file, bytes);
                    if (IsDisposed || Disposing) { try { File.Delete(file); } catch { } return; }
                    BeginInvoke((MethodInvoker)delegate
                    {
                        mciSendString("close petaudio", null, 0, IntPtr.Zero);
                        CleanTempAudio();          // the previous clip is no longer open: drop it
                        lastAudioFile = file;
                        mciSendString("open \"" + file + "\" type mpegvideo alias petaudio", null, 0, IntPtr.Zero);
                        mciSendString("play petaudio", null, 0, IntPtr.Zero);
                    });
                }
                catch { if (file != null) { try { File.Delete(file); } catch { } } }   // the form went away: do not leak the clip
            });
        }

        /// <summary>Delete the previous clip; %TEMP% must not fill up over a long session.</summary>
        void CleanTempAudio()
        {
            if (string.IsNullOrEmpty(lastAudioFile)) return;
            try { File.Delete(lastAudioFile); } catch { }
            lastAudioFile = null;
        }

        /// <summary>A layered window is painted by handing Windows a whole ARGB bitmap.</summary>
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= WsExLayered; return cp; }
        }

        /// <summary>Nothing paints through WM_PAINT here: the frame is pushed with the alpha below.</summary>
        protected override void OnPaintBackground(PaintEventArgs e) { }
        protected override void OnPaint(PaintEventArgs e) { }

        /// <summary>Draw the current frame into an ARGB bitmap and hand it to the window manager.</summary>
        void Render()
        {
            if (!IsHandleCreated || Width <= 0 || Height <= 0) return;
            // One surface, reused: a fresh bitmap twelve times a second is pure garbage collection.
            if (surface == null || surface.Width != Width || surface.Height != Height)
            {
                if (surface != null) surface.Dispose();
                surface = new Bitmap(Width, Height, PixelFormat.Format32bppArgb);
                // Same pin as the bubble's surface: the only text here is the placeholder label,
                // but a 96dpi label next to a scaled bubble reads as a glitch.
                try { using (var probe = Graphics.FromHwnd(IntPtr.Zero)) surface.SetResolution(probe.DpiX, probe.DpiY); } catch { }
            }
            using (var g = Graphics.FromImage(surface))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                DrawInto(g);
                DrawGrip(g);
            }
            PushLayered(surface, (byte)Math.Max(1, Math.Min(255, (int)Math.Round(opacity * 255))));
        }

        /// <summary>The frame scaled to (w, h), from the cache or scaled now — the one expensive
        /// resample, done once per frame per window size.</summary>
        Bitmap ScaledFrame(int index, Image image, int w, int h)
        {
            // Keyed on the window, not on the fitted (w, h): frames of unequal pixel size would
            // otherwise evict each other on every switch and the cache would silently stop caching.
            if (scaledFor != Size) { DropScaledFrames(); scaledFor = Size; }
            Bitmap scaled;
            if (scaledFrames.TryGetValue(index, out scaled)) return scaled;
            // Premultiplied on purpose: this bitmap is the source of the lean's bilinear rotation,
            // and a non-premultiplied source there lets the colour under a clear pixel bleed into
            // the resampled edge as a rim. PArgb is also what GDI+ composites without converting.
            scaled = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            using (var g = Graphics.FromImage(scaled))
            {
                g.CompositingMode = CompositingMode.SourceCopy;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.DrawImage(image, new Rectangle(0, 0, w, h), 0, 0, image.Width, image.Height, GraphicsUnit.Pixel);
            }
            scaledFrames[index] = scaled;
            return scaled;
        }

        void DropScaledFrames()
        {
            foreach (var b in scaledFrames.Values) b.Dispose();
            scaledFrames.Clear();
        }

        /// <summary>Maintainer trace (`--drag-log`): one open writer, flushed on release and when
        /// the spring settles — opening the file per line perturbed the timing being traced.</summary>
        void DragTrace(string line)
        {
            if (dragTrace == null) return;
            try { dragTrace.WriteLine(line); } catch { }
        }

        void DragTraceFlush()
        {
            if (dragTrace == null) return;
            try { dragTrace.Flush(); } catch { }
        }

        void DrawInto(Graphics g)
        {
            if (frames.Count > 0)
            {
                int at = order.Length > 0 ? order[Math.Min(frameAt, order.Length - 1)] : 0;
                int index = Math.Min(at, frames.Count - 1);
                var image = frames[index];
                // Fit, don't stretch: a frame run cropped to the character is rarely the shape of
                // the window, and stretching each frame differently is what makes a pet look cheap.
                double scale = Math.Min((double)Width / image.Width, (double)Height / image.Height);
                int w = Math.Max(1, (int)Math.Round(image.Width * scale));
                int h = Math.Max(1, (int)Math.Round(image.Height * scale));
                int x = (Width - w) / 2, y = (Height - h) / 2;
                var scaled = ScaledFrame(index, image, w, h);
                bool leaning = Math.Abs(tilt) > 0.05 || Math.Abs(stretch - 1) > 0.002;
                GraphicsState kept = g.Save();
                if (leaning)
                {
                    // Pivot just below the top of the drawing (where a hand would hold it). The shrink
                    // reduces how far the swung corners reach past the window; at full lean a wide
                    // character's foot can still clip a little, which reads as motion, not as a bug.
                    float px = Width / 2f, py = y + h * 0.12f;
                    double shrink = 1 - Math.Min(0.14, Math.Abs(tilt) / 16 * 0.14);
                    // Plain bilinear: GDI+'s HighQuality modes prefilter and cost ~13 ms on a 622²
                    // rotation, which is most of a 16 ms tick; at this near-1:1 scale they look the same.
                    g.InterpolationMode = InterpolationMode.Bilinear;
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.TranslateTransform(px, py);
                    g.RotateTransform((float)tilt);
                    g.ScaleTransform((float)shrink, (float)(shrink * stretch));
                    g.TranslateTransform(-px, -py);
                }
                else
                {
                    // A 1:1 blit of the cached scaling: exact pixels, nothing resampled.
                    g.InterpolationMode = InterpolationMode.NearestNeighbor;
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                }
                g.DrawImage(scaled, new Rectangle(x, y, w, h), 0, 0, w, h, GraphicsUnit.Pixel);
                g.Restore(kept);
                return;
            }
            // Nothing has come back yet: draw nothing. The window is layered, so "nothing" is really
            // nothing — no blue blob, no plate, just the desktop until the pet itself arrives.
            if (!triedSprite) return;
            // A load that came back empty: this pet has no artwork. Now the placeholder earns its
            // place, because otherwise there would be no window to drag.
            var body = new Rectangle(Width / 8, Height / 5, Width * 3 / 4, Height * 3 / 5);
            using (var fill = new LinearGradientBrush(body, Color.FromArgb(120, 170, 255), Color.FromArgb(70, 110, 220), 60f))
                g.FillEllipse(fill, body);
            using (var pen = new Pen(Color.FromArgb(40, 60, 120), 2)) g.DrawEllipse(pen, body);
            using (var eye = new SolidBrush(Color.White))
            {
                g.FillEllipse(eye, body.X + body.Width / 4, body.Y + body.Height / 3, body.Width / 6, body.Height / 6);
                g.FillEllipse(eye, body.X + body.Width * 7 / 12, body.Y + body.Height / 3, body.Width / 6, body.Height / 6);
            }
            using (var pupil = new SolidBrush(Color.FromArgb(20, 30, 60)))
            {
                g.FillEllipse(pupil, body.X + body.Width / 4 + body.Width / 24, body.Y + body.Height / 3 + body.Height / 24, body.Width / 12, body.Height / 12);
                g.FillEllipse(pupil, body.X + body.Width * 7 / 12 + body.Width / 24, body.Y + body.Height / 3 + body.Height / 24, body.Width / 12, body.Height / 12);
            }
            using (var font = new Font("Segoe UI", 8f))
            using (var brush = new SolidBrush(Color.FromArgb(230, 240, 255)))
                g.DrawString(spriteName.Length > 0 ? spriteName : "dsh", font, brush, body.X + body.Width / 3, body.Bottom + 4);
        }

        [DllImport("winmm.dll", CharSet = CharSet.Auto)]
        static extern int mciSendString(string command, StringBuilder buffer, int bufferSize, IntPtr callback);

        // ── the layered window ────────────────────────────────────────────────
        // A per-pixel-alpha window: Windows keeps the bitmap and composites it over whatever is
        // behind, so a cut-out drawing keeps its soft edge and its fully transparent parts are not
        // just invisible but click-through. The alternative — a colour key — leaves a rim of the key
        // colour wherever the drawing fades out, which is exactly the edge a chroma cut leaves.
        internal const int WsExLayered = 0x00080000;

        void PushLayered(Bitmap bitmap, byte alpha) { Layered.Push(Handle, Left, Top, bitmap, alpha); }
    }

    /// <summary>
    /// The speech bubble. It is a layered window that paints itself — the plaque (drawn art or a
    /// rounded plate) and then the text on top — so nothing of the window exists where the drawing
    /// is transparent. A Label on a plain form would have needed a rectangle of background colour
    /// behind it, which is the black box around the artwork.
    /// </summary>
    class BubbleForm : Form
    {
        readonly Theme theme;
        readonly Font font;
        string text = "";
        Bitmap surface;

        readonly float dpi;
        readonly StringFormat textFormat = new StringFormat(StringFormatFlags.LineLimit) { Trimming = StringTrimming.Word };

        public BubbleForm(Theme theme, float dpiScale)
        {
            this.theme = theme;
            // The surface is a plain bitmap, which GDI+ treats as 96dpi: on a scaled monitor a
            // point-sized font comes out physically half size, so the scale is applied by hand.
            dpi = dpiScale;
            // The font stays in points; the SURFACE carries the scale (SetResolution in Render).
            // Scaling the point size by hand depended on what DPI GDI+ gives a fresh bitmap —
            // guessed wrong one way the balloon doubles in height, the other way LineLimit drops
            // the sentence's tail with no ellipsis.
            font = new Font("Microsoft YaHei UI", theme.FontSize);
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Width = (int)Math.Round(300 * dpiScale);
            Height = (int)Math.Round(96 * dpiScale);
        }

        /// <summary>Form.Dispose does not raise FormClosed, and the plugin path disposes.</summary>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (surface != null) { surface.Dispose(); surface = null; }
                font.Dispose();
                textFormat.Dispose();
            }
            base.Dispose(disposing);
        }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= PetForm.WsExLayered; return cp; }
        }

        protected override bool ShowWithoutActivation { get { return true; } }
        protected override void OnPaintBackground(PaintEventArgs e) { }
        protected override void OnPaint(PaintEventArgs e) { }

        /// <summary>How wide the text may run before it wraps, in this window's own pixels.</summary>
        int TextWidth { get { return Width - Scaled(theme.Drawn ? 64 : 34); } }
        int Scaled(int px) { return (int)Math.Round(px * dpi); }

        public void SetText(string value)
        {
            text = value.Length > 400 ? value.Substring(0, 400) + "…" : value;
            // Measured with the same renderer and format that draw it: mixing TextRenderer's
            // measurement with a different draw call is how the last line used to clip.
            // Measured on a surface built exactly like the one that draws — same pixel format,
            // same resolution — so the two cannot drift apart on a scaled monitor.
            SizeF measured;
            using (var probeBmp = new Bitmap(1, 1, PixelFormat.Format32bppArgb))
            {
                probeBmp.SetResolution(96f * dpi, 96f * dpi);
                using (var probe = Graphics.FromImage(probeBmp))
                {
                    probe.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                    measured = probe.MeasureString(text, font, TextWidth, textFormat);
                }
            }
            int pad = Scaled(theme.Drawn ? 60 : 30);
            Height = Math.Max(Scaled(theme.Drawn ? 92 : 54), (int)Math.Ceiling(measured.Height) + pad);
            Render();
        }

        /// <summary>Paint the whole window into one ARGB bitmap and hand it to Windows.</summary>
        public void Render()
        {
            if (!IsHandleCreated || Width <= 0 || Height <= 0) return;
            if (surface == null || surface.Width != Width || surface.Height != Height)
            {
                if (surface != null) surface.Dispose();
                surface = new Bitmap(Width, Height, PixelFormat.Format32bppArgb);
                surface.SetResolution(96f * dpi, 96f * dpi);
            }
            using (var g = Graphics.FromImage(surface))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                // GDI+ and anti-aliased, never GDI/ClearType: GDI writes RGB and zeroes the alpha
                // of every pixel it touches, and on a layered surface those pixels become holes —
                // the desktop shows through the letters. (GDI+ refuses ClearType on alpha anyway.)
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                var whole = new Rectangle(0, 0, Width, Height);
                if (theme.Drawn)
                {
                    int plateAlpha = (int)Math.Round(Math.Min(1, theme.Opacity + 0.14) * 255);
                    using (var glass = new SolidBrush(Color.FromArgb(plateAlpha, theme.Bg)))
                    using (var plate = theme.RoundedPath(Width - Scaled(10), Height - Scaled(10)))
                    {
                        g.TranslateTransform(Scaled(5), Scaled(5));
                        g.FillPath(glass, plate);
                        g.ResetTransform();
                    }
                    theme.DrawNineSlice(g, theme.BubbleArt, whole);
                }
                else
                {
                    // No artwork: a plate in the pet's own colour, at the pet's own opacity — which
                    // is the only place the owner's translucency applies to a bubble.
                    var card = new Rectangle(Scaled(2), Scaled(2), Width - Scaled(4), Height - Scaled(4));
                    using (var fill = new SolidBrush(Color.FromArgb(238, 11, 13, 16))) g.FillRectangle(fill, card);
                    using (var sheen = new LinearGradientBrush(new Rectangle(card.Left - 1, card.Top - 1, card.Width + 2, Scaled(26)), Color.FromArgb(10, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), LinearGradientMode.Vertical))
                        g.FillRectangle(sheen, card.Left, card.Top + Scaled(2), card.Width, Scaled(24));
                    using (var edge = new Pen(Color.FromArgb(255, 0, 0, 0))) g.DrawRectangle(edge, card.Left, card.Top, card.Width - 1, card.Height - 1);
                    using (var strip = new SolidBrush(theme.Accent)) g.FillRectangle(strip, card.Left, card.Top, card.Width, Scaled(2));
                    using (var stripGlow = new GraphicsPath())
                    {
                        stripGlow.AddRectangle(new Rectangle(card.Left, card.Top, card.Width, Scaled(2)));
                        Holo.BloomPath(g, stripGlow, theme.Accent, 55, 2f * dpi, Width, Height);
                    }
                }
                int inset = Scaled(theme.Drawn ? 32 : 17);
                var box = new RectangleF(inset, inset - Scaled(4), Math.Max(10, TextWidth), Math.Max(10, Height - 2 * inset + Scaled(8)));
                using (var shadowInk = new SolidBrush(Color.FromArgb(84, 0, 0, 0)))
                {
                    var shifted = box; shifted.Offset(1, 1);
                    g.DrawString(text, font, shadowInk, shifted, textFormat);
                }
                using (var ink = new SolidBrush(Color.FromArgb(235, 244, 255, 255))) g.DrawString(text, font, ink, box, textFormat);
            }
            Layered.Push(Handle, Left, Top, surface, 255);
        }

        protected override void OnShown(EventArgs e) { base.OnShown(e); Render(); }
    }

    /// <summary>The box that opens under the pet when it is clicked: type, Enter, done.</summary>
    class ChatForm : Form
    {
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr hWnd, int msg, IntPtr wParam, string lParam);
        const int EM_SETCUEBANNER = 0x1501;
        readonly TextBox box = new TextBox();
        readonly Action<string> onSend;
        readonly Theme theme;
        Form fieldHost;
        Bitmap surface;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= PetForm.WsExLayered;
                return cp;
            }
        }

        static Color Lighten(Color c, int by)
        {
            return Color.FromArgb(Math.Min(255, c.R + by), Math.Min(255, c.G + by), Math.Min(255, c.B + by));
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            // Both skins paint through Layered.Push in RenderSurface(); WM_PAINT has nothing to do.
        }

        readonly float dpi;
        int S(int px) { return (int)Math.Round(px * dpi); }

        public ChatForm(Action<string> onSend, Theme theme, float dpiScale)
        {
            dpi = dpiScale;
            this.onSend = onSend;
            this.theme = theme;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = theme.Bg;
            DoubleBuffered = true;
            // The box you type into is opaque, full stop. A translucent field puts the wallpaper
            // behind the caret and the text, which is exactly where it must not be.
            Opacity = 1;
            Padding = new Padding(1);
            Width = S(320);
            Height = S(44);
            box.BorderStyle = BorderStyle.None;
            box.BackColor = Lighten(theme.Bg, 10);
            box.ForeColor = theme.Text;
            box.Font = new Font("Microsoft YaHei UI", theme.FontSize);
            {
                fieldHost = new Form();
                fieldHost.FormBorderStyle = FormBorderStyle.None;
                fieldHost.ShowInTaskbar = false;
                fieldHost.TopMost = true;
                fieldHost.StartPosition = FormStartPosition.Manual;
                fieldHost.BackColor = Color.FromArgb(6, 7, 9);
                fieldHost.Width = Width - S(94);
                fieldHost.Height = S(28);
                using (var fp = PetMenuRenderer.RoundedRect(new Rectangle(0, 0, fieldHost.Width, fieldHost.Height), S(2)))
                    fieldHost.Region = new Region(fp);
                fieldHost.Paint += delegate(object ps, PaintEventArgs pe)
                {
                    using (var border = new Pen(Color.FromArgb(27, 32, 41)))
                        pe.Graphics.DrawRectangle(border, 0, 0, fieldHost.Width - 1, fieldHost.Height - 1);
                };
                box.SetBounds(S(8), S(5), fieldHost.Width - S(16), S(19));
                box.BackColor = fieldHost.BackColor;
                fieldHost.Controls.Add(box);
            }
            SendMessageW(box.Handle, EM_SETCUEBANNER, (IntPtr)1, "输入消息…");
            box.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Fire(); }
                else if (e.KeyCode == Keys.Escape) { e.SuppressKeyPress = true; Hide(); }
            };
            Shown += delegate { SyncField(); RenderSurface(); Focus(); };
        }

        Rectangle KeyRect
        {
            get
            {
                return theme.Drawn
                    ? new Rectangle(Width - S(74), S(4), S(68), Height - S(8))
                    : new Rectangle(Width - S(74), S(8), S(64), S(28));
            }
        }

        void SyncField()
        {
            if (fieldHost == null) return;
            fieldHost.Location = new Point(Left + S(10), Top + S(8));
            if (fieldHost.Visible != Visible) fieldHost.Visible = Visible;
            if (Visible) fieldHost.TopMost = true;
        }

        /// <summary>The whole composer as one ARGB surface: art frames it or the capsule is drawn.</summary>
        void RenderSurface()
        {
            if (!IsHandleCreated || Width <= 0 || Height <= 0) return;
            if (surface == null || surface.Width != Width || surface.Height != Height)
            {
                if (surface != null) surface.Dispose();
                surface = new Bitmap(Width, Height, PixelFormat.Format32bppArgb);
                surface.SetResolution(96f * dpi, 96f * dpi);
            }
            using (var g = Graphics.FromImage(surface))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                if (theme.Drawn)
                {
                    using (var glass = new SolidBrush(Color.FromArgb(215, theme.Bg)))
                    {
                        using (var plate = theme.RoundedPath(Width - S(78) - S(8), Height - S(8)))
                        {
                            g.TranslateTransform(S(4), S(4));
                            g.FillPath(glass, plate);
                            g.ResetTransform();
                        }
                        using (var plate = theme.RoundedPath(S(60), Height - S(16)))
                        {
                            g.TranslateTransform(Width - S(70), S(8));
                            g.FillPath(glass, plate);
                            g.ResetTransform();
                        }
                    }
                    theme.DrawNineSlice(g, theme.InputArt, new Rectangle(0, 0, Width - S(78), Height));
                    theme.DrawNineSlice(g, theme.ButtonArt, KeyRect);
                    using (var ink = new SolidBrush(theme.Text))
                    using (var label = new Font("Microsoft YaHei UI", theme.FontSize))
                    using (var centred = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                        g.DrawString("发送", label, ink, KeyRect, centred);
                }
                else
                {
                    // The menu language: a solid near-black bar with the accent strip on top,
                    // and the send key as the game's inverted orange block — dark bold text.
                    var warm = Color.FromArgb(244, 255, 255);
                    var bar = new Rectangle(S(2), S(2), Width - S(4), Height - S(4));
                    using (var card = new SolidBrush(Color.FromArgb(244, 11, 13, 16))) g.FillRectangle(card, bar);
                    using (var sheen = new LinearGradientBrush(new Rectangle(bar.Left - 1, bar.Top - 1, bar.Width + 2, S(16)), Color.FromArgb(10, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), LinearGradientMode.Vertical))
                        g.FillRectangle(sheen, bar.Left, bar.Top + S(2), bar.Width, S(14));
                    using (var edge = new Pen(Color.FromArgb(255, 0, 0, 0))) g.DrawRectangle(edge, bar.Left, bar.Top, bar.Width - 1, bar.Height - 1);
                    using (var strip = new SolidBrush(theme.Accent)) g.FillRectangle(strip, bar.Left, bar.Top, bar.Width, S(2));
                    using (var stripGlow = new GraphicsPath())
                    {
                        stripGlow.AddRectangle(new Rectangle(bar.Left, bar.Top, bar.Width, S(2)));
                        Holo.BloomPath(g, stripGlow, theme.Accent, 60, 2f * dpi, Width, Height);
                    }
                    var kr = KeyRect;
                    using (var keyFill = new SolidBrush(theme.Accent)) g.FillRectangle(keyFill, kr);
                    using (var keyGlow = new GraphicsPath())
                    {
                        keyGlow.AddRectangle(kr);
                        Holo.BloomPath(g, keyGlow, theme.Accent, 70, 1.6f * dpi, Width, Height);
                    }
                    using (var label = new Font("Microsoft YaHei UI", theme.FontSize, FontStyle.Bold))
                    using (var centred = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                    using (var ink = new SolidBrush(Color.FromArgb(235, 10, 12, 15)))
                        g.DrawString("发送", label, ink, kr, centred);
                }
            }
            Layered.Push(Handle, Left, Top, surface, 255);
        }

        protected override void OnMove(EventArgs e)
        {
            base.OnMove(e);
            SyncField();
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            SyncField();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            // Alpha-0 pixels never receive clicks on a layered window, so anything landing
            // here hit visible chrome: the key fires, the capsule hands focus to the field.
            if (KeyRect.Contains(e.Location)) Fire();
            else Focus();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (surface != null) { surface.Dispose(); surface = null; }
                if (fieldHost != null) { fieldHost.Dispose(); fieldHost = null; }
            }
            base.Dispose(disposing);
        }

        void Fire()
        {
            string text = box.Text.Trim();
            if (text.Length == 0) return;
            box.Text = "";
            Hide();
            onSend(text);
        }

        public new void Focus()
        {
            if (fieldHost != null && fieldHost.Visible) fieldHost.Activate();
            box.Focus();
        }
    }

    /// <summary>
    /// The on-demand resize knob: a frosted circle at the pet's bottom-right corner.
    /// Dragging it resizes the pet, exactly like the old invisible corner grip.
    /// </summary>
    class SizeHandle : Form
    {
        readonly Theme t;
        readonly float dpi;
        readonly Action onBegin;
        readonly Action<int> onDelta;
        readonly Action onEnd;
        bool down;
        Point pressAtScreen;

        int S(int px) { return (int)Math.Round(px * dpi); }

        public SizeHandle(Theme t, float dpiScale, Action onBegin, Action<int> onDelta, Action onEnd)
        {
            this.t = t; this.dpi = dpiScale; this.onBegin = onBegin; this.onDelta = onDelta; this.onEnd = onEnd;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            DoubleBuffered = true;
            Opacity = 0.94;
            BackColor = t.Bg;
            Width = S(32);
            Height = S(32);
            using (var p = PetMenuRenderer.RoundedRect(new Rectangle(0, 0, Width, Height), S(3)))
                Region = new Region(p);
            Cursor = Cursors.SizeNWSE;
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var card = new SolidBrush(Color.FromArgb(236, 10, 12, 15))) g.FillRectangle(card, 0, 0, Width, Height);
            using (var strip = new SolidBrush(t.Accent)) g.FillRectangle(strip, 0, 0, Width, S(3));
            using (var stripGlow = new GraphicsPath())
            {
                stripGlow.AddRectangle(new Rectangle(0, S(1), Width, S(2)));
                Holo.BloomPath(g, stripGlow, t.Accent, 60, 1.8f * dpi, Width, Height);
            }
            // The diagonal double arrow, drawn so no glyph font is trusted.
            using (var pen = new Pen(Color.FromArgb(235, 244, 255, 255), Math.Max(1.6f, 1.6f * dpi)))
            {
                pen.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                pen.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                int a = S(11), b = Width - S(11);
                g.DrawLine(pen, a, a, b, b);
                g.DrawLine(pen, a, a, a + S(6), a);
                g.DrawLine(pen, a, a, a, a + S(6));
                g.DrawLine(pen, b, b, b - S(6), b);
                g.DrawLine(pen, b, b, b, b - S(6));
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            down = true;
            pressAtScreen = Cursor.Position;
            Capture = true;
            if (onBegin != null) onBegin();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (!down) return;
            int dx = Cursor.Position.X - pressAtScreen.X;
            if (onDelta != null) onDelta(dx);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!down) return;
            down = false;
            Capture = false;
            if (onEnd != null) onEnd();
        }
    }

    /// <summary>
    /// The frosted board above the pet's head: every live dsh session with its running state,
    /// plus the size row (smaller / reset / larger). Translucent glass, refreshed while shown.
    /// </summary>
    class StatusPanel : Form
    {
        readonly PetApi api;
        readonly Theme t;
        readonly float dpi;
        readonly System.Windows.Forms.Timer tick = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer reveal = new System.Windows.Forms.Timer();
        readonly List<KeyValuePair<string, bool>> rows = new List<KeyValuePair<string, bool>>();
        readonly Font rowFont;
        readonly Font rowBoldFont;
        readonly Font headFont;
        readonly Font bigFont;
        readonly Font statusFont;
        const int REVEAL_STEPS = 10;
        int revealStep = REVEAL_STEPS;

        /// <summary>Style-guide text: the .88 main layer over a .33 dark shadow layer.</summary>
        void DrawLayered(Graphics g, string text, Font font, Color main, float x, float y, int alpha)
        {
            using (var shadow = new SolidBrush(Color.FromArgb(84 * alpha / 255, 0, 0, 0))) g.DrawString(text, font, shadow, x + 1, y + 1);
            using (var ink = new SolidBrush(Color.FromArgb(Math.Min(224, alpha), main))) g.DrawString(text, font, ink, x, y);
        }

        int S(int px) { return (int)Math.Round(px * dpi); }

        public StatusPanel(PetApi api, Theme t, float dpiScale)
        {
            this.api = api; this.t = t; this.dpi = dpiScale;
            rowFont = new Font("Segoe UI", 9.5f);
            rowBoldFont = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            headFont = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            bigFont = new Font("Segoe UI", 17f, FontStyle.Bold);
            statusFont = new Font("Segoe UI", 7.5f);
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            DoubleBuffered = true;
            Opacity = 0.94;
            BackColor = Color.FromArgb(10, 12, 15);
            Width = S(320);
            Height = S(220);
            using (var p = PetMenuRenderer.RoundedRect(new Rectangle(0, 0, Width, Height), S(3))) Region = new Region(p);
            tick.Interval = 2000;
            tick.Tick += delegate { RefreshRows(); };
            reveal.Interval = 28;
            reveal.Tick += delegate
            {
                revealStep = Math.Min(revealStep + 1, REVEAL_STEPS);
                if (revealStep >= REVEAL_STEPS) reveal.Stop();
                Invalidate();
            };
            VisibleChanged += delegate
            {
                if (Visible) { revealStep = 0; reveal.Start(); tick.Start(); RefreshRows(); }
                else { tick.Stop(); reveal.Stop(); }
            };
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        public void ShowAt(Point at)
        {
            Location = at;
            Show();
            Acrylic.Enable(Handle, unchecked((int)0xCC16110E));
        }

        void RefreshRows()
        {
            System.Threading.ThreadPool.QueueUserWorkItem(delegate
            {
                var reply = api.GetJson("/dsh-desktop-pet/board?pet=" + Uri.EscapeDataString(api.PetId));
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        rows.Clear();
                        object listObj;
                        if (reply != null && reply.TryGetValue("rows", out listObj) && listObj is System.Collections.ArrayList)
                        {
                            foreach (object item in (System.Collections.ArrayList)listObj)
                            {
                                var d = item as Dictionary<string, object>;
                                if (d == null) continue;
                                string title = PetApi.Str(d, "title");
                                bool running = PetApi.Str(d, "status") == "running";
                                rows.Add(new KeyValuePair<string, bool>(title, running));
                            }
                        }
                        int wanted = S(58) + Math.Max(1, rows.Count) * S(30) + S(8);
                        if (Height != wanted)
                        {
                            Height = wanted;
                            using (var p = PetMenuRenderer.RoundedRect(new Rectangle(0, 0, Width, Height), S(3))) Region = new Region(p);
                        }
                        Invalidate();
                    });
                }
                catch { /* closing */ }
            });
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            var ink2 = Color.FromArgb(244, 255, 255);
            var dim2 = Color.FromArgb(139, 149, 165);
            var rowInk = Color.FromArgb(199, 204, 214);
            var green = Color.FromArgb(140, 200, 60);
            var lineC = Color.FromArgb(27, 32, 41);
            float k = (float)revealStep / REVEAL_STEPS;
            int a = (int)(255 * k);
            int rowAlpha = (int)(255 * Math.Max(0f, (k - 0.3f) / 0.7f));
            int running = 0;
            foreach (var row in rows) if (row.Value) running++;

            // Card: near-black plate, top-light sheen, 1px black edge, orange strip + bleed.
            using (var card = new SolidBrush(Color.FromArgb(Math.Min(240, a), 11, 13, 16)))
                g.FillRectangle(card, 0, 0, Width, Height);
            using (var sheen = new LinearGradientBrush(new Rectangle(-1, -1, Width + 2, S(56)), Color.FromArgb(9 * a / 255, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), LinearGradientMode.Vertical))
                g.FillRectangle(sheen, 0, S(2), Width, S(54));
            using (var edge = new Pen(Color.FromArgb(a, 0, 0, 0))) g.DrawRectangle(edge, 0, 0, Width - 1, Height - 1);
            using (var strip = new SolidBrush(Color.FromArgb(a, t.Accent)))
                g.FillRectangle(strip, 0, 0, (int)(Width * Math.Min(1f, k * 1.5f)), S(2));
            using (var stripGlow = new GraphicsPath())
            {
                stripGlow.AddRectangle(new Rectangle(0, 0, Width, S(2)));
                Holo.BloomPath(g, stripGlow, t.Accent, 55 * a / 255, 2f * dpi, Width, Height);
            }

            // Header row: spaced label left, dim system tag right.
            using (var label = new SolidBrush(Color.FromArgb(a, dim2)))
                g.DrawString("任  务  看  板", headFont, label, S(15), S(10));
            using (var sys = new SolidBrush(Color.FromArgb(a, 61, 70, 84)))
            using (var right = new StringFormat { Alignment = StringAlignment.Far })
                g.DrawString("SHD · " + rows.Count.ToString("00"), statusFont, sys, new RectangleF(0, S(12), Width - S(16), S(12)), right);

            // The stat: one dominant numeral, its label at the baseline.
            using (var big = new SolidBrush(Color.FromArgb(a, ink2)))
                g.DrawString(running.ToString(), bigFont, big, S(13), S(24));
            using (var statLabel = new SolidBrush(Color.FromArgb(a, dim2)))
                g.DrawString("进行中 / " + rows.Count + " 项", statusFont, statLabel, S(13) + S(22) + running.ToString().Length * S(12), S(38));
            using (var divider = new Pen(Color.FromArgb(a, lineC)))
                g.DrawLine(divider, 0, S(54), Width, S(54));

            int y = S(58);
            if (rowAlpha > 8)
            {
                if (rows.Count == 0)
                {
                    using (var dim = new SolidBrush(Color.FromArgb(rowAlpha, dim2)))
                        g.DrawString("暂无项目", rowFont, dim, S(16), y + S(6));
                    y += S(30);
                }
                foreach (var row in rows)
                {
                    if (row.Value)
                        using (var bar = new SolidBrush(Color.FromArgb(rowAlpha, t.Accent)))
                            g.FillRectangle(bar, S(15), y + S(8), S(3), S(14));
                    using (var titleInk = new SolidBrush(Color.FromArgb(rowAlpha, row.Value ? ink2 : rowInk)))
                        g.DrawString(row.Key, row.Value ? rowBoldFont : rowFont, titleInk, S(26), y + S(6));
                    using (var st = new SolidBrush(Color.FromArgb(row.Value ? rowAlpha : rowAlpha * 7 / 10, row.Value ? green : dim2)))
                    using (var right = new StringFormat { Alignment = StringAlignment.Far })
                        g.DrawString(row.Value ? "进行中" : "已完成", statusFont, st, new RectangleF(0, y + S(9), Width - S(16), S(12)), right);
                    y += S(30);
                }
            }
        }

        void DrawKey(Graphics g, Rectangle rc, string label)
        {
            using (var path = PetMenuRenderer.RoundedRect(rc, S(10)))
            {
                using (var fill = new SolidBrush(Color.FromArgb(46, t.Accent))) g.FillPath(fill, path);
                using (var rim = new Pen(Color.FromArgb(150, t.Accent))) g.DrawPath(rim, path);
            }
            using (var ink = new SolidBrush(t.Text))
            using (var centred = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                g.DrawString(label, rowFont, ink, rc, centred);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { tick.Dispose(); rowFont.Dispose(); rowBoldFont.Dispose(); headFont.Dispose(); bigFont.Dispose(); statusFont.Dispose(); }
            base.Dispose(disposing);
        }
    }

    /// <summary>Variant B: the pet page in an Edge app window, styled frameless and on top.</summary>
    class WebViewHost
    {
        readonly Dictionary<string, string> opt;
        public WebViewHost(Dictionary<string, string> opt) { this.opt = opt; }

        public void Run()
        {
            string url = "http://127.0.0.1:" + Program.GetInt(opt, "port", 3080)
                + "/dsh-desktop-pet/window?pet=" + Uri.EscapeDataString(Program.Get(opt, "pet", "pet-1")) + "&chrome=app";
            int width = Program.GetInt(opt, "width", 380);
            int height = Program.GetInt(opt, "height", 520);
            int x = Program.GetInt(opt, "x", -1);
            int y = Program.GetInt(opt, "y", -1);
            var screen = Screen.PrimaryScreen.WorkingArea;
            if (x < 0) x = screen.Right - width - 40;
            if (y < 0) y = screen.Bottom - height - 60;
            string profile = Path.Combine(Path.GetTempPath(), "dsh-pet-edge");
            string exe = FindEdge();
            if (exe == null)
            {
                MessageBox.Show("未找到 Microsoft Edge,无法启动「桌面网页窗(Edge 应用窗口)」形态。请改用「桌面精灵(WinForms)」形态。", "dsh 桌宠");
                return;
            }
            var psi = new ProcessStartInfo(exe,
                "--app=" + url
                + " --window-size=" + width + "," + height
                + " --window-position=" + x + "," + y
                + " --user-data-dir=\"" + profile + "\""
                + " --no-first-run --disable-features=Translate,msEdgeSplitScreen");
            psi.UseShellExecute = false;
            var process = Process.Start(psi);
            if (process == null) return;
            // Edge relays the launch to its browser process, so the handle we started may be gone
            // in a moment: the window is found by the title the pet page sets ("<name> · dsh"), and
            // everything after this point works on that window, not on the process.
            var deadline = DateTime.UtcNow.AddSeconds(20);
            IntPtr handle = IntPtr.Zero;
            // The page titles itself "<pet name> · dsh": match that exact suffix, never a bare
            // fragment, or an unrelated browser window whose title happens to contain the pet's name
            // would be stripped of its frame and pinned on top.
            string name = Program.Get(opt, "title", "").Trim();
            string wanted = (name.Length > 0 ? name : "桌宠") + " · dsh";
            while (DateTime.UtcNow < deadline && handle == IntPtr.Zero)
            {
                System.Threading.Thread.Sleep(400);
                handle = FindWindowByTitleFragment(wanted);
            }
            if (handle != IntPtr.Zero && Program.Get(opt, "frameless", "1") != "0")
            {
                try
                {
                    int style = GetWindowLong(handle, GWL_STYLE);
                    SetWindowLong(handle, GWL_STYLE, (style & ~WS_CAPTION & ~WS_THICKFRAME) | WS_POPUP);
                    if (Program.Get(opt, "top", "1") != "0")
                        SetWindowPos(handle, HWND_TOPMOST, x, y, width, height, SWP_FRAMECHANGED | SWP_SHOWWINDOW);
                    else
                        SetWindowPos(handle, IntPtr.Zero, x, y, width, height, SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOZORDER);
                }
                catch { /* styling is a nicety: the window works with its normal frame */ }
            }
            // The host keeps polling so that "关闭" in dsh closes the Edge window too: a killed host
            // process could not clean up its child, so the stop signal is read here instead.
            var api = new PetApi("http://127.0.0.1:" + Program.GetInt(opt, "port", 3080), Program.Get(opt, "pet", "pet-1"), Program.Get(opt, "token", ""));
            long since = 0;
            if (handle == IntPtr.Zero)
            {
                // Edge relayed the launch and no window of ours appeared: say so instead of exiting
                // silently, and leave the browser window (if any) under the user's own control.
                MessageBox.Show("未找到桌宠的网页窗口(Edge 可能被安全软件或策略阻止启动)。请改用「桌面精灵(WinForms)」形态。", "dsh 桌宠");
                return;
            }
            while (IsWindow(handle))
            {
                System.Threading.Thread.Sleep(1500);
                var state = api.GetJson("/dsh-desktop-pet/window-state?pet=" + Uri.EscapeDataString(api.PetId) + "&since=" + since);
                if (state == null) continue;
                object seq;
                if (state.TryGetValue("seq", out seq)) long.TryParse(seq.ToString(), out since);
                string stop = PetApi.Str(state, "stop");
                if (stop == "True" || stop == "true")
                {
                    PostMessage(handle, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                    break;
                }
            }
        }

        static string FindEdge()
        {
            string[] candidates =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
            };
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        static IntPtr FindWindowByTitleFragment(string fragment)
        {
            IntPtr found = IntPtr.Zero;
            EnumWindows(delegate(IntPtr handle, IntPtr param)
            {
                if (!IsWindowVisible(handle)) return true;
                var sb = new StringBuilder(300);
                GetWindowText(handle, sb, sb.Capacity);
                string title = sb.ToString();
                // Equality, not a substring: another browser window showing the same page (the
                // right-click "open chat" entry) must not be restyled and pinned on top.
                if (string.Equals(title, fragment, StringComparison.OrdinalIgnoreCase))
                {
                    var cls = new StringBuilder(120);
                    GetClassName(handle, cls, cls.Capacity);
                    if (cls.ToString().IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) >= 0) { found = handle; return false; }
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        const int GWL_STYLE = -16;
        const int WS_CAPTION = 0x00C00000;
        const int WS_THICKFRAME = 0x00040000;
        const int WS_POPUP = unchecked((int)0x80000000);
        const uint SWP_FRAMECHANGED = 0x0020;
        const uint SWP_SHOWWINDOW = 0x0040;
        const uint SWP_NOZORDER = 0x0004;
        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

        delegate bool EnumWindowsProc(IntPtr handle, IntPtr param);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr handle, StringBuilder text, int count);
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr handle, int index);
        [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr handle, int index, int value);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle, uint message, IntPtr w, IntPtr l);
        const uint WM_CLOSE = 0x0010;
    }
}
