using System.Collections.ObjectModel;
using PostIt.Core;
using PostIt.Presentation.Mvvm;
using PostIt.Presentation.ViewModels;

namespace PostIt.Presentation;

public sealed class NavItem(NavKey key, string label, string glyph) : ObservableObject
{
    private bool _isActive;
    private int _count;

    public NavKey Key { get; } = key;
    public string Label { get; } = label;
    /// <summary>Segoe Fluent Icons / MDL2 glyph.</summary>
    public string Glyph { get; } = glyph;
    public bool IsActive { get => _isActive; set => Set(ref _isActive, value); }
    public int Count { get => _count; set { if (Set(ref _count, value)) Raise(nameof(HasCount)); } }
    public bool HasCount => Count > 0;
}

public sealed class ToastMessage(string text, ToastKind kind)
{
    public string Text { get; } = text;
    public ToastKind Kind { get; } = kind;
    public string KindName => Kind.ToString(); // "Info" | "Success" | "Warning" | "Error"
}

/// <summary>
/// The window: top bar, role-based sidebar, the current page and toasts.
/// Implements navigation and notifications for every page.
/// </summary>
public sealed class ShellViewModel : ViewModelBase, INavigator, INotifier
{
    private readonly Stack<Func<PageViewModel>> _back = new();
    private Func<PageViewModel>? _currentFactory;
    private PageViewModel? _currentPage;
    private ToastMessage? _toast;
    private int _toastVersion;

    public ShellViewModel(CoreServices core, IUiServices ui, IBackendConnection? backend = null)
    {
        Session = new Session();
        S = new AppServices(core.Posting, core.Assignments, core.Tracker, core.Settings, core.SampleData,
                            core.Clock, ui, this, Session, backend);
        NavigateCommand = Command<NavKey>(k => Navigate(k));
        SignOutCommand = Command(SignOut, () => Session.User is not null);
        DismissToastCommand = Command(() => Toast = null);

        // Settings can change under us (Settings page, sample-data reset): keep the top bar current.
        core.Settings.Changed += (_, _) => Raise(nameof(UsingSampleData), nameof(TodayLabel));
    }

    public AppServices S { get; }
    public Session Session { get; }

    public ObservableCollection<NavItem> NavItems { get; } = new();

    public PageViewModel? CurrentPage
    {
        get => _currentPage;
        private set { if (Set(ref _currentPage, value)) Raise(nameof(PageTitle), nameof(IsSignedIn)); }
    }

    public string PageTitle => CurrentPage?.Title ?? "";
    public bool IsSignedIn => Session.User is not null;

    public string Tagline => Session.IsManager
        ? "Assign the day’s postings, then watch them land in the tracker."
        : "Find it, copy the public text, post it, log the link.";

    public string UserLabel => Session.User is null ? "" : $"{Session.User.Name} · {Session.User.RoleLabel}";
    public string UserInitials => Session.User?.Initials ?? "";
    public bool UsingSampleData => S.Settings.Current.UsingSampleData;
    public string TodayLabel => S.Clock.Today.ToString("ddd d MMM yyyy");

    public ToastMessage? Toast { get => _toast; private set => Set(ref _toast, value); }

    public RelayCommand<NavKey> NavigateCommand { get; }
    public RelayCommand SignOutCommand { get; }
    public RelayCommand DismissToastCommand { get; }

    /// <summary>Called once by the host after construction.</summary>
    public void Start()
    {
        var last = S.Settings.Current.LastUserName;
        var user = S.Settings.Current.Users.FirstOrDefault(u => string.Equals(u.Name, last, StringComparison.OrdinalIgnoreCase));
        if (user is not null) SignIn(user);
        else Go(() => new SignInViewModel(S, this), remember: false);
    }

    // ------------------------------------------------------------------ INavigator

    public void SignIn(AppUser user)
    {
        Session.User = user;
        var s = S.Settings.Current.Clone();
        s.LastUserName = user.Name;
        S.Settings.Save(s);

        NavItems.Clear();
        if (user.CanManage)
        {
            NavItems.Add(new NavItem(NavKey.Tracker, "Tracker", ""));
            NavItems.Add(new NavItem(NavKey.Assign, "Assign", ""));
            NavItems.Add(new NavItem(NavKey.Search, "Search", ""));
            NavItems.Add(new NavItem(NavKey.Settings, "Settings", ""));
        }
        else
        {
            NavItems.Add(new NavItem(NavKey.MyQueue, "My Queue", ""));
            NavItems.Add(new NavItem(NavKey.Search, "Search", ""));
        }

        Raise(nameof(Tagline), nameof(UserLabel), nameof(UserInitials), nameof(IsSignedIn), nameof(UsingSampleData));
        _back.Clear();
        if (user.CanManage) ShowTracker(); else ShowMyQueue();
        _ = RefreshBadgesAsync();
    }

    public void SignOut()
    {
        Session.User = null;
        var s = S.Settings.Current.Clone();
        s.LastUserName = null;
        S.Settings.Save(s);
        NavItems.Clear();
        _back.Clear();
        Raise(nameof(Tagline), nameof(UserLabel), nameof(UserInitials), nameof(IsSignedIn));
        Go(() => new SignInViewModel(S, this), remember: false);
    }

    public void ShowSearch(string? query = null) => Go(() => new SearchViewModel(S, this, query));
    public void ShowProperty(string propertyId, string? queueItemKey = null) => Go(() => new PropertyViewModel(S, this, propertyId, queueItemKey));
    public void ShowLogPost(string propertyId, string? queueItemKey = null) => Go(() => new LogPostViewModel(S, this, propertyId, queueItemKey));
    public void ShowCompletePending(string postKey) => Go(() => new CompletePendingViewModel(S, this, postKey));
    public void ShowMyQueue() => Go(() => new MyQueueViewModel(S, this), resetHistory: true);
    public void ShowAssign(string? intern = null, DateOnly? date = null) => Go(() => new AssignViewModel(S, this, intern, date), resetHistory: true);
    public void ShowTracker() => Go(() => new TrackerViewModel(S, this), resetHistory: true);
    public void ShowSettings() => Go(() => new SettingsViewModel(S, this), resetHistory: true);

    public void GoBack()
    {
        if (_back.Count > 0) { Go(_back.Pop(), remember: false); return; }
        if (Session.IsManager) ShowTracker(); else ShowMyQueue();
    }

    public async Task RefreshBadgesAsync()
    {
        var queue = NavItems.FirstOrDefault(n => n.Key == NavKey.MyQueue);
        if (queue is null || Session.User is null) return;
        try { queue.Count = await S.Assignments.CountOpenAsync(Session.User.Name, S.Clock.Today); }
        catch { queue.Count = 0; }
    }

    // ------------------------------------------------------------------ INotifier

    public async void Notify(string message, ToastKind kind = ToastKind.Success)
    {
        var version = ++_toastVersion;
        Toast = new ToastMessage(message, kind);
        await Task.Delay(kind == ToastKind.Error ? 6000 : 3500);
        if (version == _toastVersion) Toast = null;
    }

    // ------------------------------------------------------------------ internals

    private void Navigate(NavKey key)
    {
        switch (key)
        {
            case NavKey.MyQueue: ShowMyQueue(); break;
            case NavKey.Search: ShowSearch(); break;
            case NavKey.Assign: ShowAssign(); break;
            case NavKey.Tracker: ShowTracker(); break;
            case NavKey.Settings: ShowSettings(); break;
        }
    }

    private void Go(Func<PageViewModel> factory, bool remember = true, bool resetHistory = false)
    {
        if (resetHistory) _back.Clear();
        else if (remember && _currentFactory is not null) _back.Push(_currentFactory);

        _currentFactory = factory;
        if (_currentPage is not null) _currentPage.PropertyChanged -= OnPagePropertyChanged;
        var page = factory();
        page.PropertyChanged += OnPagePropertyChanged;
        CurrentPage = page;
        foreach (var item in NavItems) item.IsActive = item.Key == page.Nav;
        Raise(nameof(UsingSampleData), nameof(TodayLabel));
        _ = LoadPageAsync(page);
    }

    // A page may set its Title after loading (the property page shows the property name).
    private void OnPagePropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.PropertyName) || e.PropertyName == nameof(PageViewModel.Title)) Raise(nameof(PageTitle));
    }

    private async Task LoadPageAsync(PageViewModel page)
    {
        try { await page.LoadAsync(); }
        catch (Exception ex)
        {
            Notify(ex is UserFacingException ? ex.Message : $"Could not load {page.Title}: {ex.Message}", ToastKind.Error);
        }
    }

    protected override void OnError(Exception ex) =>
        Notify(ex is UserFacingException ? ex.Message : ex.Message, ToastKind.Error);
}
