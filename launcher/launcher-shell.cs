// DSH Launcher bootstrap shell: double-click → start the Node server in the background
// (hidden window) → wait for the port → open the workbench in a browser --app window
// (no address bar / tabs, native-application feel).
// Build: csc /target:winexe /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /win32icon:dsh.ico /out:<launcher exe name from setup.cmd> launcher-shell.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using System.Net;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Text;

static class DshLauncherShell {
    static int Port;
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;

    // Resolve through the same Node helper as CMD/setup before any cwd change.
    static string ResolveDshHome(string root, string cwd) {
        var psi = new ProcessStartInfo {
            FileName = "node",
            Arguments = "\"" + Path.Combine(root, "home-paths.mjs") + "\" --json",
            WorkingDirectory = cwd,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        using (var helper = Process.Start(psi)) {
            var output = helper.StandardOutput.ReadToEndAsync();
            var error = helper.StandardError.ReadToEndAsync();
            if (!helper.WaitForExit(10000)) {
                try { helper.Kill(); } catch { }
                throw new Exception("解析 DSH_HOME 超时；请检查 Node.js 和 launcher/home-paths.mjs");
            }
            if (helper.ExitCode != 0) throw new Exception("解析 DSH_HOME 失败；请检查 Node.js 和 launcher/home-paths.mjs");
            error.GetAwaiter().GetResult();
            var home = new JavaScriptSerializer().Deserialize<string>(output.GetAwaiter().GetResult());
            if (String.IsNullOrEmpty(home)) throw new Exception("DSH_HOME 解析器未返回有效路径");
            return home;
        }
    }

    static int ReadPort(string name, int fallback) {
        string raw = (Environment.GetEnvironmentVariable(name) ?? fallback.ToString()).Trim();
        int port;
        if (!Regex.IsMatch(raw, @"^\d+$") || !Int32.TryParse(raw, out port) || port < 1 || port > 65535)
            throw new Exception(name + " must be an integer between 1 and 65535");
        return port;
    }

    static string ReadyToken(string file) {
        try {
            string token = File.ReadAllText(file).Trim();
            if (!Regex.IsMatch(token, "^[0-9a-f]{32,64}$")) return null;
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/api/status");
            request.Proxy = null;
            request.AllowAutoRedirect = false;
            request.Timeout = 1500;
            request.ReadWriteTimeout = 1500;
            request.Headers["x-launcher-token"] = token;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) {
                var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                object running, url, mode, node;
                if (response.StatusCode == HttpStatusCode.OK && data != null
                    && data.TryGetValue("dshRunning", out running) && running is bool
                    && data.TryGetValue("dshUrl", out url) && url is string
                    && data.TryGetValue("node", out node) && node is string
                    && data.TryGetValue("launchMode", out mode) && (Object.Equals(mode, "built") || Object.Equals(mode, "source"))) return token;
            }
        } catch { }
        return null;
    }

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
        string home;
        try {
            Port = ReadPort("DSH_LAUNCHER_PORT", 3090);
            if (Port == ReadPort("DSH_WEB_PORT", 3080)) throw new Exception("DSH_LAUNCHER_PORT and DSH_WEB_PORT must use different ports");
            home = ResolveDshHome(Root, Environment.CurrentDirectory);
            Environment.SetEnvironmentVariable("DSH_HOME", home);
        } catch (Exception e) { MessageBox.Show(e.Message, "DSH Launcher"); return; }
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
        }
        // The API token is minted when the server owns the port and written to DSH_HOME. It travels
        // as a `?t=` query — only to the loopback server that minted it, and the page scrubs it
        // from the address bar immediately. A `#t=` fragment would be cleaner still, but Edge's
        // `--app=` handoff to an already-running browser drops fragments, which opened dead pages.
        string tokenFile = Path.Combine(home, "launcher.token");
        string token = null;
        var waiting = Stopwatch.StartNew();
        while (waiting.ElapsedMilliseconds < 60000 && token == null) {
            token = ReadyToken(tokenFile);
            if (token == null) Thread.Sleep(500);
        }
        if (token == null) { MessageBox.Show("启动器未通过就绪验证，请检查 DSH_HOME、端口占用和 .local/logs；未打开浏览器。", "DSH Launcher"); return; }
        string url = "http://127.0.0.1:" + Port + "/?t=" + token;
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
