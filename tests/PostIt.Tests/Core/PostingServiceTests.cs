using PostIt.Core;

namespace PostIt.Tests.CoreLogic;

public class PostingServiceTests
{
    private const string Jan = "Jan Dela Cruz";
    private const string Link = "https://www.facebook.com/groups/apghomescavite/posts/1084512730024318/";

    private static (TestApp App, IPostingService Posting) NewApp()
    {
        var app = new TestApp();
        app.AddProperty("Verdant Hills Lot 12");
        app.AddProperty("Verdant Hills Lot 7");
        app.AddProperty("Casa Amara House & Lot", "House & Lot");
        app.AddProperty("Seaside Residences 2BR", "Condo");
        return (app, app.Core().Posting);
    }

    private static LogPostRequest Request(string id, string link = Link, PostStatus status = PostStatus.Posted,
        string account = "APG Homes Cavite", string? queueKey = null) =>
        new(id, account, link, status, Jan, queueKey);

    private static PostLogEntry AddRow(TestApp app, string title, int daysAgo, string link, PostStatus status = PostStatus.Posted, string by = Jan, string time = "09:00") =>
        app.Tracker.AddPostAsync(new PostLogEntry("", TestApp.Today.AddDays(-daysAgo), TimeOnly.Parse(time), "Lot", title, status, "APG Homes Cavite", link, by)).Result;

    private static Assignment Queue(TestApp app, string property, AssignmentStatus status = AssignmentStatus.ToPost, string who = Jan)
    {
        var a = new Assignment(Assignment.MakeKey(TestApp.Today, who, property), TestApp.Today, who, property, status);
        var queue = app.Tracker.Assignments.Where(x => x.Date == TestApp.Today && x.AssignedTo == who).Append(a).ToList();
        app.Tracker.ReplaceQueueAsync(TestApp.Today, who, queue).Wait();
        return a;
    }

    // ---------------------------------------------------------------- search & open

    [Test]
    public async Task Search_matches_every_word_across_name_category_and_location()
    {
        var (app, posting) = NewApp();
        app.AddPost("Verdant Hills Lot 7", 2);

        var all = await posting.SearchAsync("");
        Assert.Equal("Casa Amara House & Lot|Seaside Residences 2BR|Verdant Hills Lot 12|Verdant Hills Lot 7", string.Join("|", all.Select(p => p.Name)));

        var seven = (await posting.SearchAsync("  VERDANT 7 ")).Single();
        Assert.Equal("Lot/Verdant Hills Lot 7", seven.Id);
        Assert.True(seven.Cooldown.InCooldown);
        Assert.Equal(5, seven.Cooldown.DaysLeft);

        Assert.Equal("Seaside Residences 2BR", (await posting.SearchAsync("condo tagaytay")).Single().Name);
        Assert.Equal("Casa Amara House & Lot", (await posting.SearchAsync("house & lot")).Single().Name);
        Assert.Count(3, await posting.SearchAsync("lot"));
        Assert.Count(0, await posting.SearchAsync("verdant pasay"));
        Assert.True((await posting.SearchAsync("seaside")).Single().Cooldown.NeverPosted);
    }

    [Test]
    public async Task Open_returns_split_text_checks_cooldown_and_history_newest_first()
    {
        var (app, posting) = NewApp();
        app.AddPost("Verdant Hills Lot 7", 20, time: "10:00");
        app.AddPost("Verdant Hills Lot 7", 2, time: "15:40");
        app.AddPost("Verdant Hills Lot 7", 2, time: "08:00");
        app.AddPost("Verdant Hills Lot 12", 1);

        var detail = await posting.OpenAsync("Lot/Verdant Hills Lot 7");

        Assert.Equal("Verdant Hills Lot 7", detail.Property.Name);
        Assert.True(detail.Text.HasInternalSection);
        Assert.DoesNotContain("Commission", detail.Text.PublicText);
        Assert.Count(4, detail.Checks);
        Assert.True(detail.Checks.All(c => c.Status == CheckStatus.Pass));
        Assert.True(detail.Cooldown.InCooldown);
        Assert.Equal("15:40,08:00,10:00", string.Join(",", detail.History.Select(h => h.Time.ToString("HH:mm"))));
        Assert.Null(detail.DocWarning);
    }

    [Test]
    public async Task Open_explains_missing_docs_and_fills_category_from_the_doc()
    {
        var (app, posting) = NewApp();
        app.Properties.Add("Bare Lot", "Lot", doc: "");
        app.Properties.Add("Loose Condo", "Uncategorized", doc: "Type: Condo\nLocation: Pasay\n\nBay view");

        var bare = await posting.OpenAsync("Lot/Bare Lot");
        Assert.Equal("No posting doc (.txt, .md or .docx) found in this folder.", bare.DocWarning);
        Assert.Equal(CheckStatus.Warn, bare.Checks[0].Status);

        var loose = await posting.OpenAsync("Uncategorized/Loose Condo");
        Assert.Equal("Condo", loose.Property.Category);
        Assert.Equal("Condo", (await posting.PreviewLogAsync(Request("Uncategorized/Loose Condo"))).Row.Type);

        var ex = await Assert.ThrowsAsync<UserFacingException>(() => posting.OpenAsync("Lot/Gone"));
        Assert.Equal("That property folder no longer exists.", ex.Message);
    }

    [Test]
    public async Task Open_warns_about_a_Google_Docs_shortcut()
    {
        using var disk = new DiskApp();
        disk.UseFolders();
        disk.Temp.Write("props/Lot/Drive Lot/Posting.gdoc", "{}");
        disk.Temp.Write("props/Lot/Drive Lot/photo-1.jpg");

        var detail = await disk.Posting.OpenAsync("Lot/Drive Lot");

        Assert.Equal("This folder only has a Google Docs shortcut (.gdoc). The prototype reads .txt, .md or .docx — export the doc into the folder.", detail.DocWarning);
        Assert.Equal("", detail.Text.PublicText);
    }

    // ---------------------------------------------------------------- preview

    [Test]
    public async Task Preview_writes_the_row_for_the_intern()
    {
        var (app, posting) = NewApp();
        app.Clock.Now = new TimeOnly(9, 41, 37);

        var preview = await posting.PreviewLogAsync(Request("House & Lot/Casa Amara House & Lot", link: "  " + Link + " ", account: " APG Homes Cavite "));

        Assert.True(preview.CanSave);
        Assert.Count(0, preview.Problems);
        Assert.Equal(new PostLogEntry("", TestApp.Today, new TimeOnly(9, 41), "House & Lot", "Casa Amara House & Lot", PostStatus.Posted, "APG Homes Cavite", Link, Jan), preview.Row);
        Assert.True(preview.Cooldown.NeverPosted);
    }

    [Test]
    public async Task Preview_lists_every_problem_in_order()
    {
        var (app, posting) = NewApp();
        app.AddPost("Verdant Hills Lot 7", 2);

        var preview = await posting.PreviewLogAsync(Request("Lot/Verdant Hills Lot 7", link: "", account: "  "));

        Assert.False(preview.CanSave);
        Assert.Equal("Type the FB account name.", preview.Problems[0]);
        Assert.Equal("Paste the post link.", preview.Problems[1]);
        Assert.Equal("Not saved. Verdant Hills Lot 7 was posted 2 days ago (27 Oct). The cooldown is 7 days — it can be posted again on Tue 3 Nov 2026.", preview.Problems[2]);
        Assert.Count(3, preview.Problems);
    }

    [Test]
    public async Task Cooldown_message_for_yesterday_and_today()
    {
        var (app, posting) = NewApp();
        app.AddPost("Verdant Hills Lot 12", 1);
        app.AddPost("Seaside Residences 2BR", 0, PostStatus.Pending);

        var yesterday = await posting.PreviewLogAsync(Request("Lot/Verdant Hills Lot 12"));
        Assert.Equal("Not saved. Verdant Hills Lot 12 was posted 1 day ago (28 Oct). The cooldown is 7 days — it can be posted again on Wed 4 Nov 2026.", yesterday.Problems.Single());

        var today = await posting.PreviewLogAsync(Request("Condo/Seaside Residences 2BR"));
        Assert.Equal("Not saved. Seaside Residences 2BR was posted today (29 Oct). The cooldown is 7 days — it can be posted again on Thu 5 Nov 2026.", today.Problems.Single());
    }

    [Test]
    public async Task Links_must_be_Facebook_links()
    {
        var (_, posting) = NewApp();
        var id = "Lot/Verdant Hills Lot 12";

        foreach (var bad in new[] { "https://example.com/groups/x/posts/1", "facebook.com/groups/x/posts/1", "ftp://facebook.com/x", "not a link", "https://facebook.com.evil.io/x" })
            Assert.Equal("The post link must be a facebook.com link.", (await posting.PreviewLogAsync(Request(id, link: bad))).Problems.Single(), bad);

        foreach (var good in new[] { "https://facebook.com/x/posts/1", "http://www.facebook.com/x/posts/2", "https://m.facebook.com/story.php?id=3",
                     "https://web.facebook.com/groups/x/posts/4", "https://fb.com/5", "https://fb.me/abc", "https://WWW.FACEBOOK.COM/x/posts/6" })
            Assert.True((await posting.PreviewLogAsync(Request(id, link: good))).CanSave, good);
    }

    [Test]
    public async Task Links_already_in_the_tracker_are_refused_even_with_small_differences()
    {
        var (app, posting) = NewApp();
        AddRow(app, "Verdant Hills Lot 12", 26, Link + "?__cft__[0]=AZX&__tn__=R");
        var id = "House & Lot/Casa Amara House & Lot";

        foreach (var same in new[] { Link, Link.TrimEnd('/'), Link.Replace("www.", "m."), Link.ToUpperInvariant().Replace("HTTPS", "https"), Link + "?mibextid=abc" })
            Assert.Equal("This link is already logged (Verdant Hills Lot 12, 3 Oct).", (await posting.PreviewLogAsync(Request(id, link: same))).Problems.Single(), same);

        Assert.True((await posting.PreviewLogAsync(Request(id, link: Link.Replace("1084512730024318", "1084512730024319")))).CanSave);
    }

    [Test]
    public async Task Pending_needs_no_link_but_a_given_link_is_still_checked()
    {
        var (_, posting) = NewApp();
        Assert.True((await posting.PreviewLogAsync(Request("Lot/Verdant Hills Lot 12", link: "", status: PostStatus.Pending))).CanSave);
        Assert.Equal("The post link must be a facebook.com link.",
            (await posting.PreviewLogAsync(Request("Lot/Verdant Hills Lot 12", link: "x", status: PostStatus.Pending))).Problems.Single());
    }

    [Test]
    public async Task Closed_queue_item_is_refused()
    {
        var (app, posting) = NewApp();
        var item = Queue(app, "Verdant Hills Lot 12", AssignmentStatus.Posted);

        var preview = await posting.PreviewLogAsync(Request("Lot/Verdant Hills Lot 12", queueKey: item.Key));

        Assert.Equal("This queue item is already closed.", preview.Problems.Single());
    }

    // ---------------------------------------------------------------- log

    [Test]
    public async Task Log_appends_the_row_and_closes_the_queue_item()
    {
        var (app, posting) = NewApp();
        var item = Queue(app, "Verdant Hills Lot 12");

        var result = await posting.LogPostAsync(Request("Lot/Verdant Hills Lot 12", queueKey: item.Key));

        Assert.True(result.Saved);
        Assert.Equal("Logged. The row is in the tracker sheet.", result.Message);
        Assert.Equal("2", Assert.NotNull(result.Entry).Key);
        Assert.Count(0, result.Problems);
        Assert.Equal(result.Entry, app.Tracker.Posts.Single());
        Assert.Equal(AssignmentStatus.Posted, app.Tracker.Assignments.Single().Status);
    }

    [Test]
    public async Task Log_as_pending_pins_the_queue_item()
    {
        var (app, posting) = NewApp();
        var item = Queue(app, "Casa Amara House & Lot");

        var result = await posting.LogPostAsync(Request("House & Lot/Casa Amara House & Lot", link: "", status: PostStatus.Pending, queueKey: item.Key));

        Assert.True(result.Saved);
        Assert.Equal("Logged as Pending. It stays pinned at the top of your queue until you add the live link.", result.Message);
        Assert.Equal(PostStatus.Pending, app.Tracker.Posts.Single().Status);
        Assert.Equal(AssignmentStatus.Pending, app.Tracker.Assignments.Single().Status);
    }

    [Test]
    public async Task Log_without_a_queue_key_still_ticks_the_posters_matching_item()
    {
        var (app, posting) = NewApp();
        Queue(app, "Verdant Hills Lot 12", who: "Mika Reyes");
        Queue(app, "Verdant Hills Lot 12");

        await posting.LogPostAsync(Request("Lot/Verdant Hills Lot 12"));

        Assert.Equal("Mika Reyes:ToPost,Jan Dela Cruz:Posted", string.Join(",", app.Tracker.Assignments.Select(a => $"{a.AssignedTo}:{a.Status}")));
    }

    [Test]
    public async Task Log_refused_in_cooldown_writes_nothing()
    {
        var (app, posting) = NewApp();
        app.AddPost("Verdant Hills Lot 7", 2);

        var result = await posting.LogPostAsync(Request("Lot/Verdant Hills Lot 7"));

        Assert.False(result.Saved);
        Assert.Null(result.Entry);
        Assert.Contains("Not saved. Verdant Hills Lot 7 was posted 2 days ago", result.Message);
        Assert.Equal(result.Message, result.Problems.Single());
        Assert.Count(1, app.Tracker.Posts);
    }

    // ---------------------------------------------------------------- complete pending

    [Test]
    public async Task Complete_pending_adds_the_link_and_closes_the_queue_item()
    {
        var (app, posting) = NewApp();
        Queue(app, "Casa Amara House & Lot", AssignmentStatus.Pending);
        var pending = AddRow(app, "Casa Amara House & Lot", 0, "", PostStatus.Pending, time: "10:31");
        app.Clock.Now = new TimeOnly(16, 5);

        var result = await posting.CompletePendingAsync(pending.Key, " " + Link + " ");

        Assert.True(result.Saved);
        Assert.Equal("Live link added — marked as Posted.", result.Message);
        var row = app.Tracker.Posts.Single();
        Assert.Equal(pending with { Status = PostStatus.Posted, PostLink = Link }, row);
        Assert.Equal(new TimeOnly(10, 31), row.Time);
        Assert.Equal(AssignmentStatus.Posted, app.Tracker.Assignments.Single().Status);

        var again = await posting.CompletePendingAsync(pending.Key, Link.Replace("4318", "4319"));
        Assert.False(again.Saved);
        Assert.Equal("This post is already live.", again.Message);
    }

    [Test]
    public async Task Complete_pending_validates_the_link()
    {
        var (app, posting) = NewApp();
        AddRow(app, "Verdant Hills Lot 12", 3, Link);
        var pending = AddRow(app, "Casa Amara House & Lot", 0, "", PostStatus.Pending);

        Assert.Equal("Paste the post link.", (await posting.CompletePendingAsync(pending.Key, "  ")).Message);
        Assert.Equal("The post link must be a facebook.com link.", (await posting.CompletePendingAsync(pending.Key, "https://example.com")).Message);
        Assert.Equal("This link is already logged (Verdant Hills Lot 12, 26 Oct).", (await posting.CompletePendingAsync(pending.Key, Link)).Message);
        Assert.Equal("That post is no longer in the tracker.", (await posting.CompletePendingAsync("99", Link)).Message);
        Assert.Equal(PostStatus.Pending, app.Tracker.Posts[1].Status);
    }

    // ---------------------------------------------------------------- lookups

    [Test]
    public async Task Posts_by_user_and_date_newest_first()
    {
        var (app, posting) = NewApp();
        app.AddPost("Verdant Hills Lot 12", 0, time: "10:17");
        app.AddPost("Casa Amara House & Lot", 0, PostStatus.Pending, time: "10:31");
        app.AddPost("Seaside Residences 2BR", 0, by: "Mika Reyes", time: "11:00");
        app.AddPost("Verdant Hills Lot 7", 1, time: "12:00");

        var mine = await posting.GetPostsByAsync("jan dela cruz", TestApp.Today);

        Assert.Equal("Casa Amara House & Lot,Verdant Hills Lot 12", string.Join(",", mine.Select(p => p.Title)));
        Assert.Equal("Casa Amara House & Lot", (await posting.GetPostAsync(mine[0].Key))?.Title);
        Assert.Null(await posting.GetPostAsync("404"));
    }

    [Test]
    public async Task FB_accounts_from_settings_then_from_the_tracker()
    {
        var (app, posting) = NewApp();
        app.AddPost("Verdant Hills Lot 12", 3, account: "Bacoor Buy & Sell");
        app.AddPost("Verdant Hills Lot 7", 2, account: "apg homes cavite");
        app.AddPost("Seaside Residences 2BR", 1, account: "Cavite Homes ");

        var accounts = await posting.GetFbAccountsAsync();

        Assert.Equal("APG Homes Cavite|APG Properties PH|Alpha Premier Listings|Cavite Homes|Bacoor Buy & Sell", string.Join("|", accounts));
    }
}
