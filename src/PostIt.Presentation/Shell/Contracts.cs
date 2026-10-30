using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation;

// ============================================================================
//  Contracts between page view-models, the shell and the WPF host.
// ============================================================================

public enum NavKey { None, MyQueue, Search, Assign, Tracker, Settings }

/// <summary>Navigation. Implemented by <see cref="ShellViewModel"/>.</summary>
public interface INavigator
{
    void SignIn(AppUser user);
    void SignOut();
    void ShowSearch(string? query = null);
    void ShowProperty(string propertyId, string? queueItemKey = null);
    void ShowLogPost(string propertyId, string? queueItemKey = null);
    void ShowCompletePending(string postKey);
    void ShowMyQueue();
    void ShowAssign(string? intern = null, DateOnly? date = null);
    void ShowTracker();
    void ShowSettings();

    /// <summary>Back to the previous page (or the role's home page).</summary>
    void GoBack();

    /// <summary>Re-reads the nav badge counts (e.g. the open items in My Queue).</summary>
    Task RefreshBadgesAsync();
}

public enum ToastKind { Info, Success, Warning, Error }

/// <summary>Toast messages at the bottom of the window. Implemented by <see cref="ShellViewModel"/>.</summary>
public interface INotifier
{
    void Notify(string message, ToastKind kind = ToastKind.Success);
}

/// <summary>Things only the WPF host can do. Implemented in PostIt.App (WpfUiServices); faked in tests.</summary>
public interface IUiServices
{
    void CopyText(string text);
    string? ReadClipboardText();
    void OpenFolder(string path);
    void OpenFile(string path);
    void OpenUrl(string url);
    string? PickFolder(string title, string? initialFolder = null);
    bool Confirm(string title, string message, string confirmLabel = "OK");

    /// <summary>The user's Downloads folder.</summary>
    string DownloadsFolder { get; }
}

/// <summary>The signed-in user (prototype: picked from the list in settings, no password).</summary>
public sealed class Session : ObservableObject
{
    private AppUser? _user;
    public AppUser? User { get => _user; set { if (Set(ref _user, value)) Raise(nameof(IsManager), nameof(IsIntern), nameof(Name)); } }
    public bool IsManager => User?.CanManage == true;
    public bool IsIntern => User?.Role == UserRole.Intern;
    public bool IsAdmin => User?.IsAdmin == true;
    public string Name => User?.Name ?? "";
}

/// <summary>Core services built by the composition root (App.xaml.cs) or by tests.</summary>
public sealed record CoreServices(
    IPostingService Posting,
    IAssignmentService Assignments,
    ITrackerService Tracker,
    ISettingsStore Settings,
    ISampleData SampleData,
    IClock Clock);

/// <summary>Everything a page view-model may use. Built by the shell.</summary>
public sealed record AppServices(
    IPostingService Posting,
    IAssignmentService Assignments,
    ITrackerService Tracker,
    ISettingsStore Settings,
    ISampleData SampleData,
    IClock Clock,
    IUiServices Ui,
    INotifier Notifier,
    Session Session,
    IBackendConnection? Backend = null);

/// <summary>Base class for every page shown in the shell's content area.</summary>
public abstract class PageViewModel : ViewModelBase
{
    protected PageViewModel(AppServices services, INavigator navigator)
    {
        S = services;
        Navigator = navigator;
    }

    protected AppServices S { get; }
    protected INavigator Navigator { get; }

    /// <summary>Shown in the top bar, e.g. "My Queue".</summary>
    public abstract string Title { get; }

    /// <summary>Which sidebar item is highlighted while this page is open.</summary>
    public abstract NavKey Nav { get; }

    /// <summary>Called by the shell right after navigation. Load data here (await services).</summary>
    public virtual Task LoadAsync() => Task.CompletedTask;

    protected override void OnError(Exception ex) =>
        S.Notifier.Notify(ex is UserFacingException ? ex.Message : $"Something went wrong: {ex.Message}", ToastKind.Error);
}
