using System.Text.RegularExpressions;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// Step 2 — one property: the public posting text with a Copy button (the internal part is never copied),
/// the pre-post checks, the posting history and the photos.
/// </summary>
public sealed class PropertyViewModel : InternPageViewModel
{
    private const string CommissionCheck = "No commission wording";

    private readonly string _propertyId;
    private readonly string? _queueItemKey;
    private PropertyDetail? _detail;
    private string? _loadError;
    private bool _hasCopied;
    private bool _isInternalShown;
    private IReadOnlyList<PropertyCheckRow> _checks = Array.Empty<PropertyCheckRow>();
    private IReadOnlyList<PropertyHistoryRow> _history = Array.Empty<PropertyHistoryRow>();
    private IReadOnlyList<PropertyPhotoRow> _photos = Array.Empty<PropertyPhotoRow>();

    public PropertyViewModel(AppServices s, INavigator n, string propertyId, string? queueItemKey) : base(s, n)
    {
        _propertyId = propertyId;
        _queueItemKey = queueItemKey;

        BackCommand = Command(() => Navigator.GoBack());
        OpenFolderCommand = Command(() => Safely(() => S.Ui.OpenFolder(_detail!.Property.FolderPath)), () => IsLoaded);
        CopyCommand = Command(Copy, () => CanCopy);
        ToggleInternalCommand = Command(() => IsInternalShown = !IsInternalShown, () => HasInternalSection);
        DownloadAllCommand = AsyncCommand(DownloadAllAsync, () => HasPhotos);
        NextCommand = Command(() => Navigator.ShowLogPost(_propertyId, _queueItemKey), () => IsLoaded);
    }

    public override string Title => _detail?.Property.Name ?? "Property";
    public override NavKey Nav => _queueItemKey is null ? NavKey.Search : NavKey.MyQueue;

    public RelayCommand BackCommand { get; }
    public RelayCommand OpenFolderCommand { get; }
    public RelayCommand CopyCommand { get; }
    public RelayCommand ToggleInternalCommand { get; }
    public AsyncRelayCommand DownloadAllCommand { get; }
    public RelayCommand NextCommand { get; }

    public bool IsLoaded => _detail is not null;
    public string? LoadError => _loadError;
    public bool HasLoadError => _loadError is not null;

    // ------------------------------------------------------------------ header

    /// <summary>2 (Copy) until the text is copied, then 3 (Post).</summary>
    public int ActiveStep => _hasCopied ? 3 : 2;
    public bool HasCopied => _hasCopied;

    public string PropertyName => _detail?.Property.Name ?? "";

    /// <summary>"Lot · Tagaytay · Last posted 3 Oct 2026 (26 days ago)" or "… · Never posted".</summary>
    public string Subtitle
    {
        get
        {
            if (_detail is null) return "";
            var c = _detail.Cooldown;
            var posted = c.LastPosted is { } last
                ? $"Last posted {InternFormat.Date(last, "d MMM yyyy")} ({InternFormat.DaysAgo(c.DaysSince ?? 0)})"
                : "Never posted";
            return InternFormat.Join(_detail.Property.Category, _detail.Property.Location, posted);
        }
    }

    // ------------------------------------------------------------------ alerts

    public string DocWarning => _detail?.DocWarning ?? "";
    public bool HasDocWarning => DocWarning.Length > 0;

    public bool IsInCooldown => _detail?.Cooldown.InCooldown == true;

    /// <summary>"In cooldown — posted 2 days ago (27 Oct). It can be posted again on Tue 3 Nov. Logging will be refused."</summary>
    public string CooldownMessage
    {
        get
        {
            if (!IsInCooldown) return "";
            var c = _detail!.Cooldown;
            return $"In cooldown — posted {InternFormat.DaysAgo(c.DaysSince ?? 0)} ({InternFormat.Date(c.LastPosted!.Value, "d MMM")}). " +
                   $"It can be posted again on {InternFormat.Date(c.AvailableOn!.Value, "ddd d MMM")}. Logging will be refused.";
        }
    }

    private CheckResult? FailedCheck => _detail?.Checks.FirstOrDefault(c => c.Status == CheckStatus.Fail);

    /// <summary>True when a pre-post check failed (e.g. commission wording in the public text): Copy is disabled.</summary>
    public bool IsCopyBlocked => FailedCheck is not null;

    public string CopyBlockedMessage
    {
        get
        {
            if (FailedCheck is not { } fail) return "";
            if (fail.Name == CommissionCheck)
            {
                var quoted = Regex.Match(fail.Detail, "\"[^\"]+\"");
                var found = quoted.Success ? quoted.Value : fail.Detail;
                return $"Copy is blocked: the public text mentions commission ({found}). Ask your manager to fix the posting doc.";
            }
            return $"Copy is blocked: {fail.Name} — {fail.Detail}. Ask your manager to fix the posting doc.";
        }
    }

    // ------------------------------------------------------------------ text

    /// <summary>The only text that is ever copied.</summary>
    public string PublicText => _detail?.Text.PublicText ?? "";
    public bool CanCopy => IsLoaded && PublicText.Length > 0 && !IsCopyBlocked;

    public bool HasInternalSection => _detail?.Text.HasInternalSection == true;
    public bool HasNoInternalSection => IsLoaded && !HasInternalSection;

    /// <summary>Shown for reference only (Show/Hide). Never copied.</summary>
    public string InternalText => _detail?.Text.InternalText ?? "";

    public bool IsInternalShown
    {
        get => _isInternalShown;
        set { if (Set(ref _isInternalShown, value)) Raise(nameof(InternalToggleLabel)); }
    }

    public string InternalToggleLabel => _isInternalShown ? "Hide" : "Show";

    // ------------------------------------------------------------------ photos

    public IReadOnlyList<PropertyPhotoRow> Photos => _photos;
    public bool HasPhotos => _photos.Count > 0;
    public bool NoPhotos => IsLoaded && _photos.Count == 0;

    /// <summary>"8 files in the property folder".</summary>
    public string PhotoCountText => $"{InternFormat.Count(_photos.Count, "file", "files")} in the property folder";

    // ------------------------------------------------------------------ right card

    public IReadOnlyList<PropertyCheckRow> Checks => _checks;
    public IReadOnlyList<PropertyHistoryRow> History => _history;
    public bool HasHistory => _history.Count > 0;
    public bool NeverPosted => IsLoaded && _history.Count == 0;

    // ------------------------------------------------------------------ actions

    public override async Task LoadAsync()
    {
        try
        {
            _detail = await S.Posting.OpenAsync(_propertyId);
        }
        catch (Exception ex)
        {
            _loadError = ex is UserFacingException ? ex.Message : $"Could not open this property: {ex.Message}";
            Raise(string.Empty);
            return;
        }

        var d = _detail;
        var checks = d.Checks.Select(c => new PropertyCheckRow(c.Name, c.Detail, c.Status)).ToList();
        checks.Add(CooldownCheck(d.Cooldown));
        _checks = checks;
        _history = d.History.Take(4).Select(h => new PropertyHistoryRow(h)).ToList();
        _photos = d.Property.PhotoPaths
            .Select(p => new PropertyPhotoRow(p, path => Safely(() => S.Ui.OpenFile(path))))
            .ToList();
        _loadError = null;
        Raise(string.Empty);
    }

    private PropertyCheckRow CooldownCheck(CooldownState c)
    {
        if (c.NeverPosted) return new PropertyCheckRow("Never posted", "OK to post", CheckStatus.Pass);
        var ago = $"Last posted {InternFormat.DaysAgo(c.DaysSince ?? 0)}";
        return c.InCooldown
            ? new PropertyCheckRow(ago, $"in cooldown, {InternFormat.Days(c.DaysLeft)} left", CheckStatus.Fail)
            : new PropertyCheckRow(ago, "OK to repost", CheckStatus.Pass);
    }

    private void Copy()
    {
        if (!CanCopy) return;
        var copied = false;
        Safely(() => { S.Ui.CopyText(PublicText); copied = true; });
        if (!copied) return;

        _hasCopied = true;
        Raise(nameof(HasCopied), nameof(ActiveStep));
        S.Notifier.Notify("Copied the public text. Rephrase it in your AI tool, then post it with the photos.", ToastKind.Success);
    }

    private async Task DownloadAllAsync()
    {
        var name = _detail!.Property.Name;
        var sources = _detail.Property.PhotoPaths;
        var folder = Path.Combine(S.Ui.DownloadsFolder, "APG Post-It", SafeFolderName(name));

        int copied;
        try
        {
            copied = await Task.Run(() => CopyPhotos(sources, folder));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            S.Notifier.Notify($"Could not save the photos: {ex.Message}", ToastKind.Error);
            return;
        }

        if (copied == 0)
        {
            S.Notifier.Notify("Could not find the photos in the property folder. Try Open folder.", ToastKind.Error);
            return;
        }

        Safely(() => S.Ui.OpenFolder(folder));
        var missing = sources.Count - copied;
        var message = $"Saved {InternFormat.Count(copied, "photo", "photos")} to Downloads\\APG Post-It\\{SafeFolderName(name)}";
        if (missing > 0) message += $" ({InternFormat.Count(missing, "file was", "files were")} missing)";
        S.Notifier.Notify(message, missing > 0 ? ToastKind.Warning : ToastKind.Success);
    }

    /// <summary>Copies the photos that exist into <paramref name="folder"/> (overwriting); returns how many were copied.</summary>
    private static int CopyPhotos(IReadOnlyList<string> sources, string folder)
    {
        Directory.CreateDirectory(folder);
        var copied = 0;
        foreach (var source in sources)
        {
            if (!File.Exists(source)) continue;
            File.Copy(source, Path.Combine(folder, Path.GetFileName(source)), overwrite: true);
            copied++;
        }
        return copied;
    }

    private static string SafeFolderName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars().Concat(new[] { '\\', '/', ':', '*', '?', '"', '<', '>', '|' }).ToHashSet();
        var safe = new string(name.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray()).Trim().TrimEnd('.');
        return safe.Length == 0 ? "Property" : safe;
    }
}

/// <summary>One pre-post check: a round status glyph, the check name and a muted detail.</summary>
public sealed class PropertyCheckRow(string name, string detail, CheckStatus status)
{
    public string Name { get; } = name;
    public string Detail { get; } = detail;
    public CheckStatus Status { get; } = status;
    public bool HasDetail => Detail.Length > 0;
}

/// <summary>One posting-history line: "3 Oct 2026 · Alpha Premier Group · Mia · Posted".</summary>
public sealed class PropertyHistoryRow
{
    public PropertyHistoryRow(PostLogEntry entry)
    {
        Entry = entry;
        Date = InternFormat.Date(entry.Date, "d MMM yyyy");
        FbAccount = entry.FbAccount;
        By = InternFormat.FirstName(entry.PostedBy);
        StatusLabel = InternFormat.StatusLabel(entry.Status);
        BadgeKind = InternFormat.StatusKind(entry.Status);
    }

    public PostLogEntry Entry { get; }
    public string Date { get; }
    public string FbAccount { get; }
    public string By { get; }
    public string StatusLabel { get; }
    public string BadgeKind { get; }
}

/// <summary>One photo thumbnail with an Open button.</summary>
public sealed class PropertyPhotoRow
{
    public PropertyPhotoRow(string path, Action<string> open)
    {
        Path = path;
        FileName = System.IO.Path.GetFileName(path);
        OpenCommand = new RelayCommand(() => open(Path));
    }

    /// <summary>Full path (bound to the Thumbnail converter).</summary>
    public string Path { get; }
    public string FileName { get; }
    public RelayCommand OpenCommand { get; }
}
