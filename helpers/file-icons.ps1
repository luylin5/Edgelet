# 读取文件在资源管理器里显示的系统图标（不是内容预览），保存为 PNG。
# 优先取 256px 超大图标；如果程序本身只带了小图标，就改用 48px，避免图标缩成一角。
# 输入：JSON 数组 [{ "path": "...", "out": "...png" }]
param([Parameter(Mandatory = $true)][string]$In)

$ErrorActionPreference = 'Stop'

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class EdgeletIcons {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHFILEINFO {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
    }

    [ComImport, Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IImageList {
        [PreserveSig] int Add(IntPtr hbmImage, IntPtr hbmMask, ref int pi);
        [PreserveSig] int ReplaceIcon(int i, IntPtr hicon, ref int pi);
        [PreserveSig] int SetOverlayImage(int iImage, int iOverlay);
        [PreserveSig] int Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
        [PreserveSig] int AddMasked(IntPtr hbmImage, int crMask, ref int pi);
        [PreserveSig] int Draw(IntPtr pimldp);
        [PreserveSig] int Remove(int i);
        [PreserveSig] int GetIcon(int i, int flags, out IntPtr picon);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SHGetFileInfo(string path, uint attr, ref SHFILEINFO info, uint size, uint flags);
    [DllImport("shell32.dll")]
    static extern int SHGetImageList(int list, ref Guid riid, out IImageList ppv);
    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr h);

    const uint SHGFI_SYSICONINDEX = 0x4000;
    const int SHIL_EXTRALARGE = 2; // 48px
    const int SHIL_JUMBO = 4;      // 256px
    const int ILD_TRANSPARENT = 1;

    public static void Save(string path, string outFile) {
        var info = new SHFILEINFO();
        if (SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(info), SHGFI_SYSICONINDEX) == IntPtr.Zero)
            throw new Exception("SHGetFileInfo failed");

        Bitmap bmp = FromList(SHIL_JUMBO, info.iIcon);
        if (bmp == null || ContentSize(bmp) <= 48) {
            if (bmp != null) bmp.Dispose();
            bmp = FromList(SHIL_EXTRALARGE, info.iIcon);
        }
        if (bmp == null) throw new Exception("no icon");
        using (bmp) bmp.Save(outFile, ImageFormat.Png);
    }

    static Bitmap FromList(int list, int index) {
        Guid iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
        IImageList images;
        if (SHGetImageList(list, ref iid, out images) != 0 || images == null) return null;
        IntPtr h;
        if (images.GetIcon(index, ILD_TRANSPARENT, out h) != 0 || h == IntPtr.Zero) return null;
        try {
            using (Icon icon = Icon.FromHandle(h)) return icon.ToBitmap();
        } finally {
            DestroyIcon(h);
        }
    }

    // 不透明像素的包围盒边长
    static int ContentSize(Bitmap b) {
        int minX = b.Width, minY = b.Height, maxX = -1, maxY = -1;
        for (int y = 0; y < b.Height; y++)
            for (int x = 0; x < b.Width; x++)
                if (b.GetPixel(x, y).A > 8) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
        if (maxX < 0) return 0;
        return Math.Max(maxX - minX + 1, maxY - minY + 1);
    }
}
'@

$jobs = Get-Content -LiteralPath $In -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($job in $jobs) {
    try {
        [EdgeletIcons]::Save($job.path, $job.out)
        "ok`t$($job.path)"
    } catch {
        "fail`t$($job.path)`t$($_.Exception.Message)"
    }
}
