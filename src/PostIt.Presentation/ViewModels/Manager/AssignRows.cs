using System.Text.RegularExpressions;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

// Row view-models of the Assign screen: search results (left), the draft queue (middle), pasted-list matches (right).

/// <summary>A search result on the Assign screen, with whether it may go into the selected queue.</summary>
public sealed class AssignCandidateRowViewModel : ViewModelBase
{
    private static readonly Regex OtherQueue = new(@"^Already in (.+?)'s queue", RegexOptions.CultureInvariant);
    private bool _isInDraft;

    public AssignCandidateRowViewModel(AssignCandidate candidate, Action<AssignCandidateRowViewModel> add)
    {
        Candidate = candidate;
        AddCommand = Command(() => add(this), () => CanAddNow);

        var p = candidate.Property;
        var cooldown = candidate.Check.Cooldown;
        var lastPosted = cooldown.NeverPosted || cooldown.LastPosted is null
            ? null
            : $"last posted {ManagerFormat.DayMonth(cooldown.LastPosted.Value)}";
        Meta = candidate.Check.CanAdd ? ManagerFormat.Join(p.Category, p.Location, lastPosted) : ManagerFormat.Join(p.Category, p.Location);

        (BadgeText, BadgeKind) = candidate.Check switch
        {
            { Block: AssignBlock.InCooldown } c => ($"Cooldown · {ManagerFormat.Days(Math.Max(1, c.Cooldown.DaysLeft))} left", "cool"),
            { Block: AssignBlock.AssignedToSomeoneElse } c => (OtherQueueBadge(c.Message), "neutral"),
            { CanAdd: true, Cooldown.NeverPosted: true } => ("Never posted", "info"),
            { CanAdd: true, Cooldown.DueForRepost: true } => ("Due", "pending"),
            _ => ("", "neutral"),
        };
        CantAddText = candidate.Check.CanAdd ? "" : $"Can't add: {ManagerFormat.LowerFirst(candidate.Check.Message)}";
    }

    public AssignCandidate Candidate { get; }
    public PropertySummary Property => Candidate.Property;
    public AssignCheck Check => Candidate.Check;

    public string Name => Candidate.Property.Name;

    /// <summary>"Lot · Tagaytay · last posted 3 Oct".</summary>
    public string Meta { get; }

    public string BadgeText { get; }
    public string BadgeKind { get; }
    public bool HasBadge => BadgeText.Length > 0;
    public bool BadgeShowsDot => BadgeKind == "cool";

    /// <summary>"Can't add: in cooldown until Tue 3 Nov (5 days left)" — empty when it can be added.</summary>
    public string CantAddText { get; }

    /// <summary>Already in the draft queue → the row shows "Added" instead of the Add button.</summary>
    public bool IsInDraft
    {
        get => _isInDraft;
        set { if (Set(ref _isInDraft, value)) Raise(nameof(ShowAddButton), nameof(ShowCantAdd), nameof(CanAddNow)); }
    }

    public bool IsBlocked => !Check.CanAdd;
    public bool CanAddNow => Check.CanAdd && !IsInDraft;
    public bool ShowAddButton => !IsInDraft;
    public bool ShowCantAdd => IsBlocked && !IsInDraft;

    public RelayCommand AddCommand { get; }

    private static string OtherQueueBadge(string message)
    {
        var m = OtherQueue.Match(message ?? "");
        return m.Success ? $"In {m.Groups[1].Value}'s queue" : "In another queue";
    }
}

/// <summary>One property in the draft queue (middle card). Saved Pending/Posted items keep their status badge.</summary>
public sealed class QueueDraftRowViewModel : ViewModelBase
{
    private int _number;
    private bool _isFirst;
    private bool _isLast;

    public QueueDraftRowViewModel(string name, string? category, AssignmentStatus? savedStatus,
        Action<QueueDraftRowViewModel, int> move, Action<QueueDraftRowViewModel> remove)
    {
        Name = name;
        SavedStatus = savedStatus;
        CategoryText = string.IsNullOrWhiteSpace(category) ? "Folder not found" : category;
        CategoryKind = string.IsNullOrWhiteSpace(category) ? "cool" : "cat";
        MoveUpCommand = Command(() => move(this, -1), () => !IsFirst);
        MoveDownCommand = Command(() => move(this, +1), () => !IsLast);
        RemoveCommand = Command(() => remove(this), () => !IsStarted);
    }

    public string Name { get; }
    public string CategoryText { get; }
    public string CategoryKind { get; }

    /// <summary>Status in the saved queue; null for a property added in this session.</summary>
    public AssignmentStatus? SavedStatus { get; }

    /// <summary>The intern already posted it (or it awaits approval): it can't be removed.</summary>
    public bool IsStarted => SavedStatus is AssignmentStatus.Pending or AssignmentStatus.Posted;
    public bool HasStatus => IsStarted;
    public string StatusText => SavedStatus switch
    {
        AssignmentStatus.Posted => "Posted",
        AssignmentStatus.Pending => "Pending",
        _ => "",
    };
    public string StatusKind => SavedStatus == AssignmentStatus.Posted ? "ok" : "pending";

    public string RemoveToolTip => IsStarted ? "Already started — can't be removed" : "Remove from the queue";

    /// <summary>Posting order, 1-based.</summary>
    public int Number { get => _number; set => Set(ref _number, value); }
    public bool IsFirst { get => _isFirst; set => Set(ref _isFirst, value); }
    public bool IsLast { get => _isLast; set => Set(ref _isLast, value); }

    public RelayCommand MoveUpCommand { get; }
    public RelayCommand MoveDownCommand { get; }
    public RelayCommand RemoveCommand { get; }
}

/// <summary>One line of a pasted list, matched against the property folders.</summary>
public sealed class PasteMatchRowViewModel : ViewModelBase
{
    private CheckStatus _mark;
    private string _text = "";
    private string _subText = "";
    private bool _isSuggestion;
    private bool _isUsed;

    public PasteMatchRowViewModel(PasteMatch match, Action<PasteMatchRowViewModel> useIt)
    {
        Match = match;
        UseItCommand = Command(() => useIt(this), () => IsSuggestion);

        switch (match.Kind)
        {
            case PasteMatchKind.Exact when match.Check?.CanAdd == true:
                Mark = CheckStatus.Pass;
                Text = match.Property!.Name;
                break;
            case PasteMatchKind.Exact:
                Mark = CheckStatus.Fail;
                Text = match.Property!.Name;
                SubText = $"Can't add: {ManagerFormat.LowerFirst(match.Check?.Message)}";
                break;
            case PasteMatchKind.Suggestion:
                Mark = CheckStatus.Warn;
                Text = $"{match.Typed} — not found.";
                IsSuggestion = true;
                break;
            default:
                Mark = CheckStatus.Fail;
                Text = $"{match.Typed} — not found.";
                break;
        }
    }

    public PasteMatch Match { get; }
    public string Typed => Match.Typed;
    public string? PropertyName => Match.Property?.Name;

    /// <summary>Pass = ✓ green, Warn = ! amber (suggestion), Fail = ✕ red. Shown with the CheckGlyph/CheckBrush converters.</summary>
    public CheckStatus Mark { get => _mark; private set => Set(ref _mark, value); }

    public string Text { get => _text; private set => Set(ref _text, value); }

    /// <summary>"Can't add: …" or "You typed “…”" — empty when there's nothing to add.</summary>
    public string SubText { get => _subText; private set => Set(ref _subText, value); }

    /// <summary>Shows the "Did you mean …? [Use it]" line.</summary>
    public bool IsSuggestion { get => _isSuggestion; private set => Set(ref _isSuggestion, value); }

    public string SuggestionText => $"Did you mean {Match.Property?.Name}?";

    /// <summary>The suggestion was accepted with "Use it".</summary>
    public bool IsUsed { get => _isUsed; private set => Set(ref _isUsed, value); }

    /// <summary>Counts toward "x of y found".</summary>
    public bool IsFound => Match.Kind == PasteMatchKind.Exact || IsUsed;

    /// <summary>An exact match that may go into the queue ("Add n matched").</summary>
    public bool IsAddableExact => Match.Kind == PasteMatchKind.Exact && Match.Check?.CanAdd == true && Match.Property is not null;

    public RelayCommand UseItCommand { get; }

    /// <summary>After "Use it": the row reads as a match.</summary>
    internal void MarkUsed()
    {
        IsUsed = true;
        IsSuggestion = false;
        Mark = CheckStatus.Pass;
        Text = Match.Property?.Name ?? Match.Typed;
        SubText = $"You typed “{Match.Typed}”";
        Raise(nameof(IsFound));
    }
}
