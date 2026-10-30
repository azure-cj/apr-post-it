using System.Globalization;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>Which day My Queue shows: today's work, or a read-only preview of tomorrow.</summary>
public enum MyQueueDay { Today, Tomorrow }

/// <summary>
/// The intern's home page: the queue the manager built for the day, worked top to bottom.
/// Pending group posts stay pinned at the top until the live link is added, then To post in order, then Posted.
/// </summary>
public sealed class MyQueueViewModel : InternPageViewModel
{
    private MyQueueDay _day = MyQueueDay.Today;
    private int _loadVersion;
    private bool _isLoaded;
    private QueueView? _queue;
    private IReadOnlyList<MyQueueItemRow> _items = Array.Empty<MyQueueItemRow>();
    private IReadOnlyList<MyQueueItemRow> _pendingItems = Array.Empty<MyQueueItemRow>();
    private IReadOnlyList<MyQueueItemRow> _toPostItems = Array.Empty<MyQueueItemRow>();
    private IReadOnlyList<MyQueueItemRow> _postedItems = Array.Empty<MyQueueItemRow>();
    private IReadOnlyList<MyLogTodayRow> _myLogs = Array.Empty<MyLogTodayRow>();

    public MyQueueViewModel(AppServices s, INavigator n) : base(s, n)
    {
        RefreshCommand = AsyncCommand(LoadAsync);
        SearchCommand = Command(() => Navigator.ShowSearch());
    }

    public override string Title => "My Queue";
    public override NavKey Nav => NavKey.MyQueue;

    public AsyncRelayCommand RefreshCommand { get; }
    public RelayCommand SearchCommand { get; }

    /// <summary>Today | Tomorrow toggle. Switching reloads the list.</summary>
    public MyQueueDay Day
    {
        get => _day;
        set
        {
            if (!Set(ref _day, value)) return;
            _isLoaded = false;
            SetItems(Array.Empty<MyQueueItemRow>());
            _queue = null;
            Raise(string.Empty);
            _ = SafelyAsync(LoadAsync);
        }
    }

    /// <summary>Tomorrow's queue is a preview: nothing can be opened yet.</summary>
    public bool IsPreview => _day == MyQueueDay.Tomorrow;
    public DateOnly QueueDate => IsPreview ? S.Clock.Today.AddDays(1) : S.Clock.Today;

    /// <summary>"My Queue · Thu 29 Oct 2026".</summary>
    public string Header => $"My Queue · {InternFormat.Date(QueueDate, "ddd d MMM yyyy")}";

    /// <summary>Every row in display order (Pending, To post, Posted).</summary>
    public IReadOnlyList<MyQueueItemRow> Items => _items;
    public IReadOnlyList<MyQueueItemRow> PendingItems => _pendingItems;
    public IReadOnlyList<MyQueueItemRow> ToPostItems => _toPostItems;
    public IReadOnlyList<MyQueueItemRow> PostedItems => _postedItems;

    public int ToPostCount => _queue?.ToPost ?? 0;
    public int PostedCount => _queue?.Posted ?? 0;
    public int PendingCount => _queue?.Pending ?? 0;
    public int TotalCount => _items.Count;

    /// <summary>0..1 for the progress bar.</summary>
    public double ProgressValue => TotalCount == 0 ? 0 : (double)PostedCount / TotalCount;
    public string ProgressText => $"{PostedCount} of {TotalCount} posted";

    public bool HasItems => TotalCount > 0;
    public bool IsEmpty => _isLoaded && TotalCount == 0;
    public bool AllDone => !IsPreview && TotalCount > 0 && ToPostCount == 0 && PendingCount == 0;
    public bool ShowPreviewHint => IsPreview && HasItems;

    public string EmptyTitle => IsPreview ? "Nothing in your queue for tomorrow yet." : "Nothing in your queue for today.";

    public IReadOnlyList<MyLogTodayRow> MyLogs => _myLogs;
    public bool HasMyLogs => _myLogs.Count > 0;
    public bool NoMyLogs => _isLoaded && _myLogs.Count == 0;

    public override async Task LoadAsync()
    {
        var version = ++_loadVersion;
        var preview = IsPreview;
        var queue = await S.Assignments.GetQueueAsync(S.Session.Name, QueueDate);
        var logs = await LoadMyLogsAsync();
        if (version != _loadVersion) return;   // the day was switched meanwhile; the newer load wins

        var number = 0;
        var rows = queue.Items
            .Select(item => new MyQueueItemRow(item, item.Assignment.Status == AssignmentStatus.ToPost ? ++number : 0, preview,
                open: r => Navigator.ShowProperty(r.PropertyId!, r.Key),
                addLink: r => Navigator.ShowCompletePending(r.PostKey!),
                viewPost: r => Safely(() => S.Ui.OpenUrl(r.Link))))
            .ToList();

        _queue = queue;
        SetItems(rows);
        _myLogs = logs;
        _isLoaded = true;
        Raise(string.Empty);

        await Navigator.RefreshBadgesAsync();
    }

    private void SetItems(IReadOnlyList<MyQueueItemRow> rows)
    {
        _items = rows;
        _pendingItems = rows.Where(r => r.IsPending).ToList();
        _toPostItems = rows.Where(r => r.IsToPost).ToList();
        _postedItems = rows.Where(r => r.IsPosted).ToList();
    }
}

/// <summary>One queue item, ready to show. Which buttons appear depends on its status.</summary>
public sealed class MyQueueItemRow
{
    public MyQueueItemRow(QueueItem item, int number, bool preview,
        Action<MyQueueItemRow> open, Action<MyQueueItemRow> addLink, Action<MyQueueItemRow> viewPost)
    {
        var assignment = item.Assignment;
        var property = item.Property;
        var post = item.Post;

        Item = item;
        Key = assignment.Key;
        Status = assignment.Status;
        PropertyId = property?.Id;
        PostKey = post?.Key;
        Name = property?.Name ?? assignment.PropertyName;
        Category = property?.Category ?? "";
        Link = post?.PostLink ?? "";
        Number = number > 0 ? number.ToString(CultureInfo.InvariantCulture) : "";
        IsPrimary = number == 1;
        ShowOpen = Status == AssignmentStatus.ToPost && !preview;

        IsInCooldown = Status == AssignmentStatus.ToPost && property?.Cooldown.InCooldown == true;
        CooldownText = IsInCooldown ? InternFormat.CooldownBadge(property!.Cooldown) : "";

        Meta = Status switch
        {
            AssignmentStatus.Pending => post is null
                ? "Pending, but its tracker row is missing — tell your manager"
                : "Group post awaiting approval · add the live link when it's up",
            AssignmentStatus.Posted => post is null
                ? "Posted"
                : InternFormat.Join($"Posted {InternFormat.Time(post.Time)}", post.FbAccount),
            _ => property is null
                ? "Folder not found — tell your manager"
                : InternFormat.Join(property.Location, InternFormat.LastPosted(property.Cooldown, "Never posted yet")),
        };

        OpenCommand = new RelayCommand(() => open(this), () => PropertyId is not null && !preview);
        AddLinkCommand = new RelayCommand(() => addLink(this), () => PostKey is not null);
        ViewPostCommand = new RelayCommand(() => viewPost(this), () => HasLink);
    }

    public QueueItem Item { get; }

    /// <summary>The assignment key (passed on to Property and Log so Save closes this item).</summary>
    public string Key { get; }
    public AssignmentStatus Status { get; }
    public string? PropertyId { get; }
    public string? PostKey { get; }

    public bool IsPending => Status == AssignmentStatus.Pending;
    public bool IsToPost => Status == AssignmentStatus.ToPost;
    public bool IsPosted => Status == AssignmentStatus.Posted;

    public string Name { get; }
    public string Meta { get; }

    /// <summary>"1", "2"… among the To post items ("" for the others).</summary>
    public string Number { get; }

    /// <summary>The first To post item: its Open button is the gold one.</summary>
    public bool IsPrimary { get; }

    /// <summary>False in tomorrow's preview.</summary>
    public bool ShowOpen { get; }
    public bool ShowPrimaryOpen => ShowOpen && IsPrimary;
    public bool ShowSecondaryOpen => ShowOpen && !IsPrimary;

    public string Category { get; }
    public bool HasCategory => Category.Length > 0;
    public bool IsInCooldown { get; }
    public string CooldownText { get; }

    public string Link { get; }
    public bool HasLink => Link.Length > 0;

    public RelayCommand OpenCommand { get; }
    public RelayCommand AddLinkCommand { get; }
    public RelayCommand ViewPostCommand { get; }
}
