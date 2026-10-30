using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;

namespace PostIt.Tests;

public class ShellTests
{
    private static ShellViewModel NewShell(TestApp app, string? lastUser = null)
    {
        var s = app.Settings.Current.Clone();
        s.LastUserName = lastUser;
        app.Settings.Save(s);
        // The shell only needs the services at construction; the page VMs are created lazily.
        var core = new CoreServices(new NotUsedPosting(), new CountingAssignments(), new NotUsedTracker(), app.Settings, app.SampleData, app.Clock);
        return new ShellViewModel(core, app.Ui);
    }

    [Test]
    public void Starts_on_sign_in_when_no_previous_user()
    {
        var shell = NewShell(new TestApp());
        shell.Start();
        Assert.True(shell.CurrentPage is SignInViewModel);
        Assert.False(shell.IsSignedIn);
        Assert.Count(0, shell.NavItems);
    }

    [Test]
    public void Intern_lands_on_my_queue_with_intern_nav()
    {
        var shell = NewShell(new TestApp(), "Jan Dela Cruz");
        shell.Start();
        Assert.True(shell.CurrentPage is MyQueueViewModel);
        Assert.Equal("My Queue,Search", string.Join(",", shell.NavItems.Select(n => n.Label)));
        Assert.True(shell.NavItems[0].IsActive);
        Assert.Equal(3, shell.NavItems[0].Count, "badge shows open queue items");
    }

    [Test]
    public void Manager_lands_on_tracker_with_manager_nav()
    {
        var shell = NewShell(new TestApp(), "Maria Santos");
        shell.Start();
        Assert.True(shell.CurrentPage is TrackerViewModel);
        Assert.Equal("Tracker,Assign,Search,Settings", string.Join(",", shell.NavItems.Select(n => n.Label)));
    }

    [Test]
    public void Back_returns_to_previous_page_and_home_resets_history()
    {
        var shell = NewShell(new TestApp(), "Jan Dela Cruz");
        shell.Start();
        shell.ShowSearch("verdant");
        shell.ShowProperty("Lot/Verdant Hills Lot 12");
        shell.GoBack();
        Assert.True(shell.CurrentPage is SearchViewModel);
        shell.GoBack();
        Assert.True(shell.CurrentPage is MyQueueViewModel);
        shell.GoBack();
        Assert.True(shell.CurrentPage is MyQueueViewModel, "home is the floor");
    }

    [Test]
    public void Sign_out_clears_last_user()
    {
        var app = new TestApp();
        var shell = NewShell(app, "Jan Dela Cruz");
        shell.Start();
        shell.SignOut();
        Assert.Null(app.Settings.Current.LastUserName);
        Assert.True(shell.CurrentPage is SignInViewModel);
    }

    [Test]
    public void Notify_sets_toast()
    {
        var shell = NewShell(new TestApp());
        shell.Notify("Saved", ToastKind.Success);
        Assert.Equal("Saved", shell.Toast?.Text);
    }

    // Minimal stand-ins so the shell can be tested before/independently of the real services.
    private sealed class CountingAssignments : IAssignmentService
    {
        public Task<int> CountOpenAsync(string user, DateOnly date, CancellationToken ct = default) => Task.FromResult(3);
        public Task<QueueView> GetQueueAsync(string user, DateOnly date, CancellationToken ct = default) => Task.FromResult(new QueueView(date, user, Array.Empty<QueueItem>(), 0, 0, 0));
        public Task<IReadOnlyList<AssignCandidate>> SearchCandidatesAsync(string query, string user, DateOnly date, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<AssignCandidate>>(Array.Empty<AssignCandidate>());
        public Task<AssignCheck> CheckAsync(string propertyId, string user, DateOnly date, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<PasteMatch>> MatchPastedListAsync(string text, string user, DateOnly date, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<PasteMatch>>(Array.Empty<PasteMatch>());
        public Task SaveQueueAsync(string user, DateOnly date, IReadOnlyList<string> propertyNames, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NotUsedPosting : IPostingService
    {
        public Task<IReadOnlyList<PropertySummary>> SearchAsync(string query, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<PropertySummary>>(Array.Empty<PropertySummary>());
        public Task<PropertyDetail> OpenAsync(string propertyId, CancellationToken ct = default) => throw new UserFacingException("not in this test");
        public Task<LogPreview> PreviewLogAsync(LogPostRequest request, CancellationToken ct = default) => throw new UserFacingException("not in this test");
        public Task<LogResult> LogPostAsync(LogPostRequest request, CancellationToken ct = default) => throw new UserFacingException("not in this test");
        public Task<LogResult> CompletePendingAsync(string postKey, string liveLink, CancellationToken ct = default) => throw new UserFacingException("not in this test");
        public Task<PostLogEntry?> GetPostAsync(string postKey, CancellationToken ct = default) => Task.FromResult<PostLogEntry?>(null);
        public Task<IReadOnlyList<PostLogEntry>> GetPostsByAsync(string user, DateOnly date, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<PostLogEntry>>(Array.Empty<PostLogEntry>());
        public Task<IReadOnlyList<string>> GetFbAccountsAsync(CancellationToken ct = default) => Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
        public void RefreshProperties() { }
    }

    private sealed class NotUsedTracker : ITrackerService
    {
        public Task<TrackerDashboard> GetDashboardAsync(DateOnly date, CancellationToken ct = default) => throw new UserFacingException("not in this test");
    }
}
