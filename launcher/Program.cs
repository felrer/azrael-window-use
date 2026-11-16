using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;

[assembly: AssemblyTitle("Window Use MCP")]
[assembly: AssemblyProduct("Window Use MCP")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

internal static class Program
{
    private const int ConnectTimeoutMs = 30000;
    private const int ShutdownTimeoutMs = 8000;

    private sealed class Options
    {
        internal bool Mcp;
        internal string Host = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WindowUseHost.exe");
        internal string App;
        internal readonly List<string> Arguments = new List<string>();
    }

    private static int Main(string[] args)
    {
        try
        {
            var options = Parse(args);
            if (!File.Exists(options.Host)) throw new IOException("WindowUseHost.exe is missing; extract the complete distribution.");
            if (!options.Mcp)
            {
                var start = new ProcessStartInfo(options.Host, HostArguments(options, null));
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                start.WorkingDirectory = Path.GetDirectoryName(options.Host);
                start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                start.EnvironmentVariables.Remove("WINDOW_USE_PIPE_TOKEN");
                using (var host = Process.Start(start)) { if (host == null) throw new IOException("Could not start Window Use settings."); }
                return 0;
            }
            return RunMcp(options);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("[Window Use] Launcher failed: " + error.Message);
            return 2;
        }
    }

    private static Options Parse(string[] args)
    {
        var options = new Options();
        bool hasHost = false, hasApp = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--mcp")
            {
                if (options.Mcp) throw new ArgumentException("Duplicate --mcp.");
                options.Mcp = true;
            }
            else if (args[i] == "--host" || args[i] == "--app")
            {
                string flag = args[i];
                if (++i == args.Length || !Path.IsPathRooted(args[i])) throw new ArgumentException(flag + " requires an absolute path.");
                if (flag == "--host")
                {
                    if (hasHost) throw new ArgumentException("Duplicate --host.");
                    options.Host = Path.GetFullPath(args[i]); hasHost = true;
                }
                else
                {
                    if (hasApp || !Directory.Exists(args[i])) throw new ArgumentException("--app requires one existing absolute project directory.");
                    options.App = Path.GetFullPath(args[i]); hasApp = true;
                }
            }
            else if (args[i] == "--mcp-pipe" || args[i].StartsWith("--mcp-pipe=", StringComparison.Ordinal)) throw new ArgumentException("--mcp-pipe is reserved for the launcher.");
            else options.Arguments.Add(args[i]);
        }
        return options;
    }

    private static string HostArguments(Options options, string pipeName)
    {
        var arguments = new List<string>();
        if (options.App != null) arguments.Add(options.App);
        arguments.AddRange(options.Arguments);
        if (pipeName != null) { arguments.Add("--mcp-pipe"); arguments.Add(pipeName); }
        return String.Join(" ", arguments.ConvertAll(Quote).ToArray());
    }

    // CommandLineToArgvW-compatible quoting, including trailing backslashes.
    private static string Quote(string value)
    {
        var text = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { text.Append('\\', slashes * 2 + 1); text.Append('"'); }
            else { text.Append('\\', slashes); text.Append(character); }
            slashes = 0;
        }
        text.Append('\\', slashes * 2); text.Append('"');
        return text.ToString();
    }

    private static string RandomHex(int bytes)
    {
        var value = new byte[bytes];
        using (var random = RandomNumberGenerator.Create()) random.GetBytes(value);
        return BitConverter.ToString(value).Replace("-", "").ToLowerInvariant();
    }

    private static int RunMcp(Options options)
    {
        string pipeName = "window-use-" + RandomHex(24), token = RandomHex(32);
        var sid = WindowsIdentity.GetCurrent().User;
        if (sid == null) throw new IOException("Current Windows user SID unavailable.");
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.SetOwner(sid);
        security.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
        using (var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security))
        using (var owned = StartOwnedHost(options, pipeName, token))
        {
            try
            {
                var connection = pipe.BeginWaitForConnection(null, null);
                using (var ready = connection.AsyncWaitHandle)
                {
                    if (!ready.WaitOne(ConnectTimeoutMs)) throw new IOException("Window Use host did not connect before the startup deadline.");
                    pipe.EndWaitForConnection(connection);
                }
                var authentication = Authenticate(pipe, token);
                if (Task.WhenAny(authentication, Task.Delay(ConnectTimeoutMs)).GetAwaiter().GetResult() != authentication) throw new IOException("Window Use host authentication timed out.");
                authentication.GetAwaiter().GetResult();
                var input = Console.OpenStandardInput();
                var output = Console.OpenStandardOutput();
                var fromClient = Copy(input, pipe);
                var toClient = Copy(pipe, output);
                var hostExit = Task.Run(() => owned.Process.WaitForExit());
                var finished = Task.WhenAny(fromClient, toClient, hostExit).GetAwaiter().GetResult();
                bool failed = finished.IsFaulted;
                // EOF closes this adapter session, leaving the shared service and
                // other clients alive. The bounded fallback targets this adapter only.
                pipe.Dispose();
                if (!owned.Process.WaitForExit(ShutdownTimeoutMs))
                {
                    Console.Error.WriteLine("[Window Use] Adapter shutdown timed out; stopping this adapter only.");
                    owned.Process.Kill();
                    return 3;
                }
                return owned.Process.ExitCode != 0 ? owned.Process.ExitCode : failed ? 2 : 0;
            }
            finally { pipe.Dispose(); }
        }
    }

    private static async Task Authenticate(Stream pipe, string token)
    {
        byte[] expected = Encoding.ASCII.GetBytes(token + "\n"), actual = new byte[expected.Length];
        int offset = 0;
        while (offset < actual.Length)
        {
            int count = await pipe.ReadAsync(actual, offset, actual.Length - offset).ConfigureAwait(false);
            if (count == 0) throw new IOException("Window Use host closed before authentication.");
            offset += count;
        }
        int difference = 0;
        for (int i = 0; i < expected.Length; i++) difference |= expected[i] ^ actual[i];
        if (difference != 0) throw new IOException("Window Use host authentication failed.");
    }

    private static async Task Copy(Stream input, Stream output)
    {
        var buffer = new byte[65536];
        while (true)
        {
            int count = await input.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
            if (count == 0) return;
            await output.WriteAsync(buffer, 0, count).ConfigureAwait(false);
            await output.FlushAsync().ConfigureAwait(false);
        }
    }

    private sealed class OwnedHost : IDisposable
    {
        internal Process Process;
        public void Dispose()
        {
            if (Process != null) {
                try { if (!Process.HasExited) Process.Kill(); }
                finally { Process.Dispose(); Process = null; }
            }
        }
    }

    private static OwnedHost StartOwnedHost(Options options, string pipeName, string token)
    {
        var owned = new OwnedHost();
        var info = new PROCESS_INFORMATION();
        IntPtr environment = IntPtr.Zero;
        try
        {
            // Adapters must not own the shared host's process tree. The pipe EOF
            // closes only this client session; timeout fallback kills this adapter.
            var values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry pair in Environment.GetEnvironmentVariables()) values[(string)pair.Key] = (string)pair.Value;
            values.Remove("ELECTRON_RUN_AS_NODE");
            values["WINDOW_USE_PIPE_TOKEN"] = token;
            var block = new StringBuilder();
            foreach (var pair in values) block.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
            block.Append('\0');
            environment = Marshal.StringToHGlobalUni(block.ToString());
            var startup = new STARTUPINFO(); startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            var command = new StringBuilder(Quote(options.Host) + " " + HostArguments(options, pipeName));
            // No inherited standard handles: the GUI host talks only through our pipe.
            if (!CreateProcess(options.Host, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000404, environment, Path.GetDirectoryName(options.Host), ref startup, out info)) throw new System.ComponentModel.Win32Exception();
            owned.Process = Process.GetProcessById((int)info.dwProcessId);
            // Retain a process handle before resuming: a fast EOF exit must still
            // expose its terminal status through .NET's Process wrapper.
            if (owned.Process.Handle == IntPtr.Zero) throw new IOException("Owned host process handle unavailable.");
            if (ResumeThread(info.hThread) == UInt32.MaxValue) throw new System.ComponentModel.Win32Exception();
            return owned;
        }
        catch
        {
            if (info.hProcess != IntPtr.Zero) TerminateProcess(info.hProcess, 2);
            owned.Dispose();
            throw;
        }
        finally
        {
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            if (info.hThread != IntPtr.Zero) CloseHandle(info.hThread);
            if (info.hProcess != IntPtr.Zero) CloseHandle(info.hProcess);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        internal int cb;
        internal string lpReserved, lpDesktop, lpTitle;
        internal uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        internal short wShowWindow, cbReserved2;
        internal IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION { internal IntPtr hProcess, hThread; internal uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        internal long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        internal uint ActiveProcessLimit;
        internal UIntPtr Affinity;
        internal uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS { internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        internal IO_COUNTERS IoInfo;
        internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
}
