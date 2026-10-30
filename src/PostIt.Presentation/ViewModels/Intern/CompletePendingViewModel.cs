using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// A group post logged as Pending is approved: paste its live link. The tracker row becomes Posted
/// and the item leaves the top of My Queue.
/// </summary>
public sealed class CompletePendingViewModel : InternPageViewModel
{
    private readonly string _postKey;
    private PostLogEntry? _post;
    private bool _isLoaded;
    private string _postLink = "";

    public CompletePendingViewModel(AppServices s, INavigator n, string postKey) : base(s, n)
    {
        _postKey = postKey;
        SaveCommand = AsyncCommand(SaveAsync, () => CanEdit && _postLink.Trim().Length > 0);
        PasteCommand = Command(() => { if (ReadPastedLink() is { } link) PostLink = link; }, () => CanEdit);
        BackCommand = Command(() => Navigator.GoBack());
    }

    public override string Title => "Add the live link";
    public override NavKey Nav => NavKey.MyQueue;

    public AsyncRelayCommand SaveCommand { get; }
    public RelayCommand PasteCommand { get; }
    public RelayCommand BackCommand { get; }

    public bool IsLoaded => _isLoaded;

    /// <summary>The post was deleted from the tracker (or the key is stale).</summary>
    public bool IsMissing => _isLoaded && _post is null;
    public string MissingMessage => "That post is no longer in the tracker.";

    /// <summary>Someone already added the link.</summary>
    public bool IsAlreadyLive => _post?.Status == PostStatus.Posted;

    /// <summary>The form is shown only for a Pending row.</summary>
    public bool CanEdit => _post?.Status == PostStatus.Pending;

    public string PropertyName => _post?.Title ?? "";
    public string FbAccount => _post?.FbAccount ?? "";

    /// <summary>"Logged as Pending at 10:31 today" (or "… on Wed 28 Oct").</summary>
    public string LoggedText
    {
        get
        {
            if (_post is null) return "";
            var when = _post.Date == S.Clock.Today ? "today" : $"on {InternFormat.Date(_post.Date, "ddd d MMM")}";
            return $"Logged as Pending at {InternFormat.Time(_post.Time)} {when}";
        }
    }

    /// <summary>"APG Homes Cavite · Logged as Pending at 10:31 today".</summary>
    public string Meta => InternFormat.Join(FbAccount, LoggedText);

    public string PostLink
    {
        get => _postLink;
        set => Set(ref _postLink, value ?? "");
    }

    public override async Task LoadAsync()
    {
        _post = await S.Posting.GetPostAsync(_postKey);
        _isLoaded = true;
        Raise(string.Empty);
    }

    private async Task SaveAsync()
    {
        var result = await S.Posting.CompletePendingAsync(_postKey, _postLink);
        if (!result.Saved)
        {
            S.Notifier.Notify(result.Message, ToastKind.Error);   // keep what the intern pasted so they can fix it
            return;
        }

        S.Notifier.Notify(result.Message, ToastKind.Success);
        await Navigator.RefreshBadgesAsync();
        Navigator.ShowMyQueue();
    }
}
