using PostIt.Core;

namespace PostIt.Tests.CoreLogic;

public class AssignmentServiceTests
{
    private const string Jan = "Jan Dela Cruz", Mika = "Mika Reyes";
    private static readonly DateOnly Today = TestApp.Today, Tomorrow = TestApp.Today.AddDays(1);

    /// <summary>Lot 12 due (20 days), Lot 7 in cooldown (2 days), Lot 3 recent (10 days), Seaside never, Casa Amara never.</summary>
    private static (TestApp App, IAssignmentService Service) NewApp()
    {
        var app = new TestApp();
        app.AddProperty("Verdant Hills Lot 12");
        app.AddProperty("Verdant Hills Lot 7");
        app.AddProperty("Verdant Hills Lot 3");
        app.AddProperty("Seaside Residences 2BR", "Condo");
        app.AddProperty("Casa Amara House & Lot", "House & Lot");
        app.AddPost("Verdant Hills Lot 12", 20);
        app.AddPost("Verdant Hills Lot 7", 2);
        app.AddPost("Verdant Hills Lot 3", 10);
        return (app, app.Core().Assignments);
    }

    private static void SetQueue(TestApp app, string who, DateOnly date, params (string Property, AssignmentStatus Status)[] items) =>
        app.Tracker.ReplaceQueueAsync(date, who, items.Select(i => new Assignment("", date, who, i.Property, i.Status)).ToList()).Wait();

    [Test]
    public async Task Queue_puts_pending_first_then_to_post_in_order_then_posted()
    {
        var (app, service) = NewApp();
        SetQueue(app, Jan, Today,
            ("Verdant Hills Lot 3", AssignmentStatus.Posted),
            ("Seaside Residences 2BR", AssignmentStatus.ToPost),
            ("Casa Amara House & Lot", AssignmentStatus.Pending),
            ("Verdant Hills Lot 12", AssignmentStatus.ToPost),
            ("Folder Since Deleted", AssignmentStatus.ToPost));
        SetQueue(app, Mika, Today, ("Verdant Hills Lot 7", AssignmentStatus.ToPost));
        app.AddPost("Casa Amara House & Lot", 0, PostStatus.Posted, time: "10:00", by: Mika);
        var pending = app.AddPost("Casa Amara House & Lot", 0, PostStatus.Pending, time: "10:31");
        var closed = app.AddPost("Verdant Hills Lot 3", 0, time: "09:15");

        var queue = await service.GetQueueAsync("jan dela cruz", Today);

        Assert.Equal("Casa Amara House & Lot,Seaside Residences 2BR,Verdant Hills Lot 12,Folder Since Deleted,Verdant Hills Lot 3",
            string.Join(",", queue.Items.Select(i => i.Assignment.PropertyName)));
        Assert.Equal(3, queue.ToPost);
        Assert.Equal(1, queue.Posted);
        Assert.Equal(1, queue.Pending);
        Assert.Equal(pending, queue.Items[0].Post);
        Assert.Equal(closed, queue.Items[4].Post);
        Assert.Null(queue.Items[1].Post);
        Assert.Null(queue.Items[3].Property);
        Assert.Equal("House & Lot/Casa Amara House & Lot", queue.Items[0].Property?.Id);
        Assert.True(queue.Items[2].Property!.Cooldown.DueForRepost);
        Assert.Equal(Today, queue.Date);
        Assert.Equal("jan dela cruz", queue.User);
        Assert.Count(0, (await service.GetQueueAsync(Jan, Tomorrow)).Items);
    }

    [Test]
    public async Task Check_explains_why_a_property_can_or_cannot_be_added()
    {
        var (app, service) = NewApp();
        SetQueue(app, Mika, Today, ("Seaside Residences 2BR", AssignmentStatus.ToPost));

        var never = await service.CheckAsync("House & Lot/Casa Amara House & Lot", Jan, Today);
        Assert.True(never.CanAdd);
        Assert.Equal(AssignBlock.None, never.Block);
        Assert.Equal("Never posted", never.Message);

        Assert.Equal("Due — last posted 20 days ago", (await service.CheckAsync("Lot/Verdant Hills Lot 12", Jan, Today)).Message);
        Assert.Equal("Last posted 10 days ago", (await service.CheckAsync("Lot/Verdant Hills Lot 3", Jan, Today)).Message);

        var cooldown = await service.CheckAsync("Lot/Verdant Hills Lot 7", Jan, Today);
        Assert.False(cooldown.CanAdd);
        Assert.Equal(AssignBlock.InCooldown, cooldown.Block);
        Assert.Equal("In cooldown until Tue 3 Nov (5 days left)", cooldown.Message);
        Assert.Equal(5, cooldown.Cooldown.DaysLeft);

        var taken = await service.CheckAsync("Condo/Seaside Residences 2BR", Jan, Today);
        Assert.Equal(AssignBlock.AssignedToSomeoneElse, taken.Block);
        Assert.Equal("Already in Mika's queue for Thu 29 Oct", taken.Message);
        Assert.True((await service.CheckAsync("Condo/Seaside Residences 2BR", Mika, Today)).CanAdd, "her own queue");
        Assert.True((await service.CheckAsync("Condo/Seaside Residences 2BR", Jan, Tomorrow)).CanAdd, "another day");

        var missing = await service.CheckAsync("Lot/Gone", Jan, Today);
        Assert.Equal(AssignBlock.NotFound, missing.Block);
        Assert.False(missing.CanAdd);
    }

    [Test]
    public async Task Cooldown_is_judged_against_the_queue_date()
    {
        var (_, service) = NewApp();

        Assert.Equal("In cooldown until Tue 3 Nov (1 day left)", (await service.CheckAsync("Lot/Verdant Hills Lot 7", Jan, Today.AddDays(4))).Message);
        var free = await service.CheckAsync("Lot/Verdant Hills Lot 7", Jan, Today.AddDays(5));
        Assert.True(free.CanAdd);
        Assert.Equal("Last posted 7 days ago", free.Message);
    }

    [Test]
    public async Task Search_candidates_carry_their_check()
    {
        var (_, service) = NewApp();

        var candidates = await service.SearchCandidatesAsync("verdant", Jan, Today);

        Assert.Equal("Verdant Hills Lot 12:True,Verdant Hills Lot 3:True,Verdant Hills Lot 7:False",
            string.Join(",", candidates.Select(c => $"{c.Property.Name}:{c.Check.CanAdd}")));
        Assert.Equal(AssignBlock.InCooldown, candidates[2].Check.Block);
    }

    [Test]
    public async Task Pasted_list_is_cleaned_matched_and_checked()
    {
        var (_, service) = NewApp();
        var pasted = "1. Verdant Hills Lot 12\r\n2) verdant hils lot 3\n- Nonexistent Place\n\n   \n• Verdant Hills Lot 12\n* Casa Amara House and Lot\n– Verdant Hills Lot 7\n";

        var matches = await service.MatchPastedListAsync(pasted, Jan, Today);

        Assert.Equal("Verdant Hills Lot 12|verdant hils lot 3|Nonexistent Place|Casa Amara House and Lot|Verdant Hills Lot 7",
            string.Join("|", matches.Select(m => m.Typed)));
        Assert.Equal("Exact,Suggestion,NotFound,Exact,Exact", string.Join(",", matches.Select(m => m.Kind)));
        Assert.Equal("Verdant Hills Lot 3", matches[1].Property?.Name);
        Assert.Null(matches[2].Property);
        Assert.Null(matches[2].Check);
        Assert.Equal("Casa Amara House & Lot", matches[3].Property?.Name);
        Assert.Equal("Never posted", matches[3].Check?.Message);
        Assert.Equal(AssignBlock.InCooldown, matches[4].Check?.Block);
    }

    [Test]
    public async Task Save_keeps_existing_statuses_adds_new_items_and_removes_dropped_ones()
    {
        var (app, service) = NewApp();
        SetQueue(app, Mika, Today, ("Verdant Hills Lot 3", AssignmentStatus.ToPost));
        SetQueue(app, Jan, Today, ("Verdant Hills Lot 7", AssignmentStatus.Posted), ("Seaside Residences 2BR", AssignmentStatus.ToPost));

        await service.SaveQueueAsync(Jan, Today, new[] { "casa amara house & lot", "Verdant Hills Lot 12", "Verdant Hills Lot 7", "Verdant Hills Lot 12", " " });

        var jan = app.Tracker.Assignments.Where(a => a.AssignedTo == Jan).ToList();
        Assert.Equal("Casa Amara House & Lot:ToPost,Verdant Hills Lot 12:ToPost,Verdant Hills Lot 7:Posted",
            string.Join(",", jan.Select(a => $"{a.PropertyName}:{a.Status}")));
        Assert.Equal(Assignment.MakeKey(Today, Jan, "Casa Amara House & Lot"), jan[0].Key);
        Assert.Equal(Mika, app.Tracker.Assignments[0].AssignedTo);
        Assert.Equal(1, await service.CountOpenAsync(Mika, Today));
        Assert.Equal(2, await service.CountOpenAsync(Jan, Today));
    }

    [Test]
    public async Task Save_refuses_unknown_names_cooldown_and_someone_elses_items()
    {
        var (app, service) = NewApp();
        SetQueue(app, Mika, Today, ("Seaside Residences 2BR", AssignmentStatus.ToPost));

        var unknown = await Assert.ThrowsAsync<UserFacingException>(() => service.SaveQueueAsync(Jan, Today, new[] { "Verdant Hills Lot 12", "Nowhere Lot 1 " }));
        Assert.Equal("\"Nowhere Lot 1\" was not found in the property folders.", unknown.Message);

        var cooldown = await Assert.ThrowsAsync<UserFacingException>(() => service.SaveQueueAsync(Jan, Today, new[] { "Verdant Hills Lot 7" }));
        Assert.Equal("Can't add Verdant Hills Lot 7: In cooldown until Tue 3 Nov (5 days left).", cooldown.Message);

        var taken = await Assert.ThrowsAsync<UserFacingException>(() => service.SaveQueueAsync(Jan, Today, new[] { "Seaside Residences 2BR" }));
        Assert.Equal("Can't add Seaside Residences 2BR: Already in Mika's queue for Thu 29 Oct.", taken.Message);

        Assert.Count(1, app.Tracker.Assignments);
    }

    [Test]
    public async Task Count_open_counts_to_post_and_pending()
    {
        var (app, service) = NewApp();
        SetQueue(app, Jan, Today,
            ("Verdant Hills Lot 12", AssignmentStatus.ToPost), ("Seaside Residences 2BR", AssignmentStatus.Pending), ("Verdant Hills Lot 3", AssignmentStatus.Posted));

        Assert.Equal(2, await service.CountOpenAsync(Jan, Today));
        Assert.Equal(0, await service.CountOpenAsync(Jan, Tomorrow));
        Assert.Equal(0, await service.CountOpenAsync(Mika, Today));
    }
}
