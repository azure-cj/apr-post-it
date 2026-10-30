using System.Collections.ObjectModel;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// The manager builds an intern's queue for a date (tomorrow by default): search the property folders or paste a
/// typed list, add, reorder, then Save. Properties in cooldown on that date — or already in someone else's queue —
/// can't be added. Adding and reordering only change the draft; Save is the only write.
/// </summary>
public sealed class AssignViewModel : PageViewModel
{
    private List<SavedQueueItem> _saved = new();
    private AppUser? _selectedIntern;
    private DateOnly _date;
    private string _searchText = "";
    private string _searchFooter = "";
    private string _searchEmptyText = "";
    private int _searchVersion;
    private int _queueVersion;
    private bool _confirming;
    private string _pasteText = "";
    private string _matchSummary = "";
    private string _addedMessage = "";
    private int _addableMatchCount;

    public AssignViewModel(AppServices s, INavigator n, string? intern, DateOnly? date) : base(s, n)
    {
        Interns = S.Settings.Current.Users.Where(u => u.Role == UserRole.Intern).ToList();
        _selectedIntern = Interns.FirstOrDefault(u => ManagerFormat.SamePerson(u.Name, intern)) ?? Interns.FirstOrDefault();
        _date = date ?? S.Clock.Today.AddDays(1);

        PreviousDayCommand = AsyncCommand(() => ChangeDateAsync(Date.AddDays(-1)));
        NextDayCommand = AsyncCommand(() => ChangeDateAsync(Date.AddDays(1)));
        TodayCommand = AsyncCommand(() => ChangeDateAsync(S.Clock.Today));
        TomorrowCommand = AsyncCommand(() => ChangeDateAsync(S.Clock.Today.AddDays(1)));
        SaveCommand = AsyncCommand(SaveAsync, () => HasIntern && IsDirty);
        UndoCommand = Command(Undo, () => IsDirty);
        MatchCommand = AsyncCommand(MatchAsync, () => HasIntern && !string.IsNullOrWhiteSpace(PasteText));
        AddAllMatchedCommand = Command(AddAllMatched, () => AddableMatchCount > 0);
    }

    public override string Title => "Assign";
    public override NavKey Nav => NavKey.Assign;

    // ------------------------------------------------------------------ who and when

    /// <summary>Interns from settings, in team order.</summary>
    public IReadOnlyList<AppUser> Interns { get; }

    public bool HasIntern => SelectedIntern is not null;
    public bool HasNoInterns => Interns.Count == 0;

    /// <summary>
    /// The intern whose queue is shown. Switching with unsaved changes asks first; on "keep editing" the old intern
    /// stays selected (the setter raises PropertyChanged so the ComboBox snaps back).
    /// </summary>
    public AppUser? SelectedIntern
    {
        get => _selectedIntern;
        set
        {
            if (value is null || _confirming || Equals(value, _selectedIntern)) return;
            if (!ConfirmDiscard())
            {
                RaiseNowAndLater(nameof(SelectedIntern));
                return;
            }
            _selectedIntern = value;
            Raise(nameof(SelectedIntern), nameof(HasIntern), nameof(InternFirstName), nameof(QueueHint));
            ClearMatches();
            Fire(ReloadAsync);
        }
    }

    public string InternFirstName => ManagerFormat.FirstName(SelectedIntern?.Name);

    /// <summary>The queue's date. Change it with the stepper or the Today / Tomorrow chips.</summary>
    public DateOnly Date => _date;

    /// <summary>"Fri 30 Oct 2026".</summary>
    public string DateLabel => ManagerFormat.LongDate(Date);

    public bool IsToday => Date == S.Clock.Today;
    public bool IsTomorrow => Date == S.Clock.Today.AddDays(1);

    public AsyncRelayCommand PreviousDayCommand { get; }
    public AsyncRelayCommand NextDayCommand { get; }
    public AsyncRelayCommand TodayCommand { get; }
    public AsyncRelayCommand TomorrowCommand { get; }

    // ------------------------------------------------------------------ find properties (left)

    /// <summary>Live search of the property folders; empty → all.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (Set(ref _searchText, value ?? "")) Fire(RunSearchAsync);
        }
    }

    public ObservableCollection<AssignCandidateRowViewModel> Candidates { get; } = new();
    public bool HasCandidates => Candidates.Count > 0;
    public bool HasNoCandidates => !HasCandidates;

    /// <summary>"Showing 14 folders — type to narrow the list."</summary>
    public string SearchFooter { get => _searchFooter; private set => Set(ref _searchFooter, value); }

    /// <summary>Shown when the search finds nothing.</summary>
    public string SearchEmptyText { get => _searchEmptyText; private set => Set(ref _searchEmptyText, value); }

    // ------------------------------------------------------------------ the queue (middle)

    public ObservableCollection<QueueDraftRowViewModel> Draft { get; } = new();
    public bool IsQueueEmpty => Draft.Count == 0;
    public bool HasQueueItems => Draft.Count > 0;

    /// <summary>"5 properties · in posting order".</summary>
    public string QueueCountText => $"{ManagerFormat.Count(Draft.Count, "property", "properties")} · in posting order";

    /// <summary>"Jan sees this list under My Queue on Fri 30 Oct."</summary>
    public string QueueHint => SelectedIntern is null
        ? "Add interns in Settings to give them a queue."
        : $"{InternFirstName} sees this list under My Queue on {ManagerFormat.ShortDate(Date)}.";

    /// <summary>The draft differs from the saved queue (names or order).</summary>
    public bool IsDirty =>
        !Draft.Select(r => PropertyNameMatcher.Normalize(r.Name))
              .SequenceEqual(_saved.Select(i => PropertyNameMatcher.Normalize(i.Name)));

    public string SaveStateText => IsDirty ? "Unsaved changes" : "";

    public AsyncRelayCommand SaveCommand { get; }
    public RelayCommand UndoCommand { get; }

    // ------------------------------------------------------------------ paste a list (right)

    public string PasteText
    {
        get => _pasteText;
        set => Set(ref _pasteText, value ?? "");
    }

    public ObservableCollection<PasteMatchRowViewModel> Matches { get; } = new();
    public bool HasMatches => Matches.Count > 0;

    /// <summary>"5 of 6 found".</summary>
    public string MatchSummary { get => _matchSummary; private set => Set(ref _matchSummary, value); }

    /// <summary>Exact matches that may be added and aren't in the draft yet.</summary>
    public int AddableMatchCount
    {
        get => _addableMatchCount;
        private set { if (Set(ref _addableMatchCount, value)) Raise(nameof(AddAllLabel)); }
    }

    /// <summary>"Add 5 matched to the queue".</summary>
    public string AddAllLabel => AddableMatchCount > 0
        ? $"Add {AddableMatchCount} matched to the queue"
        : "Matches are in the queue";

    /// <summary>"5 names were added to Jan's queue. Save to keep them." — empty when hidden.</summary>
    public string AddedMessage { get => _addedMessage; private set => Set(ref _addedMessage, value); }

    public AsyncRelayCommand MatchCommand { get; }
    public RelayCommand AddAllMatchedCommand { get; }

    // ------------------------------------------------------------------ loading

    public override Task LoadAsync() => ReloadAsync();

    private async Task ReloadAsync()
    {
        await LoadQueueAsync();
        await RunSearchAsync();
    }

    private async Task LoadQueueAsync()
    {
        var version = ++_queueVersion;
        var intern = SelectedIntern;
        var date = Date;
        if (intern is null)
        {
            _saved = new List<SavedQueueItem>();
            ResetDraft();
            return;
        }

        var view = await S.Assignments.GetQueueAsync(intern.Name, date);
        if (version != _queueVersion) return; // the intern or date changed while loading

        _saved = view.Items
            .Select(i => new SavedQueueItem(i.Assignment.PropertyName, i.Property?.Category, i.Assignment.Status))
            .ToList();
        ResetDraft();
    }

    private async Task RunSearchAsync()
    {
        var version = ++_searchVersion;
        var intern = SelectedIntern;
        var query = SearchText;
        IReadOnlyList<AssignCandidate> results = intern is null
            ? Array.Empty<AssignCandidate>()
            : await S.Assignments.SearchCandidatesAsync(query, intern.Name, Date);
        if (version != _searchVersion) return; // a newer search is on its way

        Candidates.Clear();
        foreach (var c in results) Candidates.Add(new AssignCandidateRowViewModel(c, AddCandidate));
        RefreshDraftState();

        var q = query.Trim();
        SearchFooter = q.Length == 0
            ? $"Showing {ManagerFormat.Count(Candidates.Count, "folder", "folders")} — type to narrow the list."
            : $"{ManagerFormat.Count(Candidates.Count, "folder matches", "folders match")} “{q}”.";
        SearchEmptyText = intern is null
            ? "Add an intern in Settings first."
            : q.Length == 0 ? "No property folders found. Check the properties folder in Settings." : $"No property folders match “{q}”.";
        Raise(nameof(HasCandidates), nameof(HasNoCandidates));
    }

    // ------------------------------------------------------------------ editing the draft

    private void AddCandidate(AssignCandidateRowViewModel row)
    {
        if (!row.Check.CanAdd) return;
        AddToDraft(row.Property);
    }

    /// <summary>Adds the property at the end of the draft unless it's already there. True when added.</summary>
    private bool AddToDraft(PropertySummary property)
    {
        if (InDraft(property.Name)) return false;
        Draft.Add(NewRow(property.Name, property.Category, null));
        RefreshDraftState();
        return true;
    }

    private void MoveRow(QueueDraftRowViewModel row, int delta)
    {
        var from = Draft.IndexOf(row);
        var to = from + delta;
        if (from < 0 || to < 0 || to >= Draft.Count) return;
        Draft.Move(from, to);
        RefreshDraftState();
    }

    private void RemoveRow(QueueDraftRowViewModel row)
    {
        if (row.IsStarted) return;
        Draft.Remove(row);
        RefreshDraftState();
    }

    private void Undo()
    {
        ResetDraft();
        AddedMessage = "";
    }

    private void ResetDraft()
    {
        Draft.Clear();
        foreach (var item in _saved) Draft.Add(NewRow(item.Name, item.Category, item.Status));
        RefreshDraftState();
    }

    private QueueDraftRowViewModel NewRow(string name, string? category, AssignmentStatus? status) =>
        new(name, category, status, MoveRow, RemoveRow);

    private bool InDraft(string name) => Draft.Any(r => ManagerFormat.SameProperty(r.Name, name));

    /// <summary>Renumbers the draft and updates everything that depends on it.</summary>
    private void RefreshDraftState()
    {
        for (var i = 0; i < Draft.Count; i++)
        {
            Draft[i].Number = i + 1;
            Draft[i].IsFirst = i == 0;
            Draft[i].IsLast = i == Draft.Count - 1;
        }
        foreach (var c in Candidates) c.IsInDraft = InDraft(c.Name);
        AddableMatchCount = Matches.Count(m => m.IsAddableExact && !InDraft(m.Match.Property!.Name));
        Raise(nameof(IsQueueEmpty), nameof(HasQueueItems), nameof(QueueCountText), nameof(IsDirty), nameof(SaveStateText));
    }

    // ------------------------------------------------------------------ save

    private async Task SaveAsync()
    {
        var intern = SelectedIntern;
        if (intern is null) return;
        var date = Date;
        var names = Draft.Select(r => r.Name).ToList();

        await S.Assignments.SaveQueueAsync(intern.Name, date, names);

        var count = names.Count == 0 ? "no properties" : ManagerFormat.Count(names.Count, "property", "properties");
        S.Notifier.Notify($"Saved. {ManagerFormat.FirstName(intern.Name)} has {count} for {ManagerFormat.ShortDate(date)}.");
        AddedMessage = "";
        await ReloadAsync();
    }

    // ------------------------------------------------------------------ paste a list

    private async Task MatchAsync()
    {
        var intern = SelectedIntern;
        if (intern is null) return;
        var results = await S.Assignments.MatchPastedListAsync(PasteText, intern.Name, Date);

        Matches.Clear();
        foreach (var m in results) Matches.Add(new PasteMatchRowViewModel(m, UseSuggestion));
        AddedMessage = "";
        UpdateMatchSummary();
        RefreshDraftState();
        Raise(nameof(HasMatches));
    }

    private void UseSuggestion(PasteMatchRowViewModel row)
    {
        var property = row.Match.Property;
        var check = row.Match.Check;
        if (property is null || check is null) return;
        if (!check.CanAdd)
        {
            S.Notifier.Notify($"Can't add {property.Name}: {ManagerFormat.LowerFirst(check.Message)}.", ToastKind.Warning);
            return;
        }
        AddToDraft(property);
        row.MarkUsed();
        UpdateMatchSummary();
        RefreshDraftState();
    }

    private void AddAllMatched()
    {
        var added = 0;
        foreach (var m in Matches.Where(m => m.IsAddableExact).ToList())
            if (AddToDraft(m.Match.Property!)) added++;
        if (added == 0) return;
        AddedMessage = added == 1
            ? $"1 name was added to {InternFirstName}'s queue. Save to keep it."
            : $"{added} names were added to {InternFirstName}'s queue. Save to keep them.";
    }

    private void UpdateMatchSummary() =>
        MatchSummary = Matches.Count == 0 ? "" : $"{Matches.Count(m => m.IsFound)} of {Matches.Count} found";

    private void ClearMatches()
    {
        Matches.Clear();
        MatchSummary = "";
        AddedMessage = "";
        AddableMatchCount = 0;
        Raise(nameof(HasMatches));
    }

    // ------------------------------------------------------------------ switching intern / date

    private async Task ChangeDateAsync(DateOnly date)
    {
        if (date == _date) return;
        if (!ConfirmDiscard())
        {
            Raise(nameof(IsToday), nameof(IsTomorrow)); // un-tick a chip the user clicked
            return;
        }
        _date = date;
        Raise(nameof(Date), nameof(DateLabel), nameof(IsToday), nameof(IsTomorrow), nameof(QueueHint));
        ClearMatches();
        await ReloadAsync();
    }

    /// <summary>True when there's nothing to lose or the manager agrees to discard the unsaved draft.</summary>
    private bool ConfirmDiscard()
    {
        if (!IsDirty) return true;
        _confirming = true; // the dialog pumps messages; ignore selection changes meanwhile
        try
        {
            return S.Ui.Confirm("Discard changes?",
                $"You have unsaved changes to {InternFirstName}'s queue for {ManagerFormat.ShortDate(Date)}. Discard them?",
                "Discard");
        }
        finally
        {
            _confirming = false;
        }
    }

    /// <summary>
    /// Raises now and once more after the current UI event: a ComboBox that is still inside its own selection change
    /// can ignore the first notification and keep showing the rejected item. (No context in tests: raise once.)
    /// </summary>
    private void RaiseNowAndLater(string name)
    {
        Raise(name);
        SynchronizationContext.Current?.Post(_ => Raise(name), null);
    }

    /// <summary>Runs work started from a property setter; failures become an error toast.</summary>
    private async void Fire(Func<Task> work)
    {
        try { await work(); }
        catch (Exception ex) { OnError(ex); }
    }

    private sealed record SavedQueueItem(string Name, string? Category, AssignmentStatus Status);
}
