using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;
using static PostIt.Tests.Manager.ManagerTestKit;

namespace PostIt.Tests.Manager;

public class AssignViewModelTests
{
    private static async Task<(TestApp App, AssignViewModel Vm)> Open(string? intern = null, DateOnly? date = null, TestApp? app = null)
    {
        app ??= NewApp();
        var vm = new AssignViewModel(app.Services(), app.Nav, intern, date);
        await vm.LoadAsync();
        return (app, vm);
    }

    private static AssignCandidateRowViewModel Candidate(AssignViewModel vm, string name) =>
        vm.Candidates.Single(c => c.Name == name);

    private static string DraftNames(AssignViewModel vm) => string.Join(",", vm.Draft.Select(r => r.Name));

    // ------------------------------------------------------------------ defaults

    [Test]
    public async Task Defaults_to_the_first_intern_and_tomorrow()
    {
        var (_, vm) = await Open();

        Assert.Equal("Assign", vm.Title);
        Assert.Equal(NavKey.Assign, vm.Nav);
        Assert.Equal("Jan Dela Cruz,Mika Reyes", string.Join(",", vm.Interns.Select(i => i.Name)));
        Assert.Equal(Jan, vm.SelectedIntern?.Name);
        Assert.Equal(Tomorrow, vm.Date);
        Assert.Equal("Fri 30 Oct 2026", vm.DateLabel);
        Assert.True(vm.IsTomorrow);
        Assert.False(vm.IsToday);
        Assert.Equal("Jan sees this list under My Queue on Fri 30 Oct.", vm.QueueHint);
        Assert.True(vm.IsQueueEmpty);
        Assert.Equal("0 properties · in posting order", vm.QueueCountText);
        Assert.False(vm.IsDirty);
        Assert.False(vm.SaveCommand.CanExecute(null));
    }

    [Test]
    public async Task Opens_on_the_intern_and_date_it_was_given()
    {
        var (_, vm) = await Open("mika reyes", Today);
        Assert.Equal(Mika, vm.SelectedIntern?.Name);
        Assert.Equal(Today, vm.Date);
        Assert.True(vm.IsToday);
    }

    [Test]
    public async Task Loads_the_saved_queue_into_the_draft_with_statuses()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today,
            ("Verdant Hills Lot 3", AssignmentStatus.Posted),
            ("Seaside Residences 2BR", AssignmentStatus.ToPost),
            ("Casa Amara House & Lot", AssignmentStatus.Pending));
        var (_, vm) = await Open(Jan, Today, app);

        Assert.Equal("Casa Amara House & Lot,Seaside Residences 2BR,Verdant Hills Lot 3", DraftNames(vm));
        Assert.Equal("1,2,3", string.Join(",", vm.Draft.Select(r => r.Number)));
        Assert.Equal("3 properties · in posting order", vm.QueueCountText);

        var pending = vm.Draft[0];
        Assert.True(pending.HasStatus);
        Assert.Equal("Pending", pending.StatusText);
        Assert.Equal("pending", pending.StatusKind);
        Assert.Equal("House & Lot", pending.CategoryText);
        Assert.Equal("cat", pending.CategoryKind);

        Assert.False(vm.Draft[1].HasStatus, "saved To-post items show no status badge");
        Assert.Equal("Posted", vm.Draft[2].StatusText);
        Assert.Equal("ok", vm.Draft[2].StatusKind);
        Assert.False(vm.IsDirty);
    }

    // ------------------------------------------------------------------ search & add

    [Test]
    public async Task Search_lists_every_folder_with_why_it_can_or_cannot_be_added()
    {
        var (_, vm) = await Open();

        Assert.Equal("Casa Amara House & Lot,Seaside Residences 2BR,Verdant Hills Lot 12,Verdant Hills Lot 3,Verdant Hills Lot 7",
            string.Join(",", vm.Candidates.Select(c => c.Name)));
        Assert.Equal("Showing 5 folders — type to narrow the list.", vm.SearchFooter);

        var due = Candidate(vm, "Verdant Hills Lot 12");
        Assert.Equal("Lot · Tagaytay · last posted 9 Oct", due.Meta);
        Assert.Equal("Due", due.BadgeText);
        Assert.Equal("pending", due.BadgeKind);
        Assert.True(due.AddCommand.CanExecute(null));
        Assert.False(due.ShowCantAdd);

        var never = Candidate(vm, "Seaside Residences 2BR");
        Assert.Equal("Condo · Tagaytay", never.Meta);
        Assert.Equal("Never posted", never.BadgeText);
        Assert.Equal("info", never.BadgeKind);

        var recent = Candidate(vm, "Verdant Hills Lot 3");
        Assert.False(recent.HasBadge);
        Assert.Equal("Lot · Tagaytay · last posted 19 Oct", recent.Meta);
    }

    [Test]
    public async Task Property_in_cooldown_cannot_be_added()
    {
        var (_, vm) = await Open();

        var cooling = Candidate(vm, "Verdant Hills Lot 7");
        Assert.Equal("Cooldown · 4 days left", cooling.BadgeText, "judged against tomorrow");
        Assert.Equal("cool", cooling.BadgeKind);
        Assert.True(cooling.BadgeShowsDot);
        Assert.True(cooling.ShowCantAdd);
        Assert.Equal("Can't add: in cooldown until Tue 3 Nov (4 days left)", cooling.CantAddText);
        Assert.False(cooling.AddCommand.CanExecute(null));

        cooling.AddCommand.Execute(null);
        Assert.True(vm.IsQueueEmpty);
    }

    [Test]
    public async Task Property_in_another_interns_queue_cannot_be_added()
    {
        var app = NewApp();
        SetQueue(app, Mika, Tomorrow, ("Seaside Residences 2BR", AssignmentStatus.ToPost));
        var (_, vm) = await Open(app: app);

        var taken = Candidate(vm, "Seaside Residences 2BR");
        Assert.Equal("In Mika's queue", taken.BadgeText);
        Assert.Equal("neutral", taken.BadgeKind);
        Assert.Equal("Can't add: already in Mika's queue for Fri 30 Oct", taken.CantAddText);
        Assert.False(taken.AddCommand.CanExecute(null));
    }

    [Test]
    public async Task Adding_puts_the_property_at_the_end_of_the_draft_once()
    {
        var (_, vm) = await Open();

        var seaside = Candidate(vm, "Seaside Residences 2BR");
        seaside.AddCommand.Execute(null);
        Candidate(vm, "Verdant Hills Lot 12").AddCommand.Execute(null);

        Assert.Equal("Seaside Residences 2BR,Verdant Hills Lot 12", DraftNames(vm));
        Assert.Equal("Condo", vm.Draft[0].CategoryText);
        Assert.False(vm.Draft[0].HasStatus, "new items have no status yet");
        Assert.True(seaside.IsInDraft);
        Assert.False(seaside.ShowAddButton, "shows 'Added' instead");
        Assert.False(seaside.AddCommand.CanExecute(null));
        Assert.Equal("2 properties · in posting order", vm.QueueCountText);
        Assert.True(vm.IsDirty);
        Assert.True(vm.SaveCommand.CanExecute(null));
    }

    [Test]
    public async Task Search_narrows_live_and_keeps_added_state()
    {
        var (_, vm) = await Open();
        Candidate(vm, "Verdant Hills Lot 3").AddCommand.Execute(null);

        vm.SearchText = "verdant";
        Assert.Equal("Verdant Hills Lot 12,Verdant Hills Lot 3,Verdant Hills Lot 7", string.Join(",", vm.Candidates.Select(c => c.Name)));
        Assert.Equal("3 folders match “verdant”.", vm.SearchFooter);
        Assert.True(Candidate(vm, "Verdant Hills Lot 3").IsInDraft);

        vm.SearchText = "zzz";
        Assert.True(vm.HasNoCandidates);
        Assert.Equal("No property folders match “zzz”.", vm.SearchEmptyText);
    }

    [Test]
    public async Task Stale_search_results_are_ignored()
    {
        var app = NewApp();
        var (services, gated) = ServicesWithGatedSearch(app);
        var vm = new AssignViewModel(services, app.Nav, null, null);
        await vm.LoadAsync();

        gated.Gate("verdant");
        vm.SearchText = "verdant"; // held back
        vm.SearchText = "seaside"; // answers at once
        Assert.Equal("Seaside Residences 2BR", string.Join(",", vm.Candidates.Select(c => c.Name)));

        gated.Release("verdant");
        await Task.Delay(50);
        Assert.Equal("Seaside Residences 2BR", string.Join(",", vm.Candidates.Select(c => c.Name)), "older search must not overwrite");
    }

    // ------------------------------------------------------------------ reorder & remove

    [Test]
    public async Task Up_and_down_reorder_the_draft()
    {
        var (_, vm) = await Open();
        foreach (var name in new[] { "Seaside Residences 2BR", "Verdant Hills Lot 12", "Verdant Hills Lot 3" })
            Candidate(vm, name).AddCommand.Execute(null);

        Assert.False(vm.Draft[0].MoveUpCommand.CanExecute(null), "first can't go up");
        Assert.False(vm.Draft[2].MoveDownCommand.CanExecute(null), "last can't go down");
        Assert.True(vm.Draft[1].MoveUpCommand.CanExecute(null));

        vm.Draft[0].MoveDownCommand.Execute(null);
        Assert.Equal("Verdant Hills Lot 12,Seaside Residences 2BR,Verdant Hills Lot 3", DraftNames(vm));

        vm.Draft[2].MoveUpCommand.Execute(null);
        Assert.Equal("Verdant Hills Lot 12,Verdant Hills Lot 3,Seaside Residences 2BR", DraftNames(vm));
        Assert.Equal("1,2,3", string.Join(",", vm.Draft.Select(r => r.Number)));
        Assert.True(vm.Draft[2].IsLast);
        Assert.False(vm.Draft[2].MoveDownCommand.CanExecute(null));
        Assert.True(vm.Draft[0].IsFirst);
    }

    [Test]
    public async Task Started_items_cannot_be_removed()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today,
            ("Casa Amara House & Lot", AssignmentStatus.Pending),
            ("Seaside Residences 2BR", AssignmentStatus.ToPost),
            ("Verdant Hills Lot 3", AssignmentStatus.Posted));
        var (_, vm) = await Open(Jan, Today, app);

        var pending = vm.Draft[0];
        var posted = vm.Draft[2];
        Assert.False(pending.RemoveCommand.CanExecute(null));
        Assert.False(posted.RemoveCommand.CanExecute(null));
        Assert.Equal("Already started — can't be removed", pending.RemoveToolTip);

        var toPost = vm.Draft[1];
        Assert.True(toPost.RemoveCommand.CanExecute(null));
        Assert.Equal("Remove from the queue", toPost.RemoveToolTip);
        toPost.RemoveCommand.Execute(null);
        Assert.Equal("Casa Amara House & Lot,Verdant Hills Lot 3", DraftNames(vm));
        Assert.True(vm.IsDirty);
    }

    [Test]
    public async Task Removing_a_new_item_makes_it_addable_again()
    {
        var (_, vm) = await Open();
        var seaside = Candidate(vm, "Seaside Residences 2BR");
        seaside.AddCommand.Execute(null);
        vm.Draft[0].RemoveCommand.Execute(null);

        Assert.True(vm.IsQueueEmpty);
        Assert.False(seaside.IsInDraft);
        Assert.True(seaside.AddCommand.CanExecute(null));
    }

    // ------------------------------------------------------------------ dirty tracking

    [Test]
    public async Task Dirty_follows_the_difference_with_the_saved_queue()
    {
        var app = NewApp();
        SetQueue(app, Jan, Tomorrow, ("Seaside Residences 2BR", AssignmentStatus.ToPost), ("Verdant Hills Lot 12", AssignmentStatus.ToPost));
        var (_, vm) = await Open(app: app);
        Assert.False(vm.IsDirty);
        Assert.False(vm.UndoCommand.CanExecute(null));

        vm.Draft[0].MoveDownCommand.Execute(null);
        Assert.True(vm.IsDirty, "order counts");
        Assert.Equal("Unsaved changes", vm.SaveStateText);
        vm.Draft[0].MoveDownCommand.Execute(null);
        Assert.False(vm.IsDirty, "back to the saved order");

        Candidate(vm, "Verdant Hills Lot 3").AddCommand.Execute(null);
        Assert.True(vm.IsDirty);
        Assert.True(vm.UndoCommand.CanExecute(null));

        vm.UndoCommand.Execute(null);
        Assert.False(vm.IsDirty);
        Assert.Equal("Seaside Residences 2BR,Verdant Hills Lot 12", DraftNames(vm));
        Assert.False(Candidate(vm, "Verdant Hills Lot 3").IsInDraft);
    }

    // ------------------------------------------------------------------ save

    [Test]
    public async Task Save_writes_the_queue_in_order_and_keeps_statuses()
    {
        var app = NewApp();
        SetQueue(app, Jan, Today, ("Casa Amara House & Lot", AssignmentStatus.Pending), ("Seaside Residences 2BR", AssignmentStatus.ToPost));
        var (_, vm) = await Open(Jan, Today, app);

        Candidate(vm, "Verdant Hills Lot 12").AddCommand.Execute(null);
        Candidate(vm, "Verdant Hills Lot 3").AddCommand.Execute(null);
        vm.Draft[3].MoveUpCommand.Execute(null);            // Lot 3 before Lot 12
        vm.Draft.Single(r => r.Name == "Seaside Residences 2BR").RemoveCommand.Execute(null);

        await vm.SaveCommand.ExecuteAsync();

        Assert.Equal("Casa Amara House & Lot:Pending,Verdant Hills Lot 3:ToPost,Verdant Hills Lot 12:ToPost", SavedQueue(app, Jan, Today));
        Assert.Equal("Saved. Jan has 3 properties for Thu 29 Oct.", app.Notifier.Last);
        Assert.Equal(ToastKind.Success, app.Notifier.Messages.Last().Kind);
        Assert.False(vm.IsDirty, "reloaded from the tracker");
        Assert.Equal("Pending", vm.Draft[0].StatusText);
        Assert.False(vm.SaveCommand.CanExecute(null));
    }

    [Test]
    public async Task Save_refused_by_the_tracker_shows_an_error_and_keeps_the_draft()
    {
        var app = NewApp();
        var (_, vm) = await Open(app: app);
        Candidate(vm, "Seaside Residences 2BR").AddCommand.Execute(null);

        // Meanwhile someone else gives it to Mika.
        SetQueue(app, Mika, Tomorrow, ("Seaside Residences 2BR", AssignmentStatus.ToPost));
        await vm.SaveCommand.ExecuteAsync();

        Assert.Equal(ToastKind.Error, app.Notifier.Messages.Last().Kind);
        Assert.Contains("Can't add Seaside Residences 2BR", app.Notifier.Last);
        Assert.Equal("", SavedQueue(app, Jan, Tomorrow));
        Assert.True(vm.IsDirty);
    }

    [Test]
    public async Task Saving_an_emptied_queue_says_so()
    {
        var app = NewApp();
        SetQueue(app, Jan, Tomorrow, ("Seaside Residences 2BR", AssignmentStatus.ToPost));
        var (_, vm) = await Open(app: app);
        vm.Draft[0].RemoveCommand.Execute(null);

        await vm.SaveCommand.ExecuteAsync();

        Assert.Equal("", SavedQueue(app, Jan, Tomorrow));
        Assert.Equal("Saved. Jan has no properties for Fri 30 Oct.", app.Notifier.Last);
    }

    // ------------------------------------------------------------------ switching with unsaved changes

    [Test]
    public async Task Changing_intern_with_unsaved_changes_asks_first()
    {
        var app = NewApp();
        SetQueue(app, Mika, Tomorrow, ("Verdant Hills Lot 12", AssignmentStatus.ToPost));
        var (_, vm) = await Open(app: app);
        var mika = vm.Interns[1];

        Candidate(vm, "Seaside Residences 2BR").AddCommand.Execute(null);
        app.Ui.ConfirmAnswer = false;
        vm.SelectedIntern = mika;

        Assert.Equal(Jan, vm.SelectedIntern?.Name, "cancel keeps the old intern");
        Assert.Equal("Seaside Residences 2BR", DraftNames(vm));
        Assert.Equal("You have unsaved changes to Jan's queue for Fri 30 Oct. Discard them?", app.Ui.Confirms.Single());

        app.Ui.ConfirmAnswer = true;
        vm.SelectedIntern = mika;
        await Task.Yield();

        Assert.Equal(Mika, vm.SelectedIntern?.Name);
        Assert.Equal("Verdant Hills Lot 12", DraftNames(vm));
        Assert.False(vm.IsDirty);
        Assert.Equal("Mika sees this list under My Queue on Fri 30 Oct.", vm.QueueHint);
    }

    [Test]
    public async Task Changing_intern_without_changes_does_not_ask()
    {
        var (app, vm) = await Open();
        vm.SelectedIntern = vm.Interns[1];
        await Task.Yield();
        Assert.Count(0, app.Ui.Confirms);
        Assert.Equal(Mika, vm.SelectedIntern?.Name);
    }

    [Test]
    public async Task Changing_date_with_unsaved_changes_asks_first()
    {
        var (app, vm) = await Open();
        Candidate(vm, "Seaside Residences 2BR").AddCommand.Execute(null);

        app.Ui.ConfirmAnswer = false;
        await vm.TodayCommand.ExecuteAsync();
        Assert.Equal(Tomorrow, vm.Date);
        Assert.True(vm.IsTomorrow);
        Assert.True(vm.IsDirty);

        app.Ui.ConfirmAnswer = true;
        await vm.TodayCommand.ExecuteAsync();
        Assert.Equal(Today, vm.Date);
        Assert.True(vm.IsToday);
        Assert.False(vm.IsDirty);
        Assert.Count(2, app.Ui.Confirms);
    }

    [Test]
    public async Task Date_stepper_moves_a_day_at_a_time_and_rechecks_cooldowns()
    {
        var (_, vm) = await Open();

        await vm.NextDayCommand.ExecuteAsync();
        Assert.Equal("Sat 31 Oct 2026", vm.DateLabel);
        Assert.False(vm.IsTomorrow);
        Assert.Equal("Cooldown · 3 days left", Candidate(vm, "Verdant Hills Lot 7").BadgeText);

        await vm.PreviousDayCommand.ExecuteAsync();
        await vm.PreviousDayCommand.ExecuteAsync();
        Assert.Equal("Thu 29 Oct 2026", vm.DateLabel);
        Assert.True(vm.IsToday);
        Assert.Equal("Cooldown · 5 days left", Candidate(vm, "Verdant Hills Lot 7").BadgeText);

        await vm.TomorrowCommand.ExecuteAsync();
        Assert.Equal(Tomorrow, vm.Date);
    }

    // ------------------------------------------------------------------ paste a list

    private const string Pasted = "Seaside Residences 2BR\nVerdant Hills Lot 7\n- Verdant Hils Lot 3\nNowhere Tower 9\n1. Casa Amara House & Lot\n";

    [Test]
    public async Task Pasted_list_is_matched_to_folders_and_typos_are_flagged()
    {
        var (_, vm) = await Open();
        Assert.False(vm.MatchCommand.CanExecute(null), "nothing pasted yet");

        vm.PasteText = Pasted;
        await vm.MatchCommand.ExecuteAsync();

        Assert.Equal("3 of 5 found", vm.MatchSummary);
        Assert.Count(5, vm.Matches);

        var exact = vm.Matches[0];
        Assert.Equal(CheckStatus.Pass, exact.Mark);
        Assert.Equal("Seaside Residences 2BR", exact.Text);
        Assert.Equal("", exact.SubText);

        var blocked = vm.Matches[1];
        Assert.Equal(CheckStatus.Fail, blocked.Mark);
        Assert.Equal("Verdant Hills Lot 7", blocked.Text);
        Assert.Equal("Can't add: in cooldown until Tue 3 Nov (4 days left)", blocked.SubText);

        var typo = vm.Matches[2];
        Assert.Equal(CheckStatus.Warn, typo.Mark);
        Assert.Equal("Verdant Hils Lot 3 — not found.", typo.Text);
        Assert.True(typo.IsSuggestion);
        Assert.Equal("Did you mean Verdant Hills Lot 3?", typo.SuggestionText);

        var missing = vm.Matches[3];
        Assert.Equal(CheckStatus.Fail, missing.Mark);
        Assert.Equal("Nowhere Tower 9 — not found.", missing.Text);
        Assert.False(missing.IsSuggestion);
        Assert.False(missing.UseItCommand.CanExecute(null));

        Assert.Equal(2, vm.AddableMatchCount);
        Assert.Equal("Add 2 matched to the queue", vm.AddAllLabel);
        Assert.True(vm.IsQueueEmpty, "matching doesn't change the draft");
    }

    [Test]
    public async Task Use_it_adds_the_suggested_property()
    {
        var (_, vm) = await Open();
        vm.PasteText = Pasted;
        await vm.MatchCommand.ExecuteAsync();

        var typo = vm.Matches[2];
        typo.UseItCommand.Execute(null);

        Assert.Equal("Verdant Hills Lot 3", DraftNames(vm));
        Assert.Equal(CheckStatus.Pass, typo.Mark);
        Assert.Equal("Verdant Hills Lot 3", typo.Text);
        Assert.False(typo.IsSuggestion);
        Assert.Equal("4 of 5 found", vm.MatchSummary);
        Assert.Equal(2, vm.AddableMatchCount, "the suggestion isn't counted twice");
    }

    [Test]
    public async Task Use_it_on_a_blocked_suggestion_explains_why()
    {
        var (app, vm) = await Open();
        vm.PasteText = "Verdant Hils Lot 7";
        await vm.MatchCommand.ExecuteAsync();

        vm.Matches[0].UseItCommand.Execute(null);

        Assert.True(vm.IsQueueEmpty);
        Assert.Equal("Can't add Verdant Hills Lot 7: in cooldown until Tue 3 Nov (4 days left).", app.Notifier.Last);
        Assert.Equal(ToastKind.Warning, app.Notifier.Messages.Last().Kind);
    }

    [Test]
    public async Task Add_all_matched_adds_the_exact_matches_that_are_allowed()
    {
        var (app, vm) = await Open();
        Candidate(vm, "Seaside Residences 2BR").AddCommand.Execute(null);
        vm.PasteText = Pasted;
        await vm.MatchCommand.ExecuteAsync();
        Assert.Equal(1, vm.AddableMatchCount, "Seaside is already in the draft");

        vm.AddAllMatchedCommand.Execute(null);

        Assert.Equal("Seaside Residences 2BR,Casa Amara House & Lot", DraftNames(vm));
        Assert.Equal("1 name was added to Jan's queue. Save to keep it.", vm.AddedMessage);
        Assert.Equal(0, vm.AddableMatchCount);
        Assert.False(vm.AddAllMatchedCommand.CanExecute(null));
        Assert.True(vm.IsDirty);

        await vm.SaveCommand.ExecuteAsync();
        Assert.Equal("", vm.AddedMessage);
        Assert.Equal("Seaside Residences 2BR:ToPost,Casa Amara House & Lot:ToPost", SavedQueue(app, Jan, Tomorrow));
    }

    [Test]
    public async Task Add_all_reports_how_many_names_were_added()
    {
        var (_, vm) = await Open();
        vm.PasteText = Pasted;
        await vm.MatchCommand.ExecuteAsync();

        vm.AddAllMatchedCommand.Execute(null);

        Assert.Equal("Seaside Residences 2BR,Casa Amara House & Lot", DraftNames(vm));
        Assert.Equal("2 names were added to Jan's queue. Save to keep them.", vm.AddedMessage);
    }

    [Test]
    public async Task Switching_intern_clears_the_matches()
    {
        var (_, vm) = await Open();
        vm.PasteText = Pasted;
        await vm.MatchCommand.ExecuteAsync();

        vm.SelectedIntern = vm.Interns[1];
        await Task.Yield();

        Assert.False(vm.HasMatches);
        Assert.Equal("", vm.MatchSummary);
        Assert.Equal(Pasted, vm.PasteText, "the pasted text stays");
    }
}
