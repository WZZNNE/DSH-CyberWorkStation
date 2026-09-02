// DSH Launcher bootstrap shell: double-click → start the Node server in the background
// (hidden window) → wait for the port → open the workbench in a browser --app window
// (no address bar / tabs, native-application feel).
// Build: csc /target:winexe /win32icon:dsh.ico /out:<launcher exe name from setup.cmd> launcher-shell.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

static class DshLauncherShell {
    const int Port = 3090;
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;

    static bool PortUp() {
        try { using (var c = new TcpClient()) { var r = c.BeginConnect("127.0.0.1", Port, null, null); if (!r.AsyncWaitHandle.WaitOne(700)) return false; c.EndConnect(r); return true; } }
        catch { return false; }
    }

    static string FindBrowser() {
        string[] candidates = {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) + @"\Microsoft\Edge\Application\msedge.exe",
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) + @"\Microsoft\Edge\Application\msedge.exe",
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) + @"\Google\Chrome\Application\chrome.exe",
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) + @"\Google\Chrome\Application\chrome.exe",
        };
        foreach (var p in candidates) if (File.Exists(p)) return p;
        return null;
    }

    [STAThread]
    static void Main() {
        if (!PortUp()) {
            var psi = new ProcessStartInfo {
                FileName = "node",
                Arguments = "\"" + Path.Combine(Root, "server.mjs") + "\"",
                WorkingDirectory = Root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            try { Process.Start(psi); }
            catch (Exception e) { MessageBox.Show("启动 node 失败(需安装 Node.js 并在 PATH):\n" + e.Message, "DSH Launcher"); return; }
            for (int i = 0; i < 120 && !PortUp(); i++) Thread.Sleep(500);
            if (!PortUp()) { MessageBox.Show("服务 60 秒内未就绪,查看 .local/logs/ 目录。", "DSH Launcher"); return; }
        }
        // The API token is minted when the server owns the port and written to ~/.dsh. It travels
        // as a `?t=` query — only to the loopback server that minted it, and the page scrubs it
        // from the address bar immediately. A `#t=` fragment would be cleaner still, but Edge's
        // `--app=` handoff to an already-running browser drops fragments, which opened dead pages.
        string tokenFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh", "launcher.token");
        string token = "";
        for (int i = 0; i < 60 && token.Length == 0; i++) {
            try { token = File.ReadAllText(tokenFile).Trim(); } catch { }
            if (token.Length == 0) Thread.Sleep(500);
        }
        string url = "http://127.0.0.1:" + Port + "/" + (token.Length > 0 ? "?t=" + token : "");
        string browser = FindBrowser();
        if (browser != null) {
            Process.Start(new ProcessStartInfo {
                FileName = browser,
                Arguments = "--app=" + url + " --window-size=1380,940",
                UseShellExecute = false,
            });
        } else {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
    }
}
