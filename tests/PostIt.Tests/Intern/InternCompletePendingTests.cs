using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;
using static PostIt.Tests.Intern.InternWorld;

namespace PostIt.Tests.Intern;

public class InternCompletePendingTests
{
    [Test]
    public async Task Pending_group_post_flow_end_to_end()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today,
            ("Seaside Residences 2BR", AssignmentStatus.ToPost),
            ("Casa Amara House & Lot", AssignmentStatus.ToPost));
        var key = QueueKey("Casa Amara House & Lot");

        // 1. Log the group post as Pending: no link needed yet.
        var log = new LogPostViewModel(app.Services(), app.Nav, "House & Lot/Casa Amara House & Lot", key);
        await log.LoadAsync();
        log.Status = PostStatus.Pending;
        Assert.True(log.CanSave);
        await log.SaveCommand.ExecuteAsync();

        Assert.Contains("Logged as Pending", app.Notifier.Last);
        Assert.Equal("MyQueue", app.Nav.Last);
        var pendingRow = app.Tracker.Posts.Last();
        Assert.Equal(PostStatus.Pending, pendingRow.Status);
        Assert.Equal("", pendingRow.PostLink);

        // 2. My Queue: pinned at the top, Add link leads to the complete-pending page.
        var queue = new MyQueueViewModel(app.Services(), app.Nav);
        await queue.LoadAsync();
        var pinned = queue.Items[0];
        Assert.True(pinned.IsPending);
        Assert.Equal("Casa Amara House & Lot", pinned.Name);
        Assert.Equal(1, queue.PendingCount);
        Assert.Equal(1, queue.ToPostCount);
        pinned.AddLinkCommand.Execute(null);
        Assert.Equal($"CompletePending:{pendingRow.Key}", app.Nav.Last);

        // 3. Add the live link.
        var complete = new CompletePendingViewModel(app.Services(), app.Nav, pendingRow.Key);
        Assert.Equal("Add the live link", complete.Title);
        Assert.Equal(NavKey.MyQueue, complete.Nav);
        await complete.LoadAsync();

        Assert.True(complete.CanEdit);
        Assert.False(complete.IsMissing);
        Assert.Equal("Casa Amara House & Lot", complete.PropertyName);
        Assert.Equal("APG Homes Cavite · Logged as Pending at 09:41 today", complete.Meta);
        Assert.False(complete.SaveCommand.CanExecute(null), "nothing pasted yet");

        complete.PostLink = Link;
        Assert.True(complete.SaveCommand.CanExecute(null));
        await complete.SaveCommand.ExecuteAsync();

        Assert.Equal(("Live link added — marked as Posted.", ToastKind.Success), app.Notifier.Messages.Last());
        Assert.Equal("RefreshBadges,MyQueue", string.Join(",", app.Nav.Calls.TakeLast(2)));
        var live = app.Tracker.Posts.Single(p => p.Key == pendingRow.Key);
        Assert.Equal(PostStatus.Posted, live.Status);
        Assert.Equal(Link, live.PostLink);
        Assert.Equal(AssignmentStatus.Posted, app.Tracker.Assignments.Single(a => a.Key == key).Status);

        // 4. Back in My Queue: no longer pinned.
        await queue.LoadAsync();
        Assert.Count(0, queue.PendingItems);
        Assert.Equal("Casa Amara House & Lot", queue.PostedItems.Single().Name);
        Assert.Equal("Seaside Residences 2BR", queue.ToPostItems.Single().Name);
    }

    [Test]
    public async Task A_bad_link_is_refused_and_kept_for_fixing()
    {
        var app = NewApp();
        var pending = app.AddPost("Casa Amara House & Lot", 1, PostStatus.Pending, category: "House & Lot", time: "16:05");

        var vm = new CompletePendingViewModel(app.Services(), app.Nav, pending.Key);
        await vm.LoadAsync();
        Assert.Equal("Logged as Pending at 16:05 on Wed 28 Oct", vm.LoggedText);

        vm.PostLink = "https://example.com/my-post";
        await vm.SaveCommand.ExecuteAsync();

        Assert.Equal(("The post link must be a facebook.com link.", ToastKind.Error), app.Notifier.Messages.Last());
        Assert.Equal("https://example.com/my-post", vm.PostLink);
        Assert.Equal(PostStatus.Pending, app.Tracker.Posts.Single(p => p.Key == pending.Key).Status);
        Assert.False(app.Nav.Calls.Contains("MyQueue"));
    }

    [Test]
    public async Task Paste_fills_the_link()
    {
        var app = NewApp();
        var pending = app.AddPost("Casa Amara House & Lot", 0, PostStatus.Pending, category: "House & Lot");
        var vm = new CompletePendingViewModel(app.Services(), app.Nav, pending.Key);
        await vm.LoadAsync();

        app.Ui.Clipboard = " " + Link;
        vm.PasteCommand.Execute(null);

        Assert.Equal(Link, vm.PostLink);
    }

    [Test]
    public async Task Missing_post_shows_an_error_and_no_form()
    {
        var app = NewApp();
        var vm = new CompletePendingViewModel(app.Services(), app.Nav, "9999");
        await vm.LoadAsync();

        Assert.True(vm.IsMissing);
        Assert.Equal("That post is no longer in the tracker.", vm.MissingMessage);
        Assert.False(vm.CanEdit);
        Assert.False(vm.PasteCommand.CanExecute(null));
        vm.PostLink = Link;
        Assert.False(vm.SaveCommand.CanExecute(null));

        vm.BackCommand.Execute(null);
        Assert.Equal("Back", app.Nav.Last);
    }

    [Test]
    public async Task Already_live_post_needs_nothing()
    {
        var app = NewApp();
        var live = app.AddPost("Seaside Residences 2BR", 0, category: "Condo");
        var vm = new CompletePendingViewModel(app.Services(), app.Nav, live.Key);
        await vm.LoadAsync();

        Assert.True(vm.IsAlreadyLive);
        Assert.False(vm.IsMissing);
        Assert.False(vm.CanEdit);
    }
}

/// <summary>The intern pages through the real shell and real services (page factories, loading, nav).</summary>
public class InternShellTests
{
    [Test]
    public void Intern_pages_open_and_load_through_the_shell()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today, ("Verdant Hills Lot 12", AssignmentStatus.ToPost), ("Seaside Residences 2BR", AssignmentStatus.ToPost));
        var shell = new ShellViewModel(app.Core(), app.Ui);

        shell.SignIn(TestApp.Jan);
        var queue = Assert.NotNull(shell.CurrentPage as MyQueueViewModel);
        Assert.Equal(2, queue.ToPostCount);
        Assert.Equal(2, shell.NavItems.Single(n => n.Key == NavKey.MyQueue).Count);

        queue.ToPostItems[0].OpenCommand.Execute(null);
        var property = Assert.NotNull(shell.CurrentPage as PropertyViewModel);
        Assert.True(property.IsLoaded);
        Assert.True(shell.NavItems.Single(n => n.Key == NavKey.MyQueue).IsActive, "opened from the queue: My Queue stays highlighted");

        property.NextCommand.Execute(null);
        var log = Assert.NotNull(shell.CurrentPage as LogPostViewModel);
        Assert.True(log.HasPreview);
        log.PostLink = Link;
        log.SaveCommand.Execute(null);

        var back = Assert.NotNull(shell.CurrentPage as MyQueueViewModel);
        Assert.Equal(1, back.PostedCount);
        Assert.Equal(1, shell.NavItems.Single(n => n.Key == NavKey.MyQueue).Count);
        Assert.Equal("Logged. The row is in the tracker sheet.", shell.Toast?.Text);

        shell.ShowSearch("seaside");
        var search = Assert.NotNull(shell.CurrentPage as SearchViewModel);
        Assert.Equal("Seaside Residences 2BR", search.Results.Single().Name);
        Assert.Equal("Verdant Hills Lot 12", search.MyLogs.Single().Title);
    }
}
