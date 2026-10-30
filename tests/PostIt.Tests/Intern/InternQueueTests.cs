using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;
using static PostIt.Tests.Intern.InternWorld;

namespace PostIt.Tests.Intern;

public class InternQueueTests
{
    private static MyQueueViewModel NewQueue(TestApp app) => new(app.Services(), app.Nav);

    [Test]
    public async Task Loads_pending_first_then_to_post_then_posted_with_counts()
    {
        var app = NewApp();
        app.AddPost("Verdant Hills Lot 3", 0, time: "09:15");
        var pending = app.AddPost("Casa Amara House & Lot", 0, PostStatus.Pending, category: "House & Lot", time: "10:31");
        SetQueue(app, Jan, Today,
            ("Verdant Hills Lot 3", AssignmentStatus.Posted),
            ("Seaside Residences 2BR", AssignmentStatus.ToPost),
            ("Casa Amara House & Lot", AssignmentStatus.Pending),
            ("Verdant Hills Lot 12", AssignmentStatus.ToPost),
            ("Folder Since Deleted", AssignmentStatus.ToPost));

        var vm = NewQueue(app);
        await vm.LoadAsync();

        Assert.Equal("Casa Amara House & Lot,Seaside Residences 2BR,Verdant Hills Lot 12,Folder Since Deleted,Verdant Hills Lot 3",
            string.Join(",", vm.Items.Select(i => i.Name)));
        Assert.Equal("My Queue · Thu 29 Oct 2026", vm.Header);
        Assert.Equal(3, vm.ToPostCount);
        Assert.Equal(1, vm.PostedCount);
        Assert.Equal(1, vm.PendingCount);
        Assert.Equal(5, vm.TotalCount);
        Assert.Equal("1 of 5 posted", vm.ProgressText);
        Assert.Equal(0.2, vm.ProgressValue);
        Assert.Count(1, vm.PendingItems);
        Assert.Count(3, vm.ToPostItems);
        Assert.Count(1, vm.PostedItems);
        Assert.False(vm.IsEmpty);
        Assert.False(vm.AllDone);
        Assert.True(app.Nav.Calls.Contains("RefreshBadges"), "nav badge refreshed after load");

        // To post: numbered, the first one gets the gold Open button.
        var (seaside, lot12, missing) = (vm.ToPostItems[0], vm.ToPostItems[1], vm.ToPostItems[2]);
        Assert.Equal("1,2,3", string.Join(",", vm.ToPostItems.Select(i => i.Number)));
        Assert.True(seaside.ShowPrimaryOpen);
        Assert.False(seaside.ShowSecondaryOpen);
        Assert.True(lot12.ShowSecondaryOpen);
        Assert.False(lot12.ShowPrimaryOpen);
        Assert.Equal("Tagaytay · Never posted yet", seaside.Meta);
        Assert.Equal("Tagaytay · Last posted 3 Oct · 26 days ago", lot12.Meta);
        Assert.Equal("Condo", seaside.Category);
        Assert.False(lot12.IsInCooldown);

        lot12.OpenCommand.Execute(null);
        Assert.Equal($"Property:Lot/Verdant Hills Lot 12|{QueueKey("Verdant Hills Lot 12")}", app.Nav.Last);

        Assert.Equal("Folder not found — tell your manager", missing.Meta);
        Assert.False(missing.OpenCommand.CanExecute(null));

        // Pending: pinned, Add link goes to the complete-pending page for its tracker row.
        var pinned = vm.PendingItems[0];
        Assert.Equal("Group post awaiting approval · add the live link when it's up", pinned.Meta);
        Assert.True(pinned.AddLinkCommand.CanExecute(null));
        pinned.AddLinkCommand.Execute(null);
        Assert.Equal($"CompletePending:{pending.Key}", app.Nav.Last);

        // Posted: time and account, View post opens the link.
        var posted = vm.PostedItems[0];
        Assert.Equal("Posted 09:15 · APG Homes Cavite", posted.Meta);
        Assert.True(posted.HasLink);
        posted.ViewPostCommand.Execute(null);
        Assert.Equal("url:" + posted.Link, app.Ui.Opened.Last());

        // Right card: today's logs, newest first.
        Assert.Equal("Casa Amara House & Lot,Verdant Hills Lot 3", string.Join(",", vm.MyLogs.Select(l => l.Title)));
        Assert.Equal("APG Homes Cavite · 10:31", vm.MyLogs[0].Meta);
        Assert.Equal("pending", vm.MyLogs[0].BadgeKind);
        Assert.Equal("Posted", vm.MyLogs[1].StatusLabel);
    }

    [Test]
    public async Task Pending_without_its_tracker_row_cannot_add_a_link()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today, ("Seaside Residences 2BR", AssignmentStatus.Pending));

        var vm = NewQueue(app);
        await vm.LoadAsync();

        Assert.False(vm.PendingItems.Single().AddLinkCommand.CanExecute(null));
        Assert.Contains("tell your manager", vm.PendingItems.Single().Meta);
    }

    [Test]
    public async Task To_post_item_in_cooldown_shows_days_left()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today, ("Verdant Hills Lot 7", AssignmentStatus.ToPost));

        var vm = NewQueue(app);
        await vm.LoadAsync();

        var row = vm.ToPostItems.Single();
        Assert.True(row.IsInCooldown);
        Assert.Equal("Cooldown · 5 days left", row.CooldownText);
        Assert.True(row.OpenCommand.CanExecute(null), "it can still be opened to read");
    }

    [Test]
    public async Task Tomorrow_is_a_read_only_preview()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today, ("Verdant Hills Lot 3", AssignmentStatus.ToPost));
        SetQueue(app, Jan, Today.AddDays(1),
            ("Seaside Residences 2BR", AssignmentStatus.ToPost),
            ("Verdant Hills Lot 12", AssignmentStatus.ToPost));

        var vm = NewQueue(app);
        await vm.LoadAsync();
        Assert.Equal(1, vm.TotalCount);
        Assert.False(vm.IsPreview);

        vm.Day = MyQueueDay.Tomorrow;
        await vm.LoadAsync();

        Assert.True(vm.IsPreview);
        Assert.Equal("My Queue · Fri 30 Oct 2026", vm.Header);
        Assert.Equal("Seaside Residences 2BR,Verdant Hills Lot 12", string.Join(",", vm.Items.Select(i => i.Name)));
        Assert.True(vm.ShowPreviewHint);
        Assert.True(vm.Items.All(i => !i.ShowPrimaryOpen && !i.ShowSecondaryOpen), "no Open buttons in the preview");
        Assert.True(vm.Items.All(i => !i.OpenCommand.CanExecute(null)));
        Assert.False(vm.AllDone);

        vm.Day = MyQueueDay.Today;
        await vm.LoadAsync();
        Assert.Equal("Verdant Hills Lot 3", vm.Items.Single().Name);
        Assert.True(vm.Items.Single().ShowPrimaryOpen);
        Assert.False(vm.ShowPreviewHint);
    }

    [Test]
    public async Task Switching_day_reloads_by_itself()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today.AddDays(1), ("Seaside Residences 2BR", AssignmentStatus.ToPost));

        var vm = NewQueue(app);
        await vm.LoadAsync();
        Assert.True(vm.IsEmpty);

        vm.Day = MyQueueDay.Tomorrow;
        await Eventually(() => vm.TotalCount == 1);

        Assert.Equal("Seaside Residences 2BR", vm.Items.Single().Name);
        Assert.False(vm.IsEmpty);
    }

    [Test]
    public async Task Empty_queue_offers_search()
    {
        var app = NewApp();
        var vm = NewQueue(app);
        await vm.LoadAsync();

        Assert.True(vm.IsEmpty);
        Assert.False(vm.HasItems);
        Assert.Equal("Nothing in your queue for today.", vm.EmptyTitle);
        Assert.True(vm.NoMyLogs);
        Assert.Equal("0 of 0 posted", vm.ProgressText);

        vm.SearchCommand.Execute(null);
        Assert.Equal("Search:", app.Nav.Last);
    }

    [Test]
    public async Task All_done_when_nothing_is_left_to_post_or_pending()
    {
        var app = NewApp();
        app.AddPost("Seaside Residences 2BR", 0, category: "Condo", time: "09:05");
        app.AddPost("Casa Amara House & Lot", 0, category: "House & Lot", time: "09:30");
        SetQueue(app, Jan, Today,
            ("Seaside Residences 2BR", AssignmentStatus.Posted),
            ("Casa Amara House & Lot", AssignmentStatus.Posted));

        var vm = NewQueue(app);
        await vm.LoadAsync();

        Assert.True(vm.AllDone);
        Assert.Equal(1.0, vm.ProgressValue);
        Assert.Equal("2 of 2 posted", vm.ProgressText);
    }

    [Test]
    public async Task Refresh_reloads_the_queue()
    {
        var app = NewApp();
        var vm = NewQueue(app);
        await vm.LoadAsync();
        Assert.True(vm.IsEmpty);

        SetQueue(app, Jan, Today, ("Seaside Residences 2BR", AssignmentStatus.ToPost));
        await vm.RefreshCommand.ExecuteAsync();

        Assert.Equal(1, vm.ToPostCount);
        Assert.False(vm.IsEmpty);
    }

    [Test]
    public async Task Load_failure_from_a_setter_becomes_an_error_toast()
    {
        var app = NewApp();
        var services = app.Services() with { Assignments = new BrokenAssignments(app.Core().Assignments) };
        var vm = new MyQueueViewModel(services, app.Nav);

        vm.Day = MyQueueDay.Tomorrow;
        await Eventually(() => app.Notifier.Messages.Count > 0);

        Assert.Equal(ToastKind.Error, app.Notifier.Messages.Single().Kind);
        Assert.Contains("Posts.csv is open in Excel", app.Notifier.Last);
    }

    private sealed class BrokenAssignments(IAssignmentService inner) : IAssignmentService
    {
        public Task<QueueView> GetQueueAsync(string user, DateOnly date, CancellationToken ct = default) =>
            throw new UserFacingException("Posts.csv is open in Excel. Close it and try again.");
        public Task<IReadOnlyList<AssignCandidate>> SearchCandidatesAsync(string query, string user, DateOnly date, CancellationToken ct = default) => inner.SearchCandidatesAsync(query, user, date, ct);
        public Task<AssignCheck> CheckAsync(string propertyId, string user, DateOnly date, CancellationToken ct = default) => inner.CheckAsync(propertyId, user, date, ct);
        public Task<IReadOnlyList<PasteMatch>> MatchPastedListAsync(string text, string user, DateOnly date, CancellationToken ct = default) => inner.MatchPastedListAsync(text, user, date, ct);
        public Task SaveQueueAsync(string user, DateOnly date, IReadOnlyList<string> propertyNames, CancellationToken ct = default) => inner.SaveQueueAsync(user, date, propertyNames, ct);
        public Task<int> CountOpenAsync(string user, DateOnly date, CancellationToken ct = default) => inner.CountOpenAsync(user, date, ct);
    }
}
