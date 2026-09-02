# Windows Credential Manager helper for dsh-credentials-keyring.
# Reads JSON lines on stdin ({op, name, value?}), answers one JSON line each.
# Values travel base64-encoded both ways so newlines and quotes never touch the pipe.
# Targets are namespaced "dsh:<NAME>" generic credentials, persisted per-machine.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DshCredMan {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredReadW")]
    public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredWriteW")]
    public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CredDeleteW")]
    public static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr buffer);

    public static string ReadValue(string target) {
        IntPtr handle;
        if (!CredRead(target, 1, 0, out handle)) return null;
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(handle, typeof(CREDENTIAL));
            if (cred.CredentialBlobSize == 0 || cred.CredentialBlob == IntPtr.Zero) return "";
            byte[] blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, (int)cred.CredentialBlobSize);
            return System.Text.Encoding.Unicode.GetString(blob);
        } finally {
            CredFree(handle);
        }
    }

    public static void WriteValue(string target, string value) {
        byte[] blob = System.Text.Encoding.Unicode.GetBytes(value);
        IntPtr blobPtr = Marshal.AllocHGlobal(blob.Length);
        try {
            Marshal.Copy(blob, 0, blobPtr, blob.Length);
            CREDENTIAL cred = new CREDENTIAL();
            cred.Type = 1;                    // CRED_TYPE_GENERIC
            cred.TargetName = target;
            cred.CredentialBlobSize = (uint)blob.Length;
            cred.CredentialBlob = blobPtr;
            cred.Persist = 2;                 // CRED_PERSIST_LOCAL_MACHINE
            cred.UserName = "dsh";
            if (!CredWrite(ref cred, 0)) throw new Exception("CredWrite failed: " + Marshal.GetLastWin32Error());
        } finally {
            Marshal.FreeHGlobal(blobPtr);
        }
    }

    // True on delete, true when nothing was there (idempotent), throws on a real failure
    // (e.g. access denied) so "deleted" is never reported over a credential that still lives.
    public static bool DeleteValue(string target) {
        if (CredDelete(target, 1, 0)) return true;
        int err = Marshal.GetLastWin32Error();
        if (err == 1168) return false;   // ERROR_NOT_FOUND: already absent
        throw new Exception("CredDelete failed: " + err);
    }
}
'@

$b64 = [System.Text.Encoding]::UTF8
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line.Length -eq 0) { continue }
    $reply = $null
    try {
        $req = $line | ConvertFrom-Json
        $name = [string]$req.name
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]{0,120}$') { throw 'bad credential name' }
        $target = 'dsh:' + $name
        switch ([string]$req.op) {
            'get' {
                $value = [DshCredMan]::ReadValue($target)
                if ($null -eq $value) { $reply = @{ ok = $true; found = $false } }
                else { $reply = @{ ok = $true; found = $true; value = [Convert]::ToBase64String($b64.GetBytes($value)) } }
            }
            'set' {
                $value = $b64.GetString([Convert]::FromBase64String([string]$req.value))
                [DshCredMan]::WriteValue($target, $value)
                $reply = @{ ok = $true }
            }
            'delete' {
                [void][DshCredMan]::DeleteValue($target)
                $reply = @{ ok = $true }
            }
            default { throw ('unknown op: ' + $req.op) }
        }
    } catch {
        $reply = @{ ok = $false; error = [string]$_.Exception.Message }
    }
    [Console]::Out.WriteLine(($reply | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
