using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using PostIt.Core;
using PostIt.Presentation;

namespace PostIt.App.Services;

/// <summary>The WPF side of <see cref="IUiServices"/>: clipboard, Explorer, browser, dialogs.</summary>
public sealed class WpfUiServices : IUiServices
{
    public string DownloadsFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");

    public void CopyText(string text)
    {
        // The clipboard can be briefly held by another app (CLIPBRD_E_CANT_OPEN): retry a few times.
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                Clipboard.SetDataObject(text, copy: true);
                return;
            }
            catch (ExternalException) when (attempt < 5)
            {
                Thread.Sleep(60);
            }
            catch (ExternalException ex)
            {
                throw new UserFacingException("The clipboard is busy. Try Copy again.", ex);
            }
        }
    }

    public string? ReadClipboardText()
    {
        try { return Clipboard.ContainsText() ? Clipboard.GetText() : null; }
        catch (ExternalException) { return null; }
    }

    public void OpenFolder(string path)
    {
        if (!Directory.Exists(path)) throw new UserFacingException($"Folder not found: {path}");
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }

    public void OpenFile(string path)
    {
        if (!File.Exists(path)) throw new UserFacingException($"File not found: {path}");
        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }

    public void OpenUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new UserFacingException("That doesn't look like a web link.");
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    public string? PickFolder(string title, string? initialFolder = null)
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog { Title = title, Multiselect = false };
        if (!string.IsNullOrWhiteSpace(initialFolder) && Directory.Exists(initialFolder))
            dialog.InitialDirectory = initialFolder;
        var owner = Application.Current?.MainWindow;
        var ok = owner is null ? dialog.ShowDialog() : dialog.ShowDialog(owner);
        return ok == true ? dialog.FolderName : null;
    }

    public bool Confirm(string title, string message, string confirmLabel = "OK")
    {
        var owner = Application.Current?.MainWindow;
        var result = owner is null
            ? MessageBox.Show(message, title, MessageBoxButton.OKCancel, MessageBoxImage.Question)
            : MessageBox.Show(owner, message, title, MessageBoxButton.OKCancel, MessageBoxImage.Question);
        return result == MessageBoxResult.OK;
    }
}
