using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;
using static PostIt.Tests.Intern.InternWorld;

namespace PostIt.Tests.Intern;

public class InternLogPostTests
{
    private static async Task<LogPostViewModel> OpenLog(TestApp app, string propertyId, string? queueKey = null)
    {
        var vm = new LogPostViewModel(app.Services(), app.Nav, propertyId, queueKey);
        await vm.LoadAsync();
        return vm;
    }

    private static string Statuses(LogPostViewModel vm) => string.Join(",", vm.GuardChecks.Select(c => c.Status));

    [Test]
    public async Task Preview_lists_what_is_still_needed_and_the_row_written_for_you()
    {
        var app = NewApp();
        var vm = await OpenLog(app, "Lot/Verdant Hills Lot 12");

        Assert.Equal("Log this post", vm.Title);
        Assert.Equal(NavKey.Search, vm.Nav);
        Assert.Equal("Verdant Hills Lot 12 · Lot · Tagaytay", vm.Subtitle);
        Assert.Equal("APG Homes Cavite,APG Properties PH,Alpha Premier Listings", string.Join(",", vm.Accounts));
        Assert.Equal("APG Homes Cavite", vm.FbAccount, "no logs today: the first account");
        Assert.Equal(PostStatus.Posted, vm.Status);

        Assert.True(vm.ShowOk);
        Assert.False(vm.IsInCooldown);
        Assert.Equal("Verdant Hills Lot 12 was last posted 26 days ago (3 Oct) — outside the 7-day cooldown.", vm.OkMessage);
        Assert.Equal("ok", vm.GuardBadgeKind);
        Assert.Equal("OK to log", vm.GuardBadgeText);

        Assert.False(vm.CanSave);
        Assert.False(vm.SaveCommand.CanExecute(null));
        Assert.Equal("Paste the post link.", vm.Problems.Single());
        Assert.Equal("Still needed: Paste the post link.", vm.SaveHint);
        Assert.Equal("Pass,Warn,Pass", Statuses(vm));
        Assert.Equal("Outside the 7-day cooldown", vm.GuardChecks[0].Text);

        Assert.Equal("29 Oct 2026", vm.RowDate);
        Assert.Equal("Lot", vm.RowType);
        Assert.Equal("Verdant Hills Lot 12", vm.RowTitle);
        Assert.Equal("09:41", vm.RowTime);
        Assert.Equal("Posted", vm.RowStatus);
        Assert.Equal("ok", vm.RowStatusKind);
    }

    [Test]
    public async Task Preview_follows_every_input()
    {
        var app = NewApp();
        var vm = await OpenLog(app, "Lot/Verdant Hills Lot 12");

        vm.FbAccount = "  ";
        Assert.Equal("Still needed: Type the FB account name. Paste the post link.", vm.SaveHint);
        Assert.Equal("Pass,Warn,Warn", Statuses(vm));

        vm.FbAccount = "APG Homes Cavite";
        vm.PostLink = "https://example.com/posts/1";
        Assert.Equal("Pass,Fail,Pass", Statuses(vm));
        Assert.Equal("The post link must be a facebook.com link.", vm.GuardChecks[1].Text);
        Assert.Equal("The post link must be a facebook.com link.", vm.SaveHint);
        Assert.False(vm.CanSave);

        vm.FbAccount = "";
        Assert.Equal("Still needed: Type the FB account name. The post link must be a facebook.com link.", vm.SaveHint);
        vm.FbAccount = "APG Homes Cavite";

        vm.PostLink = Link;
        Assert.True(vm.CanSave);
        Assert.True(vm.SaveCommand.CanExecute(null));
        Assert.Equal("Saving writes the row to the tracker sheet.", vm.SaveHint);
        Assert.Equal("Pass,Pass,Pass", Statuses(vm));
        Assert.Equal("Post link is a facebook.com link", vm.GuardChecks[1].Text);

        vm.PostLink = "";
        vm.Status = PostStatus.Pending;
        Assert.True(vm.IsPendingStatus);
        Assert.True(vm.CanSave, "a pending group post has no link yet");
        Assert.Equal("Pending", vm.RowStatus);
        Assert.Equal("pending", vm.RowStatusKind);
        Assert.Equal("Pass,Pass,Pass", Statuses(vm));
    }

    [Test]
    public async Task Never_posted_property_is_ok_to_log()
    {
        var app = NewApp();
        var vm = await OpenLog(app, "Condo/Seaside Residences 2BR");

        Assert.Equal("Seaside Residences 2BR has never been posted.", vm.OkMessage);
        Assert.Equal("Never posted — no cooldown", vm.GuardChecks[0].Text);
    }

    [Test]
    public async Task Defaults_to_the_account_used_most_recently_today_and_shows_todays_stats()
    {
        var app = NewApp();
        app.AddPost("Casa Amara House & Lot", 0, category: "House & Lot", account: "Alpha Premier Listings", time: "08:00");
        app.AddPost("Seaside Residences 2BR", 0, category: "Condo", account: "APG Properties PH", time: "09:10");
        app.AddPost("Verdant Hills Lot 3", 0, account: "APG Homes Cavite", time: "09:30", by: Mika);
        SetQueue(app, Jan, Today,
            ("Seaside Residences 2BR", AssignmentStatus.Posted),
            ("Verdant Hills Lot 12", AssignmentStatus.ToPost),
            ("Casa Amara House & Lot", AssignmentStatus.Pending));

        var vm = await OpenLog(app, "Lot/Verdant Hills Lot 12", QueueKey("Verdant Hills Lot 12"));

        Assert.Equal("APG Properties PH", vm.FbAccount);
        Assert.Equal(2, vm.LoggedTodayCount);
        Assert.Equal(2, vm.StillInQueueCount);
        Assert.Equal("Seaside Residences 2BR,Casa Amara House & Lot", string.Join(",", vm.MyLogs.Select(l => l.Title)));
        Assert.Equal("Thu 29 Oct 2026", vm.TodayLabel);
        Assert.Equal(NavKey.MyQueue, vm.Nav);
    }

    [Test]
    public async Task Inside_the_cooldown_it_refuses_and_writes_nothing()
    {
        var app = NewApp();
        var vm = await OpenLog(app, "Lot/Verdant Hills Lot 7");
        vm.PostLink = Link;

        Assert.True(vm.IsInCooldown);
        Assert.False(vm.ShowOk);
        Assert.Equal("Not saved.", vm.CooldownLead);
        Assert.Equal("Verdant Hills Lot 7 was posted 2 days ago (27 Oct). The cooldown is 7 days — it can be posted again on Tue 3 Nov 2026.",
            vm.CooldownRest);
        Assert.Equal("The app will not save a post inside the cooldown.", vm.SaveHint);
        Assert.Equal("cool", vm.GuardBadgeKind);
        Assert.Equal("5 days left", vm.GuardBadgeText);
        Assert.Equal("Fail,Pass,Pass", Statuses(vm));
        Assert.Equal("Inside the 7-day cooldown · 5 days left", vm.GuardChecks[0].Text);
        Assert.Count(0, vm.OtherProblems);
        Assert.False(vm.SaveCommand.CanExecute(null));

        var rows = app.Tracker.Posts.Count;
        await vm.SaveCommand.ExecuteAsync();

        Assert.Equal(rows, app.Tracker.Posts.Count);
        Assert.False(app.Nav.Calls.Contains("MyQueue") || app.Nav.Calls.Contains("Search:"));
    }

    [Test]
    public async Task Save_refused_by_the_service_shows_the_reason_and_refreshes_the_preview()
    {
        var app = NewApp();
        var vm = await OpenLog(app, "Lot/Verdant Hills Lot 12");
        vm.PostLink = Link;
        Assert.True(vm.CanSave);

        // Meanwhile someone else logs the same property: the save must now be refused.
        app.AddPost("Verdant Hills Lot 12", 0, by: Mika);
        var rows = app.Tracker.Posts.Count;
        await vm.SaveCommand.ExecuteAsync();

        Assert.Equal(rows, app.Tracker.Posts.Count);
        var (message, kind) = app.Notifier.Messages.Last();
        Assert.Equal(ToastKind.Error, kind);
        Assert.Contains("Not saved. Verdant Hills Lot 12 was posted today", message);
        Assert.True(vm.IsInCooldown, "preview refreshed after the refusal");
        Assert.False(vm.CanSave);
        Assert.Equal(Link, vm.PostLink, "the intern's input is kept");
        Assert.False(app.Nav.Calls.Contains("MyQueue") || app.Nav.Calls.Contains("Search:"));
    }

    [Test]
    public async Task Save_from_the_queue_writes_the_row_closes_the_item_and_returns_to_my_queue()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today,
            ("Verdant Hills Lot 12", AssignmentStatus.ToPost),
            ("Seaside Residences 2BR", AssignmentStatus.ToPost));
        var key = QueueKey("Verdant Hills Lot 12");

        var vm = await OpenLog(app, "Lot/Verdant Hills Lot 12", key);
        vm.FbAccount = "APG Properties PH";
        vm.PostLink = Link;
        await vm.SaveCommand.ExecuteAsync();

        Assert.Equal(("Logged. The row is in the tracker sheet.", ToastKind.Success), app.Notifier.Messages.Last());
        Assert.Equal("RefreshBadges,MyQueue", string.Join(",", app.Nav.Calls.TakeLast(2)));

        var row = app.Tracker.Posts.Last();
        Assert.Equal(new PostLogEntry(row.Key, Today, new TimeOnly(9, 41), "Lot", "Verdant Hills Lot 12", PostStatus.Posted,
            "APG Properties PH", Link, Jan), row);
        Assert.Equal(AssignmentStatus.Posted, app.Tracker.Assignments.Single(a => a.Key == key).Status);

        var queue = new MyQueueViewModel(app.Services(), app.Nav);
        await queue.LoadAsync();
        var posted = queue.PostedItems.Single();
        Assert.Equal("Verdant Hills Lot 12", posted.Name);
        Assert.Equal("Posted 09:41 · APG Properties PH", posted.Meta);
        Assert.Equal("Seaside Residences 2BR", queue.ToPostItems.Single().Name);
        Assert.True(queue.ToPostItems.Single().IsPrimary);
        Assert.Equal("1 of 2 posted", queue.ProgressText);
    }

    [Test]
    public async Task A_closed_queue_item_cannot_be_logged_twice()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today, ("Seaside Residences 2BR", AssignmentStatus.Posted));
        var vm = await OpenLog(app, "Condo/Seaside Residences 2BR", QueueKey("Seaside Residences 2BR"));
        vm.PostLink = Link;

        Assert.False(vm.CanSave);
        Assert.Equal("This queue item is already closed.", vm.SaveHint);
    }

    [Test]
    public async Task Save_from_search_returns_to_search()
    {
        var app = NewApp();
        var vm = await OpenLog(app, "Condo/Seaside Residences 2BR");
        vm.PostLink = Link;
        await vm.SaveCommand.ExecuteAsync();

        Assert.Equal("Search:", app.Nav.Last);
        Assert.Equal("Seaside Residences 2BR", app.Tracker.Posts.Last().Title);
    }

    [Test]
    public async Task Only_the_newest_preview_is_applied()
    {
        var app = NewApp();
        var posting = new GatedPosting(app.Core().Posting);
        var vm = new LogPostViewModel(app.Services() with { Posting = posting }, app.Nav, "Lot/Verdant Hills Lot 12", null);
        await vm.LoadAsync();

        posting.HoldPreviews = true;
        vm.PostLink = "https://example.com/x";   // preview 0: bad link
        vm.PostLink = Link;                      // preview 1: fine
        Assert.Count(2, posting.Previews);

        posting.ReleasePreview(1);
        await Eventually(() => vm.CanSave);
        Assert.True(vm.CanSave);

        posting.ReleasePreview(0);               // late and stale: ignored
        await Task.Delay(30);
        Assert.True(vm.CanSave);
        Assert.Equal("Saving writes the row to the tracker sheet.", vm.SaveHint);
    }

    [Test]
    public async Task Paste_reads_the_clipboard()
    {
        var app = NewApp();
        var vm = await OpenLog(app, "Lot/Verdant Hills Lot 12");

        app.Ui.Clipboard = "  " + Link + "\n";
        vm.PasteCommand.Execute(null);
        Assert.Equal(Link, vm.PostLink);
        Assert.True(vm.CanSave);

        app.Ui.Clipboard = null;
        vm.PasteCommand.Execute(null);
        Assert.Equal(Link, vm.PostLink, "an empty clipboard changes nothing");
        Assert.Equal(ToastKind.Warning, app.Notifier.Messages.Last().Kind);
    }

    [Test]
    public async Task Missing_property_shows_an_error()
    {
        var app = NewApp();
        var vm = await OpenLog(app, "Lot/Gone");

        Assert.True(vm.HasLoadError);
        Assert.Equal("That property folder no longer exists.", vm.LoadError);
        Assert.False(vm.SaveCommand.CanExecute(null));
        Assert.False(vm.PasteCommand.CanExecute(null));
    }
}
