using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;
using static PostIt.Tests.Manager.ManagerTestKit;

namespace PostIt.Tests.Manager;

public class TrackerViewModelTests
{
    /// <summary>
    /// Today: Mika posted Antipolo (11:36), Jan has Casa Amara pending (10:31) and posted Lot 3 (10:17).
    /// Queues: Jan 3 items (1 posted, 1 pending, 1 to post), Mika 1 (done), Bea none.
    /// Never posted: Greenfield, Imus, Lakeshore, Seaside (in Jan's queue), Sta. Rosa. Due: Mabini 32 days, Lot 12 26 days.
    /// </summary>
    private static async Task<(TestApp App, TrackerViewModel Vm)> Open()
    {
        var app = new TestApp();
        app.Session.User = TestApp.Manager;
        var s = app.Settings.Current.Clone();
        s.Users.Add(new AppUser("Bea Lim", UserRole.Intern));
        app.Settings.Save(s);

        foreach (var name in new[] { "Verdant Hills Lot 12", "Verdant Hills Lot 3", "Mabini Commercial Space", "Seaside Residences 2BR",
                     "Sta. Rosa Lot 22", "Antipolo Ridge Lot 18", "Casa Amara House & Lot", "Greenfield Farm Lot",
                     "Imus Townhomes Phase 2", "Lakeshore Villas Unit 7" })
            app.AddProperty(name);
        app.AddPost("Verdant Hills Lot 12", 26);
        app.AddPost("Verdant Hills Lot 3", 21);
        app.AddPost("Mabini Commercial Space", 32);
        app.AddPost("Antipolo Ridge Lot 18", 0, time: "11:36", by: Mika, account: "APG Properties PH");
        app.AddPost("Verdant Hills Lot 3", 0, time: "10:17");
        app.AddPost("Casa Amara House & Lot", 0, PostStatus.Pending, time: "10:31");

        SetQueue(app, Jan, Today,
            ("Casa Amara House & Lot", AssignmentStatus.Pending),
            ("Verdant Hills Lot 3", AssignmentStatus.Posted),
            ("Seaside Residences 2BR", AssignmentStatus.ToPost));
        SetQueue(app, Mika, Today, ("Antipolo Ridge Lot 18", AssignmentStatus.Posted));

        var vm = new TrackerViewModel(app.Services(), app.Nav);
        await vm.LoadAsync();
        return (app, vm);
    }

    [Test]
    public async Task Stat_tiles_summarise_the_day()
    {
        var (_, vm) = await Open();

        Assert.Equal("Tracker", vm.Title);
        Assert.Equal(NavKey.Tracker, vm.Nav);
        Assert.Equal("Thu 29 Oct 2026", vm.DateLabel);
        Assert.Equal(2, vm.PostedCount);
        Assert.Equal("Posted today", vm.PostedLabel);
        Assert.Equal(1, vm.PendingCount);
        Assert.Equal("1", vm.InternsDoneText);
        Assert.Equal(" of 2", vm.InternsOfText);
        Assert.Equal(2, vm.DueCount);
        Assert.Equal("Due for repost · 14+ days", vm.DueLabel);
        Assert.Equal(5, vm.NeverCount);
    }

    [Test]
    public async Task Posts_table_lists_the_days_rows_newest_first()
    {
        var (app, vm) = await Open();

        Assert.Equal("Today's posts", vm.PostsTitle);
        Assert.Equal("Thu 29 Oct 2026 · newest first", vm.PostsSubtitle);
        Assert.Equal("11:36,10:31,10:17", string.Join(",", vm.Posts.Select(p => p.Time)));

        var posted = vm.Posts[0];
        Assert.Equal("Antipolo Ridge Lot 18", posted.Property);
        Assert.Equal("Mika", posted.Intern);
        Assert.Equal("APG Properties PH", posted.Account);
        Assert.Equal("Posted", posted.StatusText);
        Assert.Equal("ok", posted.StatusKind);
        Assert.True(posted.HasLink);
        posted.OpenLinkCommand.Execute(null);
        Assert.Equal("url:" + posted.Link, app.Ui.Opened.Single());

        var pending = vm.Posts[1];
        Assert.Equal("Pending", pending.StatusText);
        Assert.Equal("pending", pending.StatusKind);
        Assert.True(pending.HasNoLink);
        Assert.False(pending.OpenLinkCommand.CanExecute(null));
        Assert.False(vm.HasNoPosts);
    }

    [Test]
    public async Task Whos_done_shows_each_interns_progress()
    {
        var (app, vm) = await Open();

        Assert.Equal("Jan Dela Cruz,Mika Reyes,Bea Lim", string.Join(",", vm.Interns.Select(i => i.Name)));

        var jan = vm.Interns[0];
        Assert.Equal("1 / 3 · 1 pending", jan.ProgressText);
        Assert.Equal(1.0 / 3, jan.ProgressValue);
        Assert.False(jan.IsDone);
        Assert.Equal("JD", jan.Initials);
        Assert.Equal("Queue", jan.QueueLinkText);

        var mika = vm.Interns[1];
        Assert.Equal("1 / 1", mika.ProgressText);
        Assert.Equal(1.0, mika.ProgressValue);
        Assert.True(mika.IsDone);

        var bea = vm.Interns[2];
        Assert.Equal("Not assigned", bea.ProgressText);
        Assert.Equal(0.0, bea.ProgressValue);
        Assert.False(bea.IsDone);
        Assert.Equal("Assign", bea.QueueLinkText);

        jan.QueueCommand.Execute(null);
        Assert.Equal("Assign:Jan Dela Cruz|2026-10-29", app.Nav.Last);
    }

    [Test]
    public async Task Needs_attention_lists_the_first_six_with_a_count()
    {
        var (app, vm) = await Open();

        Assert.Equal("6 of 7", vm.AttentionCountText);
        Assert.Equal("Greenfield Farm Lot,Imus Townhomes Phase 2,Lakeshore Villas Unit 7,Seaside Residences 2BR,Sta. Rosa Lot 22,Mabini Commercial Space",
            string.Join(",", vm.Attention.Select(a => a.Name)));

        var never = vm.Attention[0];
        Assert.Equal("Never posted", never.BadgeText);
        Assert.Equal("cool", never.BadgeKind);
        Assert.Equal("Not assigned", never.Detail);
        Assert.Equal("In Jan's queue", vm.Attention[3].Detail);

        var due = vm.Attention[5];
        Assert.Equal("Due", due.BadgeText);
        Assert.Equal("pending", due.BadgeKind);
        Assert.Equal("Last posted 32 days ago", due.Detail);

        vm.AssignCommand.Execute(null);
        Assert.Equal("Assign:|2026-10-30", app.Nav.Last, "plans the next day");
    }

    [Test]
    public async Task Stepping_the_date_reloads_that_day()
    {
        var (app, vm) = await Open();
        Assert.False(vm.TodayCommand.CanExecute(null));
        app.AddPost("Mabini Commercial Space", 1, time: "16:05", by: Mika);

        await vm.PreviousDayCommand.ExecuteAsync();

        Assert.Equal("Wed 28 Oct 2026", vm.DateLabel);
        Assert.True(vm.IsNotToday);
        Assert.Equal("Posted Wed 28 Oct", vm.PostedLabel);
        Assert.Equal("Posts on this day", vm.PostsTitle);
        Assert.Equal("16:05", string.Join(",", vm.Posts.Select(p => p.Time)));
        Assert.Equal(" of 0", vm.InternsOfText);
        Assert.True(vm.TodayCommand.CanExecute(null));

        await vm.TodayCommand.ExecuteAsync();
        Assert.True(vm.IsToday);
        Assert.Equal(2, vm.PostedCount);

        await vm.NextDayCommand.ExecuteAsync();
        Assert.Equal("Fri 30 Oct 2026", vm.DateLabel);
        Assert.True(vm.HasNoPosts);

        vm.AssignCommand.Execute(null);
        Assert.Equal("Assign:|2026-10-31", app.Nav.Last);
    }

    [Test]
    public async Task Refresh_picks_up_new_rows()
    {
        var (app, vm) = await Open();
        app.AddPost("Greenfield Farm Lot", 0, time: "12:01", by: Mika);

        await vm.RefreshCommand.ExecuteAsync();

        Assert.Equal(3, vm.PostedCount);
        Assert.Equal("12:01", vm.Posts[0].Time);
        Assert.Equal(4, vm.NeverCount);
    }

    [Test]
    public async Task Open_tracker_folder_opens_the_folder_from_settings()
    {
        var (app, vm) = await Open();
        vm.OpenTrackerFolderCommand.Execute(null);
        Assert.Equal("folder:/tracker", app.Ui.Opened.Single());
    }

    [Test]
    public async Task Empty_day_shows_empty_states()
    {
        var app = new TestApp();
        app.Session.User = TestApp.Manager;
        var vm = new TrackerViewModel(app.Services(), app.Nav);
        await vm.LoadAsync();

        Assert.True(vm.HasNoPosts);
        Assert.True(vm.HasNoAttention);
        Assert.Equal(0, vm.PostedCount);
        Assert.Equal("Not assigned", vm.Interns[0].ProgressText);
    }
}
