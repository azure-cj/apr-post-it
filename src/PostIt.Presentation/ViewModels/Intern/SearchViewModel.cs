using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// Step 1 — find a property folder by typing part of its name. Results update as the intern types;
/// each shows when it was last posted and whether it is in cooldown or due for a repost.
/// </summary>
public sealed class SearchViewModel : InternPageViewModel
{
    private string _query;
    private string _shownQuery = "";
    private int _searchVersion;
    private bool _hasSearched;
    private IReadOnlyList<SearchPropertyRow> _results = Array.Empty<SearchPropertyRow>();
    private IReadOnlyList<MyLogTodayRow> _myLogs = Array.Empty<MyLogTodayRow>();
    private bool _logsLoaded;

    public SearchViewModel(AppServices s, INavigator n, string? initialQuery) : base(s, n)
    {
        _query = initialQuery?.Trim() ?? "";
        ClearCommand = Command(() => Query = "", () => _query.Length > 0);
    }

    public override string Title => "Search";
    public override NavKey Nav => NavKey.Search;

    public RelayCommand ClearCommand { get; }

    /// <summary>The search box. Every change re-runs the search; only the newest result is shown.</summary>
    public string Query
    {
        get => _query;
        set { if (Set(ref _query, value ?? "")) _ = SafelyAsync(SearchAsync); }
    }

    public IReadOnlyList<SearchPropertyRow> Results => _results;
    public bool HasResults => _results.Count > 0;
    public bool NoResults => _hasSearched && _results.Count == 0;

    /// <summary>"14 properties" (empty box), "2 matches", "1 match", "No matches".</summary>
    public string CountText
    {
        get
        {
            if (!_hasSearched) return "";
            if (_shownQuery.Trim().Length == 0) return InternFormat.Count(_results.Count, "property", "properties");
            return _results.Count == 0 ? "No matches" : InternFormat.Count(_results.Count, "match", "matches");
        }
    }

    public string NoResultsText => _shownQuery.Trim().Length == 0
        ? "No property folders found. Ask your manager to check the properties folder in Settings."
        : $"Nothing matches “{_shownQuery.Trim()}”. Try part of the name, the area or the type.";

    public IReadOnlyList<MyLogTodayRow> MyLogs => _myLogs;
    public bool HasMyLogs => _myLogs.Count > 0;
    public bool NoMyLogs => _logsLoaded && _myLogs.Count == 0;

    public override async Task LoadAsync()
    {
        await SearchAsync();
        _myLogs = await LoadMyLogsAsync();
        _logsLoaded = true;
        Raise(nameof(MyLogs), nameof(HasMyLogs), nameof(NoMyLogs));
    }

    private async Task SearchAsync()
    {
        // Calls can finish out of order (a slow folder scan, fast typing): only the newest may update the list.
        var version = ++_searchVersion;
        var query = _query;
        var found = await S.Posting.SearchAsync(query);
        if (version != _searchVersion) return;

        _results = found.Select(p => new SearchPropertyRow(p, row => Navigator.ShowProperty(row.Id))).ToList();
        _shownQuery = query;
        _hasSearched = true;
        Raise(nameof(Results), nameof(HasResults), nameof(NoResults), nameof(CountText), nameof(NoResultsText));
    }
}

/// <summary>One search result: name, last posted, category and cooldown/due badges, with an Open button.</summary>
public sealed class SearchPropertyRow
{
    public SearchPropertyRow(PropertySummary property, Action<SearchPropertyRow> open)
    {
        var cooldown = property.Cooldown;
        Property = property;
        Id = property.Id;
        Name = property.Name;
        Category = property.Category;
        Glyph = InternFormat.CategoryGlyph(property.Category);
        Meta = InternFormat.LastPosted(cooldown);
        IsInCooldown = cooldown.InCooldown;
        CooldownText = cooldown.InCooldown ? InternFormat.CooldownBadge(cooldown) : "";
        IsDue = cooldown.DueForRepost && !cooldown.NeverPosted && !cooldown.InCooldown;
        OpenCommand = new RelayCommand(() => open(this));
    }

    public PropertySummary Property { get; }
    public string Id { get; }
    public string Name { get; }
    public string Category { get; }

    /// <summary>Small category icon (icon-font glyph).</summary>
    public string Glyph { get; }

    /// <summary>"Last posted 3 Oct · 26 days ago" or "Never posted".</summary>
    public string Meta { get; }
    public bool IsInCooldown { get; }
    public string CooldownText { get; }

    /// <summary>Not posted for the repost period or longer.</summary>
    public bool IsDue { get; }
    public RelayCommand OpenCommand { get; }
}
