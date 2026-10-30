using System.Collections.ObjectModel;
using System.Globalization;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// The manager's home: what was posted on a day, what's pending, which interns are done and which properties
/// are due for a repost or were never posted.
/// </summary>
public sealed class TrackerViewModel : PageViewModel
{
    /// <summary>How many "needs attention" rows the card lists.</summary>
    public const int AttentionLimit = 6;

    private DateOnly _date;
    private int _loadVersion;
    private int _postedCount;
    private int _pendingCount;
    private int _internsDone;
    private int _internsAssigned;
    private int _dueCount;
    private int _neverCount;
    private int _attentionTotal;

    public TrackerViewModel(AppServices s, INavigator n) : base(s, n)
    {
        _date = S.Clock.Today;
        PreviousDayCommand = AsyncCommand(() => ChangeDateAsync(Date.AddDays(-1)));
        NextDayCommand = AsyncCommand(() => ChangeDateAsync(Date.AddDays(1)));
        TodayCommand = AsyncCommand(() => ChangeDateAsync(S.Clock.Today), () => !IsToday);
        RefreshCommand = AsyncCommand(LoadAsync);
        OpenTrackerFolderCommand = Command(OpenTrackerFolder);
        AssignCommand = Command(() => Navigator.ShowAssign(null, Date.AddDays(1)));
    }

    public override string Title => "Tracker";
    public override NavKey Nav => NavKey.Tracker;

    // ------------------------------------------------------------------ date

    public DateOnly Date => _date;

    /// <summary>"Thu 29 Oct 2026".</summary>
    public string DateLabel => ManagerFormat.LongDate(Date);
    public bool IsToday => Date == S.Clock.Today;
    public bool IsNotToday => !IsToday;

    public AsyncRelayCommand PreviousDayCommand { get; }
    public AsyncRelayCommand NextDayCommand { get; }
    public AsyncRelayCommand TodayCommand { get; }
    public AsyncRelayCommand RefreshCommand { get; }

    // ------------------------------------------------------------------ stat tiles

    public int PostedCount { get => _postedCount; private set => Set(ref _postedCount, value); }

    /// <summary>"Posted today" or "Posted Wed 28 Oct".</summary>
    public string PostedLabel => IsToday ? "Posted today" : $"Posted {ManagerFormat.ShortDate(Date)}";

    /// <summary>All Pending rows, whatever their date (they wait for the group admin).</summary>
    public int PendingCount { get => _pendingCount; private set => Set(ref _pendingCount, value); }
    public string PendingLabel => "Pending";

    public int InternsDone { get => _internsDone; private set => Set(ref _internsDone, value); }
    public int InternsAssigned { get => _internsAssigned; private set => Set(ref _internsAssigned, value); }

    /// <summary>The big number of the "Interns done" tile.</summary>
    public string InternsDoneText => InternsDone.ToString(CultureInfo.InvariantCulture);

    /// <summary>The small " of 4" after it.</summary>
    public string InternsOfText => $" of {InternsAssigned}";
    public string InternsDoneLabel => "Interns done";

    public int DueCount { get => _dueCount; private set => Set(ref _dueCount, value); }

    /// <summary>"Due for repost · 14+ days".</summary>
    public string DueLabel => $"Due for repost · {S.Settings.Current.RepostDueDays}+ days";

    public int NeverCount { get => _neverCount; private set => Set(ref _neverCount, value); }
    public string NeverLabel => "Never posted";

    // ------------------------------------------------------------------ posts table

    public ObservableCollection<TrackerPostRowViewModel> Posts { get; } = new();
    public bool HasPosts => Posts.Count > 0;
    public bool HasNoPosts => !HasPosts;

    /// <summary>"Today's posts" or "Posts on this day".</summary>
    public string PostsTitle => IsToday ? "Today's posts" : "Posts on this day";

    /// <summary>"Thu 29 Oct 2026 · newest first".</summary>
    public string PostsSubtitle => $"{ManagerFormat.LongDate(Date)} · newest first";

    public string PostsFooter => "A Pending row gets its link once the group admin approves the post.";

    public RelayCommand OpenTrackerFolderCommand { get; }

    // ------------------------------------------------------------------ who's done

    public ObservableCollection<InternProgressRowViewModel> Interns { get; } = new();
    public bool HasNoInterns => Interns.Count == 0;

    // ------------------------------------------------------------------ needs attention

    public ObservableCollection<AttentionRowViewModel> Attention { get; } = new();
    public bool HasAttention => Attention.Count > 0;
    public bool HasNoAttention => !HasAttention;

    /// <summary>"6 of 9".</summary>
    public string AttentionCountText => $"{Attention.Count} of {_attentionTotal}";

    /// <summary>Opens Assign for the day after the shown date.</summary>
    public RelayCommand AssignCommand { get; }

    // ------------------------------------------------------------------ loading

    public override async Task LoadAsync()
    {
        var version = ++_loadVersion;
        var dashboard = await S.Tracker.GetDashboardAsync(Date);
        if (version != _loadVersion) return;

        PostedCount = dashboard.PostedToday;
        PendingCount = dashboard.PendingOpen;
        InternsDone = dashboard.InternsDone;
        InternsAssigned = dashboard.InternsAssigned;
        DueCount = dashboard.DueForRepost;
        NeverCount = dashboard.NeverPosted;

        Posts.Clear();
        foreach (var p in dashboard.TodaysPosts) Posts.Add(new TrackerPostRowViewModel(p, OpenLink));

        Interns.Clear();
        foreach (var i in dashboard.Interns) Interns.Add(new InternProgressRowViewModel(i, name => Navigator.ShowAssign(name, Date)));

        Attention.Clear();
        foreach (var a in dashboard.NeedsAttention.Take(AttentionLimit)) Attention.Add(new AttentionRowViewModel(a));
        _attentionTotal = dashboard.NeedsAttention.Count;

        Raise(nameof(InternsDoneText), nameof(InternsOfText), nameof(DueLabel), nameof(HasPosts), nameof(HasNoPosts),
            nameof(HasNoInterns), nameof(HasAttention), nameof(HasNoAttention), nameof(AttentionCountText));
    }

    private async Task ChangeDateAsync(DateOnly date)
    {
        if (date == _date) return;
        _date = date;
        Raise(nameof(Date), nameof(DateLabel), nameof(IsToday), nameof(IsNotToday), nameof(PostedLabel),
            nameof(PostsTitle), nameof(PostsSubtitle));
        await LoadAsync();
    }

    private void OpenLink(string url)
    {
        try { S.Ui.OpenUrl(url); }
        catch (Exception ex) { OnError(ex); }
    }

    private void OpenTrackerFolder()
    {
        try { S.Ui.OpenFolder(S.Settings.Current.TrackerFolder); }
        catch (Exception ex) { OnError(ex); }
    }
}

/// <summary>A row of the posts table.</summary>
public sealed class TrackerPostRowViewModel
{
    public TrackerPostRowViewModel(PostLogEntry entry, Action<string> openLink)
    {
        Entry = entry;
        OpenLinkCommand = new RelayCommand(() => openLink(entry.PostLink), () => HasLink);
    }

    public PostLogEntry Entry { get; }

    /// <summary>"11:52".</summary>
    public string Time => Entry.Time.ToString("HH:mm", CultureInfo.InvariantCulture);
    public string Property => Entry.Title;

    /// <summary>"Bea".</summary>
    public string Intern => ManagerFormat.FirstName(Entry.PostedBy);
    public string InternFullName => Entry.PostedBy;
    public string Account => Entry.FbAccount;
    public string StatusText => Entry.Status == PostStatus.Posted ? "Posted" : "Pending";
    public string StatusKind => Entry.Status == PostStatus.Posted ? "ok" : "pending";
    public bool HasLink => !string.IsNullOrWhiteSpace(Entry.PostLink);
    public bool HasNoLink => !HasLink;
    public string Link => Entry.PostLink;

    public RelayCommand OpenLinkCommand { get; }
}

/// <summary>An intern in the "Who's done" card.</summary>
public sealed class InternProgressRowViewModel
{
    public InternProgressRowViewModel(InternProgress progress, Action<string> openQueue)
    {
        Progress = progress;
        QueueCommand = new RelayCommand(() => openQueue(progress.User.Name));
    }

    public InternProgress Progress { get; }
    public string Name => Progress.User.Name;
    public string Initials => Progress.User.Initials;
    public bool IsAssigned => Progress.Total > 0;
    public bool IsDone => Progress.Done;

    /// <summary>"3 / 5 · 1 pending", "4 / 4" or "Not assigned".</summary>
    public string ProgressText => !IsAssigned
        ? "Not assigned"
        : Progress.Pending > 0
            ? $"{Progress.Posted} / {Progress.Total} · {Progress.Pending} pending"
            : $"{Progress.Posted} / {Progress.Total}";

    /// <summary>Posted share, 0..1 (the ProgressBar's Maximum is 1).</summary>
    public double ProgressValue => IsAssigned ? (double)Progress.Posted / Progress.Total : 0;

    /// <summary>"Queue" when assigned, otherwise "Assign".</summary>
    public string QueueLinkText => IsAssigned ? "Queue" : "Assign";

    public RelayCommand QueueCommand { get; }
}

/// <summary>A property in the "Needs attention" card.</summary>
public sealed class AttentionRowViewModel
{
    private const string NeverPrefix = "Never posted · ";

    public AttentionRowViewModel(AttentionItem item)
    {
        Item = item;
        // The badge already says "Never posted": show only the rest ("Not assigned", "In Jan's queue").
        Detail = item.Kind == AttentionKind.NeverPosted && item.Detail.StartsWith(NeverPrefix, StringComparison.Ordinal)
            ? ManagerFormat.UpperFirst(item.Detail[NeverPrefix.Length..])
            : item.Detail;
    }

    public AttentionItem Item { get; }
    public string Name => Item.Property.Name;
    public string Detail { get; }
    public string BadgeText => Item.Kind == AttentionKind.DueForRepost ? "Due" : "Never posted";
    public string BadgeKind => Item.Kind == AttentionKind.DueForRepost ? "pending" : "cool";
}
