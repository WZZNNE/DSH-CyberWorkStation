// DSH Launcher 引导器:双击 → 后台拉起 node server(隐藏窗口)→ 等端口就绪
// → 以浏览器 --app 独立应用窗口打开工作台(无地址栏/标签页,原生程序观感)。
// 编译:csc /target:winexe /win32icon:dsh.ico /out:DSH启动器.exe launcher-shell.cs
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
            for (int i = 0; i < 40 && !PortUp(); i++) Thread.Sleep(500);
            if (!PortUp()) { MessageBox.Show("服务 60 秒内未就绪,查看 logs/ 目录。", "DSH Launcher"); return; }
        }
        string browser = FindBrowser();
        if (browser != null) {
            Process.Start(new ProcessStartInfo {
                FileName = browser,
                Arguments = "--app=http://127.0.0.1:" + Port + "/ --window-size=1380,940",
                UseShellExecute = false,
            });
        } else {
            Process.Start(new ProcessStartInfo { FileName = "http://127.0.0.1:" + Port + "/", UseShellExecute = true });
        }
    }
}
