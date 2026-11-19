using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Mineradio 桌面歌词安装向导")]
[assembly: AssemblyProduct("Mineradio 桌面歌词")]

public class Download
{
    public string url { get; set; }
    public string sha256 { get; set; }
    public int bytes { get; set; }
    public string version { get; set; }
    public string file { get; set; }
}

public class ConnectionComponents
{
    public string[] clientVersions { get; set; }
    public Download betterNcm { get; set; }
    public Download infLink { get; set; }
}

internal sealed class ConnectionWizard : Form
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
    private static readonly string[] RegistryBranches = {
        @"Software\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe",
        @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe"
    };
    private const string UninstallBranch = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    private const string Product = "Mineradio 桌面歌词";
    private const string ProfileVariable = "BETTERNCM_PROFILE";
    private readonly ConnectionComponents components = Resource<ConnectionComponents>("Mineradio.Components");
    private readonly Download package = Resource<Download>("Mineradio.Package");
    private readonly TextBox client = new TextBox { ReadOnly = true, Dock = DockStyle.Fill };
    private readonly TextBox pluginDirectory = new TextBox { Dock = DockStyle.Fill };
    private readonly TextBox installDirectory = new TextBox { Dock = DockStyle.Fill };
    private readonly Label status = new Label { AutoSize = true, Dock = DockStyle.Fill, MinimumSize = new Size(0, 58) };
    private readonly Button chooseClient = new Button { Text = "选择网易云…", AutoSize = true };
    private readonly Button choosePlugins = new Button { Text = "选择插件目录…", AutoSize = true };
    private readonly Button chooseDirectory = new Button { Text = "选择目录…", AutoSize = true };
    private readonly Button configure = new Button { AutoSize = true };
    private readonly Button skip = new Button { AutoSize = true };
    private readonly Button cancel = new Button { Text = "取消", AutoSize = true, DialogResult = DialogResult.Cancel };
    private readonly string selectionFile;
    private readonly string fullSetupDestination;
    private bool busy;

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        using (var wizard = new ConnectionWizard(args.FirstOrDefault(), args.Skip(1).FirstOrDefault()))
            return wizard.ShowDialog() == DialogResult.OK ? 0 : 2;
    }

    private ConnectionWizard(string selectionFile, string fullSetupDestination)
    {
        this.selectionFile = selectionFile;
        this.fullSetupDestination = fullSetupDestination;
        bool web = package != null;
        Text = Product + (web ? "安装" : " · 安装准备");
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoScaleMode = AutoScaleMode.Font;
        Font = new Font("Microsoft YaHei UI", 10);
        ClientSize = new Size(645, web ? 406 : 347);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 1 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(layout);

        layout.Controls.Add(new Label {
            Text = "安装前准备网易云插件", AutoSize = true, Margin = new Padding(0, 0, 0, 8),
            Font = new Font(Font.FontFamily, 14, FontStyle.Bold)
        });
        layout.Controls.Add(new Label {
            Text = "先配置 BetterNCM " + components.betterNcm.version + " 和 InfLink-rs " + components.infLink.version
                + (web ? "，再下载桌面歌词。" : "，再安装桌面歌词。"),
            AutoSize = true, Margin = new Padding(0, 0, 0, 12)
        });
        client.Text = FindClient();
        chooseClient.Click += delegate {
            using (var picker = new OpenFileDialog { FileName = client.Text, Filter = "网易云音乐 (cloudmusic.exe)|cloudmusic.exe" })
                if (picker.ShowDialog(this) == DialogResult.OK) client.Text = picker.FileName;
        };
        AddField(layout, "网易云音乐", client, chooseClient);
        pluginDirectory.Text = ConfiguredProfile() ?? "";
        choosePlugins.Click += delegate { ChooseFolder(pluginDirectory, "选择或新建 BetterNCM 插件目录"); };
        AddField(layout, "BetterNCM 插件目录", pluginDirectory, choosePlugins);
        if (web) {
            installDirectory.Text = FindInstalledDirectory();
            chooseDirectory.Click += delegate { ChooseFolder(installDirectory, "选择桌面歌词安装目录"); };
            AddField(layout, "歌词安装目录", installDirectory, chooseDirectory);
        }

        status.Text = "可在任意磁盘选择插件文件夹。新增插件或切换目录前，请先从网易云托盘退出。";
        status.MaximumSize = new Size(590, 0);
        layout.Controls.Add(status);
        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
        configure.Text = web ? "配置并下载安装" : "配置并继续";
        skip.Text = web ? "仅安装歌词" : "稍后配置";
        actions.Controls.AddRange(new Control[] { cancel, skip, configure });
        layout.Controls.Add(actions);
        configure.Click += async delegate { await Continue(true); };
        skip.Click += async delegate { await Continue(false); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) e.Cancel = true; };
        AcceptButton = configure;
        CancelButton = cancel;
    }

    private void ChooseFolder(TextBox field, string description)
    {
        using (var picker = new FolderBrowserDialog {
            Description = description, RootFolder = Environment.SpecialFolder.MyComputer,
            SelectedPath = Directory.Exists(field.Text) ? field.Text : ""
        })
            if (picker.ShowDialog(this) == DialogResult.OK) field.Text = picker.SelectedPath;
    }

    private static void AddField(Control form, string name, TextBox field, Button browse)
    {
        form.Controls.Add(new Label { Text = name, AutoSize = true, Margin = new Padding(0) });
        var row = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, ColumnCount = 2, Margin = new Padding(0, 2, 0, 6) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.Controls.Add(field, 0, 0);
        row.Controls.Add(browse, 1, 0);
        form.Controls.Add(row);
    }

    private void SetStatus(string text) { status.Text = text; }

    private async Task Continue(bool prepare)
    {
        busy = true;
        var controls = new Control[] { configure, skip, cancel, chooseClient, choosePlugins, pluginDirectory, chooseDirectory, installDirectory };
        foreach (var control in controls) control.Enabled = false;
        bool success = false;
        try {
            string destination = fullSetupDestination;
            if (package != null) {
                if (string.IsNullOrWhiteSpace(installDirectory.Text))
                    throw new InvalidOperationException("请选择桌面歌词的安装文件夹。");
                destination = Path.GetFullPath(installDirectory.Text.Trim());
                if (Path.GetPathRoot(destination) == destination || File.Exists(Path.Combine(destination, "cloudmusic.exe")))
                    throw new InvalidOperationException("请为桌面歌词选择独立的安装文件夹。");
                if (IsRunning("MineradioLyrics"))
                    throw new InvalidOperationException("请先从托盘退出正在运行的 Mineradio 桌面歌词，再继续安装。");
            }
            var selection = prepare ? await PrepareConnection(destination) : null;
            if (package != null) await InstallPackage(destination, selection);
            else if (prepare) File.WriteAllText(selectionFile, selection, Utf8);
            success = true;
        } catch (Exception error) {
            SetStatus(error.GetBaseException().Message);
        } finally {
            busy = false;
            foreach (var control in controls) control.Enabled = true;
        }
        if (success) DialogResult = DialogResult.OK;
    }

    private async Task<string> PrepareConnection(string destination)
    {
        var executable = client.Text;
        if (!IsClient(executable))
            throw new InvalidOperationException("请选择已安装的网易云音乐 cloudmusic.exe。");
        if (Environment.GetEnvironmentVariable("BETTERNCM_DISABLED_FLAG") != null)
            throw new InvalidOperationException("当前环境停用了 BetterNCM。请恢复 BetterNCM 后重新打开安装器。");
        var clientDirectory = Path.GetDirectoryName(executable);
        var profile = PluginPath(pluginDirectory.Text, clientDirectory, destination);
        var version = FileVersionInfo.GetVersionInfo(executable).FileVersion;
        if (!components.clientVersions.Contains(version) || !IsX64(executable))
            throw new InvalidOperationException("当前网易云版本：" + version + "。向导可配置的 x64 版本：" + string.Join("、", components.clientVersions) + "。");
        SetStatus("正在核对网易云与已安装的插件…");
        if (await Task.Run(() => VerifyNetEase(executable)) != 0)
            throw new InvalidOperationException("无法确认所选网易云程序的 NetEase 数字签名。请选择官方客户端。");

        var loader = Path.Combine(clientDirectory, "msimg32.dll");
        var plugin = Path.Combine(profile, "plugins", "InfLink-rs.plugin");
        bool addLoader = !File.Exists(loader);
        if (!addLoader && !MatchesFile(loader, components.betterNcm))
            throw new InvalidOperationException("网易云目录中已有其他加载器。请用 BetterNCM 的安装流程确认其版本。");
        bool addPlugin = !HasInfLink(profile);
        var currentProfile = ConfiguredProfile() ?? @"C:\betterncm";
        bool changingProfile = !string.Equals(profile, currentProfile.TrimEnd('\\', '/').Replace('/', '\\'), StringComparison.OrdinalIgnoreCase);
        if (addLoader || addPlugin || changingProfile) RequireMusicClosed();
        var assets = new List<KeyValuePair<string, byte[]>>();
        if (addPlugin) {
            SetStatus("正在下载 InfLink-rs " + components.infLink.version + "…");
            assets.Add(new KeyValuePair<string, byte[]>(plugin, await DownloadChecked(components.infLink)));
        }
        if (addLoader) {
            SetStatus("正在下载 BetterNCM " + components.betterNcm.version + "…");
            assets.Add(new KeyValuePair<string, byte[]>(loader, await DownloadChecked(components.betterNcm)));
        }
        if (assets.Count != 0) RequireMusicClosed();
        var created = new List<string>();
        try {
            foreach (var asset in assets) {
                Directory.CreateDirectory(Path.GetDirectoryName(asset.Key));
                WriteNewFile(asset.Key, asset.Value);
                created.Add(asset.Key);
            }
            var savedProfile = Environment.GetEnvironmentVariable(ProfileVariable, EnvironmentVariableTarget.User);
            if (!string.Equals(savedProfile, profile, StringComparison.OrdinalIgnoreCase))
                Environment.SetEnvironmentVariable(ProfileVariable, profile, EnvironmentVariableTarget.User);
        } catch {
            foreach (string file in created) File.Delete(file);
            throw;
        }
        return Json.Serialize(new { clientExecutable = executable, profile = profile });
    }

    private static string ConfiguredProfile()
    {
        return Environment.GetEnvironmentVariable(ProfileVariable, EnvironmentVariableTarget.User)
            ?? Environment.GetEnvironmentVariable(ProfileVariable, EnvironmentVariableTarget.Machine)
            ?? Environment.GetEnvironmentVariable(ProfileVariable);
    }

    private static string PluginPath(string value, string clientDirectory, string destination)
    {
        value = value.Trim();
        var root = value.Length == 0 ? null : Path.GetPathRoot(value);
        if (string.IsNullOrEmpty(root) || root.Length < 3)
            throw new InvalidOperationException("请选择或输入 BetterNCM 插件文件夹，例如 D:\\BetterNCM。");
        var profile = Path.GetFullPath(value).TrimEnd('\\');
        if (string.Equals(profile, root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) ||
            string.Equals(profile, clientDirectory, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("请选择独立的 BetterNCM 插件文件夹。");
        if (destination != null) {
            var install = Path.GetFullPath(destination).TrimEnd('\\');
            if (string.Equals(profile, install, StringComparison.OrdinalIgnoreCase) ||
                profile.StartsWith(install + "\\", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("请将 BetterNCM 插件文件夹放在歌词安装目录之外。");
        }
        return profile;
    }

    private async Task InstallPackage(string destination, string selection)
    {
        var folder = Path.Combine(Path.GetTempPath(), "MineradioSetup-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var downloaded = Path.Combine(folder, package.file);
        var plan = Path.Combine(folder, "connection.json");
        var failure = Path.Combine(folder, "connection-error.txt");
        try {
            SetStatus("正在取得并核对 Mineradio " + package.version + " 安装包…");
            string adjacent = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, package.file);
            if (File.Exists(adjacent) && new FileInfo(adjacent).Length == package.bytes)
                await Task.Run(() => File.Copy(adjacent, downloaded));
            if (!await Task.Run(() => MatchesFile(downloaded, package))) {
                SetStatus("正在从 GitHub 下载 Mineradio " + package.version + "…");
                File.WriteAllBytes(downloaded, await DownloadChecked(package));
            }

            SetStatus("正在安装桌面歌词…");
            // NSIS reads /D as the entire remainder of the command line.
            var result = await Task.Run(() => Run(downloaded, "/S /currentuser /D=" + destination, hidden: false));
            var launcher = Path.Combine(destination, "MineradioLyrics.exe");
            if (result != 0 || !File.Exists(launcher) || FileVersionInfo.GetVersionInfo(launcher).ProductVersion != package.version)
                throw new InvalidOperationException("桌面歌词安装未完成，请检查安装目录和安装器提示。");

            if (selection != null) {
                SetStatus("正在配置内置 MineradioBridge…");
                File.WriteAllText(plan, selection, Utf8);
                var node = Path.Combine(destination, @"resources\node.exe");
                var script = Path.Combine(destination, @"resources\app\src\desktop-setup.cjs");
                result = await Task.Run(() => Run(node, "--no-global-search-paths " + Quote(script) + " " + Quote(plan) + " " + Quote(failure)));
                if (result != 0)
                    throw new InvalidOperationException("歌词已安装，Bridge 待配置。\n" + (File.Exists(failure) ? File.ReadAllText(failure) : "可从歌词托盘打开网易云连接设置。"));
            }
            string message = "桌面歌词已安装。可从开始菜单打开 Mineradio 桌面歌词。";
            if (selection != null) message += "\n插件已配置。若网易云已打开，请从托盘退出后重开。播放歌曲即可确认歌词连接。";
            MessageBox.Show(this, message, Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
        } finally {
            try {
                foreach (string file in new[] { downloaded, plan, failure }) File.Delete(file);
                Directory.Delete(folder);
            } catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static async Task<byte[]> DownloadChecked(Download artifact)
    {
        using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3), MaxResponseContentBufferSize = artifact.bytes }) {
            try {
                var data = await http.GetByteArrayAsync(artifact.url);
                using (var stream = new MemoryStream(data, false))
                    if (data.Length == artifact.bytes && Hash(stream) == artifact.sha256) return data;
                throw new InvalidOperationException("下载文件校验失败。请重试。");
            } catch (HttpRequestException) {
                throw new InvalidOperationException("无法从 GitHub 下载文件。请检查网络或与安装器同版本的发布附件后重试。");
            } catch (TaskCanceledException) {
                throw new InvalidOperationException("下载超时，请检查网络后重试。");
            }
        }
    }

    private static bool MatchesFile(string file, Download artifact)
    {
        if (!File.Exists(file)) return false;
        using (var stream = File.OpenRead(file))
            return stream.Length == artifact.bytes && Hash(stream) == artifact.sha256;
    }

    private static string Hash(Stream stream)
    {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    private static void WriteNewFile(string file, byte[] contents)
    {
        var stage = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            File.WriteAllBytes(stage, contents);
            File.Move(stage, file);
        } finally { File.Delete(stage); }
    }

    private bool HasInfLink(string profile)
    {
        var found = new List<string>();
        foreach (string name in new[] { "plugins_dev", "plugins" }) {
            var folder = Path.Combine(profile, name);
            if (!Directory.Exists(folder)) continue;
            foreach (var entry in Directory.EnumerateFileSystemEntries(folder)) {
                var manifest = ReadPluginManifest(entry);
                if (manifest == null) continue;
                object pluginName;
                if (!manifest.TryGetValue("name", out pluginName)) continue;
                var id = pluginName as string;
                if (string.Equals(id, "InfLink-rs", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(id, "InfLinkrs", StringComparison.OrdinalIgnoreCase)) {
                    object version;
                    manifest.TryGetValue("version", out version);
                    found.Add(version as string);
                }
            }
        }
        if (found.Count == 0) return false;
        if (found.Count != 1 || found[0] != components.infLink.version)
            throw new InvalidOperationException("BetterNCM 数据目录已有其他或重复的 InfLink-rs，请在 BetterNCM 中整理后重试。");
        return true;
    }

    private static Dictionary<string, object> ReadPluginManifest(string entry)
    {
        try {
            if (Directory.Exists(entry)) {
                var manifest = Path.Combine(entry, "manifest.json");
                return File.Exists(manifest) ? Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(manifest)) : null;
            }
            if (!entry.EndsWith(".plugin", StringComparison.OrdinalIgnoreCase)) return null;
            using (var zip = ZipFile.OpenRead(entry)) {
                var manifest = zip.GetEntry("manifest.json");
                if (manifest == null || manifest.Length > 262144) return null;
                using (var reader = new StreamReader(manifest.Open()))
                    return Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            }
        } catch (IOException) { return null; }
        catch (InvalidDataException) { return null; }
        catch (ArgumentException) { return null; }
    }

    private static void RequireMusicClosed()
    {
        if (IsRunning("cloudmusic"))
            throw new InvalidOperationException("请从网易云音乐托盘退出客户端，再继续配置插件。");
    }

    private static bool IsRunning(string name)
    {
        var processes = Process.GetProcessesByName(name);
        foreach (var process in processes) process.Dispose();
        return processes.Length != 0;
    }

    private static bool IsX64(string file)
    {
        using (var stream = File.OpenRead(file))
        using (var reader = new BinaryReader(stream)) {
            if (stream.Length < 64 || reader.ReadUInt16() != 0x5a4d) return false;
            stream.Position = 60;
            int header = reader.ReadInt32();
            if (header < 0 || header > stream.Length - 6) return false;
            stream.Position = header;
            return reader.ReadUInt32() == 0x4550 && reader.ReadUInt16() == 0x8664;
        }
    }

    private static int VerifyNetEase(string file)
    {
        var exe = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
        const string command = "Import-Module ($PSHOME+'\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop;"
            + "$s=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:MINERADIO_CLIENT_CHECK_PATH;"
            + "if($s.Status -eq 'Valid' -and $s.SignerCertificate.GetNameInfo('SimpleName',$false) -eq 'NetEase (Hangzhou) Network Co., Ltd'){exit 0};exit 1";
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(command));
        return Run(exe, "-NoProfile -NonInteractive -EncodedCommand " + encoded, file);
    }

    private static int Run(string file, string args, string clientPath = null, bool hidden = true)
    {
        var start = new ProcessStartInfo(file, args) { UseShellExecute = false, CreateNoWindow = hidden, WorkingDirectory = Path.GetDirectoryName(file) };
        if (clientPath != null) {
            // The calling shell may have set a module path for a different PowerShell version.
            start.EnvironmentVariables.Remove("PSModulePath");
            start.EnvironmentVariables["MINERADIO_CLIENT_CHECK_PATH"] = clientPath;
        }
        using (var process = Process.Start(start)) {
            process.WaitForExit();
            return process.ExitCode;
        }
    }

    private static string Quote(string text) { return '"' + text + '"'; }

    private static bool IsClient(string file)
    {
        return File.Exists(file) && string.Equals(Path.GetFileName(file), "cloudmusic.exe", StringComparison.OrdinalIgnoreCase);
    }

    private static string FindClient()
    {
        foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
            foreach (string name in RegistryBranches)
                using (var key = root.OpenSubKey(name)) {
                    var value = key == null ? null : key.GetValue("") as string;
                    if (IsClient(value)) return value;
                }
        foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
            foreach (var branch in new[] { UninstallBranch, @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" })
                using (var uninstall = root.OpenSubKey(branch)) {
                    var value = FindUninstaller(uninstall, "网易云音乐", "UnInstall.exe");
                    if (value == null) continue;
                    var file = Path.Combine(Path.GetDirectoryName(value), "cloudmusic.exe");
                    if (IsClient(file)) return file;
                }
        foreach (var key in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 }) {
            var value = Path.Combine(Environment.GetFolderPath(key), @"NetEase\CloudMusic\cloudmusic.exe");
            if (IsClient(value)) return value;
        }
        return "";
    }

    private static string FindInstalledDirectory()
    {
        using (var key = Registry.CurrentUser.OpenSubKey(UninstallBranch)) {
            string existing = FindUninstaller(key, Product, "Uninstall MineradioLyrics.exe");
            if (existing != null) return Path.GetDirectoryName(existing);
        }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\mineradio-external-lyrics-phase1");
    }

    private static string FindUninstaller(RegistryKey key, string product, string name)
    {
        if (key == null) return null;
        foreach (string item in key.GetSubKeyNames()) using (var row = key.OpenSubKey(item)) {
            if (row == null) continue;
            string label = row.GetValue("DisplayName") as string;
            if (label == null || !label.StartsWith(product, StringComparison.Ordinal)) continue;
            string command = row.GetValue("UninstallString") as string;
            if (string.IsNullOrWhiteSpace(command)) continue;
            string file = command[0] == '"' ? command.Split('"')[1] : command;
            if (File.Exists(file) && string.Equals(Path.GetFileName(file), name, StringComparison.OrdinalIgnoreCase)) return file;
        }
        return null;
    }

    private static T Resource<T>(string name) where T : class
    {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) {
            if (stream == null) return null;
            using (var reader = new StreamReader(stream)) return Json.Deserialize<T>(reader.ReadToEnd());
        }
    }
}
