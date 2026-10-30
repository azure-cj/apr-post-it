using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// Step 4 — log the post. The intern types two things (FB account, post link); the app writes the rest of
/// the tracker row, shows it live and refuses to save inside the cooldown.
/// </summary>
public sealed class LogPostViewModel : InternPageViewModel
{
    private const string NotSaved = "Not saved.";

    private static readonly string[] PreviewProperties =
    {
        nameof(HasPreview), nameof(Problems), nameof(CanSave), nameof(IsInCooldown), nameof(CooldownProblem),
        nameof(CooldownLead), nameof(CooldownRest), nameof(ShowOk), nameof(OkMessage), nameof(SaveHint),
        nameof(RowDate), nameof(RowType), nameof(RowTitle), nameof(RowTime), nameof(RowStatus), nameof(RowStatusKind),
        nameof(GuardBadgeText), nameof(GuardBadgeKind), nameof(GuardChecks),
    };

    private readonly string _propertyId;
    private readonly string? _queueItemKey;
    private PropertyDetail? _detail;
    private string? _loadError;
    private LogPreview? _preview;
    private int _previewVersion;
    private PostStatus _status = PostStatus.Posted;
    private string _fbAccount = "";
    private string _postLink = "";
    private IReadOnlyList<string> _accounts = Array.Empty<string>();
    private IReadOnlyList<MyLogTodayRow> _myLogs = Array.Empty<MyLogTodayRow>();
    private IReadOnlyList<CooldownGuardRow> _guardChecks = Array.Empty<CooldownGuardRow>();
    private int _stillInQueue;

    public LogPostViewModel(AppServices s, INavigator n, string propertyId, string? queueItemKey) : base(s, n)
    {
        _propertyId = propertyId;
        _queueItemKey = queueItemKey;

        SaveCommand = AsyncCommand(SaveAsync, () => CanSave);
        PasteCommand = Command(() => { if (ReadPastedLink() is { } link) PostLink = link; }, () => IsLoaded);
        BackCommand = Command(() => Navigator.GoBack());
    }

    public override string Title => "Log this post";
    public override NavKey Nav => _queueItemKey is null ? NavKey.Search : NavKey.MyQueue;

    public AsyncRelayCommand SaveCommand { get; }
    public RelayCommand PasteCommand { get; }
    public RelayCommand BackCommand { get; }

    public bool IsLoaded => _detail is not null;
    public string? LoadError => _loadError;
    public bool HasLoadError => _loadError is not null;

    public string PropertyName => _detail?.Property.Name ?? "";

    /// <summary>"Verdant Hills Lot 12 · Lot · Tagaytay".</summary>
    public string Subtitle => _detail is null ? "" : InternFormat.Join(_detail.Property.Name, _detail.Property.Category, _detail.Property.Location);

    // ------------------------------------------------------------------ inputs (the only things typed by hand)

    /// <summary>Live post (Posted) or a group post awaiting approval (Pending).</summary>
    public PostStatus Status
    {
        get => _status;
        set { if (Set(ref _status, value)) { Raise(nameof(IsPendingStatus)); _ = SafelyAsync(RefreshPreviewAsync); } }
    }

    public bool IsPendingStatus => _status == PostStatus.Pending;

    public IReadOnlyList<string> Accounts => _accounts;

    public string FbAccount
    {
        get => _fbAccount;
        set { if (Set(ref _fbAccount, value ?? "")) _ = SafelyAsync(RefreshPreviewAsync); }
    }

    public string PostLink
    {
        get => _postLink;
        set { if (Set(ref _postLink, value ?? "")) _ = SafelyAsync(RefreshPreviewAsync); }
    }

    // ------------------------------------------------------------------ live preview

    public bool HasPreview => _preview is not null;
    public IReadOnlyList<string> Problems => _preview?.Problems ?? Array.Empty<string>();
    public bool CanSave => _preview?.CanSave == true;
    public bool IsInCooldown => _preview?.Cooldown.InCooldown == true;

    /// <summary>The service's refusal sentence: "Not saved. X was posted 2 days ago (27 Oct). The cooldown is 7 days — …".</summary>
    public string CooldownProblem => !IsInCooldown
        ? ""
        : Problems.FirstOrDefault(p => p.Contains("cooldown", StringComparison.OrdinalIgnoreCase)) ?? Problems.LastOrDefault() ?? "";

    /// <summary>"Not saved." (shown bold) …</summary>
    public string CooldownLead => CooldownProblem.StartsWith(NotSaved, StringComparison.Ordinal) ? NotSaved : "";

    /// <summary>… and the rest of the sentence.</summary>
    public string CooldownRest => CooldownLead.Length > 0 ? CooldownProblem[NotSaved.Length..].TrimStart() : CooldownProblem;

    public bool ShowOk => HasPreview && !IsInCooldown;

    /// <summary>Follows a bold "OK to log.": "X was last posted 26 days ago (3 Oct) — outside the 7-day cooldown."</summary>
    public string OkMessage
    {
        get
        {
            if (_preview is null || IsInCooldown) return "";
            var c = _preview.Cooldown;
            return c.LastPosted is { } last
                ? $"{PropertyName} was last posted {InternFormat.DaysAgo(c.DaysSince ?? 0)} ({InternFormat.Date(last, "d MMM")}) — outside the {CooldownDays}-day cooldown."
                : $"{PropertyName} has never been posted.";
        }
    }

    /// <summary>The problems other than the cooldown, e.g. "Type the FB account name.", "Paste the post link.".</summary>
    public IReadOnlyList<string> OtherProblems => Problems.Where(p => p != CooldownProblem).ToList();

    /// <summary>
    /// Under the Save button: "Still needed: Type the FB account name. Paste the post link." for missing inputs,
    /// other problems as they are ("The post link must be a facebook.com link."), or what Save does.
    /// </summary>
    public string SaveHint
    {
        get
        {
            if (!HasPreview) return "";
            if (IsInCooldown) return "The app will not save a post inside the cooldown.";
            var others = OtherProblems;
            if (others.Count == 0) return "Saving writes the row to the tracker sheet.";

            static bool IsInstruction(string p) => p.StartsWith("Type ", StringComparison.Ordinal) || p.StartsWith("Paste ", StringComparison.Ordinal);
            var needed = others.Where(IsInstruction).ToList();
            var parts = new List<string>();
            if (needed.Count > 0) parts.Add("Still needed: " + string.Join(" ", needed));
            parts.AddRange(others.Where(p => !IsInstruction(p)));
            return string.Join(" ", parts);
        }
    }

    // "Written for you": the tracker row the app will write.
    public string RowDate => _preview is null ? "" : InternFormat.Date(_preview.Row.Date, "d MMM yyyy");
    public string RowType => _preview?.Row.Type ?? "";
    public string RowTitle => _preview?.Row.Title ?? "";
    public string RowTime => _preview is null ? "" : InternFormat.Time(_preview.Row.Time);
    public string RowStatus => InternFormat.StatusLabel(_preview?.Row.Status ?? _status);
    public string RowStatusKind => InternFormat.StatusKind(_preview?.Row.Status ?? _status);

    // ------------------------------------------------------------------ cooldown guard (right card)

    public string GuardBadgeText => IsInCooldown ? $"{InternFormat.Days(_preview!.Cooldown.DaysLeft)} left" : "OK to log";
    public string GuardBadgeKind => IsInCooldown ? "cool" : "ok";

    /// <summary>Cooldown · link · account, each Pass / Fail (Warn = not filled in yet).</summary>
    public IReadOnlyList<CooldownGuardRow> GuardChecks => _guardChecks;

    public IReadOnlyList<MyLogTodayRow> MyLogs => _myLogs;
    public bool HasMyLogs => _myLogs.Count > 0;
    public bool NoMyLogs => IsLoaded && _myLogs.Count == 0;
    public int LoggedTodayCount => _myLogs.Count;
    public int StillInQueueCount => _stillInQueue;

    private int CooldownDays => S.Settings.Current.CooldownDays;

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

        _accounts = await S.Posting.GetFbAccountsAsync();
        _myLogs = await LoadMyLogsAsync();
        _stillInQueue = await S.Assignments.CountOpenAsync(S.Session.Name, S.Clock.Today);

        // Default account: the one this intern used most recently today, else the first one.
        if (_fbAccount.Length == 0)
            _fbAccount = _myLogs.Select(l => l.Entry.FbAccount).FirstOrDefault(a => a.Trim().Length > 0) ?? _accounts.FirstOrDefault() ?? "";

        Raise(nameof(Accounts));   // the list before the text, so the editable ComboBox can match it
        Raise(string.Empty);
        await RefreshPreviewAsync();
    }

    private LogPostRequest Request() => new(_propertyId, _fbAccount, _postLink, _status, S.Session.Name, _queueItemKey);

    private async Task RefreshPreviewAsync()
    {
        if (_detail is null) return;
        // Typing fires a preview per keystroke; they can finish out of order, so only the newest is applied.
        var version = ++_previewVersion;
        var preview = await S.Posting.PreviewLogAsync(Request());
        if (version != _previewVersion) return;

        _preview = preview;
        _guardChecks = BuildGuardChecks(preview);
        Raise(PreviewProperties);
    }

    private IReadOnlyList<CooldownGuardRow> BuildGuardChecks(LogPreview p)
    {
        var c = p.Cooldown;
        var cooldown = c.InCooldown
            ? new CooldownGuardRow($"Inside the {CooldownDays}-day cooldown · {InternFormat.Days(c.DaysLeft)} left", CheckStatus.Fail)
            : c.NeverPosted
                ? new CooldownGuardRow("Never posted — no cooldown", CheckStatus.Pass)
                : new CooldownGuardRow($"Outside the {CooldownDays}-day cooldown", CheckStatus.Pass);

        CooldownGuardRow link;
        if (p.Row.PostLink.Length == 0)
        {
            link = p.Row.Status == PostStatus.Pending
                ? new CooldownGuardRow("Post link can wait until the post is live", CheckStatus.Pass)
                : new CooldownGuardRow("Post link not pasted yet", CheckStatus.Warn);
        }
        else
        {
            var problem = p.Problems.FirstOrDefault(x => x.Contains("link", StringComparison.OrdinalIgnoreCase));
            link = problem is null
                ? new CooldownGuardRow("Post link is a facebook.com link", CheckStatus.Pass)
                : new CooldownGuardRow(problem, CheckStatus.Fail);
        }

        var account = p.Row.FbAccount.Length > 0
            ? new CooldownGuardRow("FB account name filled in", CheckStatus.Pass)
            : new CooldownGuardRow("FB account name not filled in yet", CheckStatus.Warn);

        return new[] { cooldown, link, account };
    }

    private async Task SaveAsync()
    {
        var result = await S.Posting.LogPostAsync(Request());
        if (!result.Saved)
        {
            S.Notifier.Notify(result.Message, ToastKind.Error);
            await RefreshPreviewAsync();
            return;
        }

        S.Notifier.Notify(result.Message, ToastKind.Success);
        await Navigator.RefreshBadgesAsync();
        if (_queueItemKey is not null) Navigator.ShowMyQueue();
        else Navigator.ShowSearch();
    }
}

/// <summary>One line of the cooldown guard checklist (glyph by status).</summary>
public sealed class CooldownGuardRow(string text, CheckStatus status)
{
    public string Text { get; } = text;
    public CheckStatus Status { get; } = status;
}
