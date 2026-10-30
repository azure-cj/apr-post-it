using PostIt.Core;

namespace PostIt.Tests.CoreLogic;

public class PostingTextParserTests
{
    [Test]
    public void Splits_metadata_public_text_and_internal_notes()
    {
        var text = PostingTextParser.Parse(TestApp.StandardDoc);

        Assert.Equal("Lot", text.Category);
        Assert.Equal("Tagaytay", text.Location);
        Assert.True(text.HasInternalSection);
        Assert.True(text.PublicText.StartsWith("FOR SALE: 320 sqm lot"), text.PublicText);
        Assert.True(text.PublicText.EndsWith("0920 000 0000"), "trailing blank lines trimmed");
        Assert.DoesNotContain("Category:", text.PublicText);
        Assert.DoesNotContain("INTERNAL", text.PublicText);
        Assert.DoesNotContain("Commission", text.PublicText);
        Assert.Equal("Commission: 3% to agent\nOwner: Mr. Reyes", text.InternalText);
    }

    [Test]
    public void Metadata_block_allows_blank_lines_Type_synonym_BOM_and_CRLF()
    {
        var text = PostingTextParser.Parse("﻿\r\nType: Condo\r\n\r\nlocation:  Pasay \r\nFOR SALE: 2BR\r\nBay view.\r\n");

        Assert.Equal("Condo", text.Category);
        Assert.Equal("Pasay", text.Location);
        Assert.Equal("FOR SALE: 2BR\nBay view.", text.PublicText);
        Assert.False(text.HasInternalSection);
        Assert.Equal("", text.InternalText);
    }

    [Test]
    public void Metadata_keys_after_the_top_block_are_ordinary_text()
    {
        var text = PostingTextParser.Parse("FOR SALE: lot\nLocation: near the market\nPrice: ₱4.2M\nCategory: best buy");

        Assert.Null(text.Category);
        Assert.Null(text.Location);
        Assert.Contains("Location: near the market", text.PublicText);
        Assert.Contains("Price: ₱4.2M", text.PublicText);
        Assert.Contains("Category: best buy", text.PublicText);
    }

    [Test]
    public void Recognises_common_internal_marker_styles()
    {
        var markers = new[]
        {
            "=== INTERNAL — DO NOT POST ===", "--- Internal notes ---", "## For agents only", "[Do not post]", "Agent's notes:",
            "Agents notes", "*** NOT FOR POSTING ***", "Internal only", "(internal)", "> For internal use", "INTERNAL NOTE", "~~ do not post ~~",
        };
        foreach (var marker in markers)
        {
            var text = PostingTextParser.Parse($"FOR SALE: lot\nPrice: ₱1M\n\n{marker}\nsecret commission 5%");
            Assert.True(text.HasInternalSection, marker);
            Assert.Equal("FOR SALE: lot\nPrice: ₱1M", text.PublicText, marker);
            Assert.Equal("secret commission 5%", text.InternalText, marker);
        }
    }

    [Test]
    public void Only_the_first_marker_counts()
    {
        var text = PostingTextParser.Parse("Public\n=== INTERNAL ===\nA\n=== INTERNAL ===\nB");
        Assert.Equal("Public", text.PublicText);
        Assert.Equal("A\n=== INTERNAL ===\nB", text.InternalText);
    }

    [Test]
    public void Words_that_merely_start_with_internal_are_public()
    {
        var text = PostingTextParser.Parse("Internally renovated kitchen\nDo not miss this!\nPrice: ₱2M");
        Assert.False(text.HasInternalSection);
        Assert.Contains("Internally renovated kitchen", text.PublicText);
    }

    [Test]
    public void Without_a_marker_everything_is_public()
    {
        var text = PostingTextParser.Parse(RepoFiles.SampleDoc("House & Lot", "Sunrise Homes Block 3 Lot 9"));
        Assert.False(text.HasInternalSection);
        Assert.Equal("", text.InternalText);
        Assert.Equal("House & Lot", text.Category);
        Assert.Contains("Site visits by appointment", text.PublicText);
    }

    [Test]
    public void Trims_and_collapses_blank_lines_and_keeps_tabs()
    {
        var text = PostingTextParser.Parse("\n\n  \nA\tB   \n\n\n \n\nC\n\n");
        Assert.Equal("A\tB\n\nC", text.PublicText);
    }

    [Test]
    public void Empty_or_null_doc_is_empty_text()
    {
        var text = PostingTextParser.Parse("");
        Assert.Equal("", text.PublicText);
        Assert.False(text.HasInternalSection);
        Assert.Equal("", PostingTextParser.Parse(null!).PublicText);
    }
}

public class PrePostCheckerTests
{
    private static IReadOnlyList<CheckResult> Run(string doc) => PrePostChecker.Run(PostingTextParser.Parse(doc));
    private static CheckResult Check(string doc, string name) => Run(doc).Single(c => c.Name == name);

    [Test]
    public void Clean_doc_passes_all_four_checks_in_order()
    {
        var checks = Run(TestApp.StandardDoc);

        Assert.Equal("Price present,Contact numbers present,No commission wording,Internal section hidden", string.Join(",", checks.Select(c => c.Name)));
        Assert.True(checks.All(c => c.Status == CheckStatus.Pass), string.Join("; ", checks));
        Assert.Equal("₱4.2M", checks[0].Detail);
        Assert.Equal("2 found", checks[1].Detail);
        Assert.Equal("Clean", checks[2].Detail);
        Assert.Equal("Kept out of the copy", checks[3].Detail);
    }

    [Test]
    public void Price_formats()
    {
        Assert.Equal("₱180K / month", Check("Price: ₱180K / month\n", "Price present").Detail);
        Assert.Equal("PHP 4,200,000", Check("Selling at PHP 4,200,000, cash only", "Price present").Detail);
        Assert.Equal("Php 3.5 million", Check("Php 3.5 million, negotiable", "Price present").Detail);
        Assert.Equal("P3.6M", Check("Now P3.6M!", "Price present").Detail);
        Assert.Equal("4,200,000 negotiable", Check("Price: 4,200,000 negotiable", "Price present").Detail);

        var missing = Check("Price: ask us\nUP 5 floors", "Price present");
        Assert.Equal(CheckStatus.Warn, missing.Status);
        Assert.Equal("No price found in the public text", missing.Detail);
    }

    [Test]
    public void Price_in_the_internal_part_does_not_count()
    {
        var check = Check("Nice lot\n=== INTERNAL ===\nNet ₱3.9M", "Price present");
        Assert.Equal(CheckStatus.Warn, check.Status);
    }

    [Test]
    public void Contact_numbers_mobile_and_landline_counted_once_each()
    {
        Assert.Equal("2 found", Check("Call +63 917 123 4567 or (02) 8123 4567", "Contact numbers present").Detail);
        Assert.Equal("1 found", Check("Text 0917-123-4567 / 0917 123 4567", "Contact numbers present").Detail);
        Assert.Equal("1 found", Check("Viber 09171234567", "Contact numbers present").Detail);

        var none = Check("Message us on Facebook. Lot 12, 320 sqm.", "Contact numbers present");
        Assert.Equal(CheckStatus.Warn, none.Status);
        Assert.Equal("No contact number found", none.Detail);
    }

    [Test]
    public void Commission_wording_fails_and_quotes_the_first_hit()
    {
        var hits = new Dictionary<string, string>
        {
            ["5% Commission to referring agents"] = "Commission",
            ["Comm. 5% for brokers"] = "Comm. 5%",
            ["Referral fee available"] = "Referral fee",
            ["Agent's share is generous"] = "Agent's share",
            ["Big incentive for buyers"] = "incentive",
            ["Net to owner ₱3.9M"] = "Net to owner",
            ["3% to agents"] = "3% to agents",
            ["Finder's fee given"] = "Finder's fee",
            ["Cash rebate on signing"] = "rebate",
        };
        foreach (var (line, quoted) in hits)
        {
            var check = Check($"FOR SALE\n{line}\n", "No commission wording");
            Assert.Equal(CheckStatus.Fail, check.Status, line);
            Assert.Equal($"Found \"{quoted}\" — remove it before posting", check.Detail, line);
        }

        var first = Check("Rebate! Also a commission.", "No commission wording");
        Assert.Equal("Found \"Rebate\" — remove it before posting", first.Detail);
    }

    [Test]
    public void Commission_wording_in_the_internal_part_is_fine()
    {
        var check = Check(TestApp.StandardDoc, "No commission wording");
        Assert.Equal(CheckStatus.Pass, check.Status);
        Assert.Equal("Pass", Check("Community pool and clubhouse", "No commission wording").Status.ToString());
    }

    [Test]
    public void Missing_internal_marker_blocks_copying()
    {
        // Not a warning. A document with no separator has not been checked by
        // anyone, and in the real library those are exactly the ones carrying
        // the owner's mobile number.
        var check = Check("FOR SALE\nPrice: ₱1M", "Internal section hidden");
        Assert.Equal(CheckStatus.Fail, check.Status);
        Assert.Contains("No separator", check.Detail);
    }

    [Test]
    public void Mabini_sample_doc_fails_on_commission()
    {
        var checks = Run(RepoFiles.SampleDoc("Commercial", "Mabini Commercial Space"));

        Assert.Equal(CheckStatus.Pass, checks[0].Status);
        Assert.Equal("₱180K / month", checks[0].Detail);
        Assert.Equal("2 found", checks[1].Detail);
        Assert.Equal(CheckStatus.Fail, checks[2].Status);
        Assert.Equal("Found \"commission\" — remove it before posting", checks[2].Detail);
        Assert.Equal(CheckStatus.Pass, checks[3].Status);
    }
}

public class PropertyNameMatcherTests
{
    private static readonly string[] Verdant = { "Verdant Hills Lot 12", "Verdant Hills Lot 3", "Verdant Hills Lot 7" };

    [Test]
    public void Normalize_ignores_case_punctuation_accents_and_abbreviations()
    {
        Assert.Equal("sunrise homes block 3 lot 9", PropertyNameMatcher.Normalize("Sunrise Homes Blk. 3, Lt 9"));
        Assert.Equal("casa amara house and lot", PropertyNameMatcher.Normalize("Casa Amara House & Lot"));
        Assert.Equal("casa amara house and lot", PropertyNameMatcher.Normalize("casa amara house&lot"));
        Assert.Equal("sta rosa lot 22", PropertyNameMatcher.Normalize("  Sta. Rosa   Lot #22 "));
        Assert.Equal("imus townhomes phase 2", PropertyNameMatcher.Normalize("Imus Townhomes Ph-2"));
        Assert.Equal("mabini building annex", PropertyNameMatcher.Normalize("Mabini Bldg (Annex)"));
        Assert.Equal("dasmarinas agents lot", PropertyNameMatcher.Normalize("Dasmariñas Agent’s Lot"));
        Assert.Equal("", PropertyNameMatcher.Normalize("  "));
    }

    [Test]
    public void Exact_match_after_normalising()
    {
        Assert.Equal((PasteMatchKind.Exact, "Verdant Hills Lot 12"), PropertyNameMatcher.Match("verdant hills lot 12", Verdant));
        Assert.Equal((PasteMatchKind.Exact, "Sunrise Homes Block 3 Lot 9"),
            PropertyNameMatcher.Match("Sunrise Homes Blk 3 Lt 9", new[] { "Sunrise Homes Block 3 Lot 9" }));
    }

    [Test]
    public void Typo_gets_a_suggestion_with_the_same_number()
    {
        Assert.Equal((PasteMatchKind.Suggestion, "Verdant Hills Lot 3"), PropertyNameMatcher.Match("Verdant Hils Lot 3", Verdant));
        Assert.Equal((PasteMatchKind.Suggestion, "Verdant Hills Lot 12"), PropertyNameMatcher.Match("Verdnt Hills Lot 12", Verdant));
    }

    [Test]
    public void Different_numbers_are_never_suggested()
    {
        Assert.Equal((PasteMatchKind.NotFound, (string?)null), PropertyNameMatcher.Match("Verdant Hills Lot 13", Verdant));
        Assert.Equal((PasteMatchKind.NotFound, (string?)null), PropertyNameMatcher.Match("Verdant Hills", Verdant));
    }

    [Test]
    public void All_typed_words_present_is_a_suggestion_and_ties_go_to_the_first_name()
    {
        Assert.Equal((PasteMatchKind.Suggestion, "Casa Amara House & Lot"),
            PropertyNameMatcher.Match("Casa Amara", new[] { "Seaside Residences 2BR", "Casa Amara House & Lot" }));
        Assert.Equal((PasteMatchKind.Suggestion, "Casa Amara North"),
            PropertyNameMatcher.Match("Casa Amara", new[] { "Casa Amara North", "Casa Amara South" }));
    }

    [Test]
    public void Unrelated_or_blank_text_is_not_found()
    {
        Assert.Equal(PasteMatchKind.NotFound, PropertyNameMatcher.Match("Something Else Entirely", Verdant).Kind);
        Assert.Equal(PasteMatchKind.NotFound, PropertyNameMatcher.Match("  ", Verdant).Kind);
        Assert.Equal(PasteMatchKind.NotFound, PropertyNameMatcher.Match("Verdant Hills Lot 12", Array.Empty<string>()).Kind);
    }
}

public class CooldownPolicyTests
{
    private static readonly DateOnly Today = TestApp.Today;
    private readonly CooldownPolicy _policy = new(7, 14);

    [Test]
    public void Never_posted()
    {
        var state = _policy.Evaluate(null, Today);
        Assert.Equal(CooldownState.Never, state);
        Assert.True(state.NeverPosted);
        Assert.True(state.DueForRepost);
        Assert.False(state.InCooldown);
    }

    [Test]
    public void Day_6_is_in_cooldown_day_7_is_not()
    {
        var day6 = _policy.Evaluate(Today.AddDays(-6), Today);
        Assert.True(day6.InCooldown);
        Assert.Equal(1, day6.DaysLeft);
        Assert.Equal(6, day6.DaysSince);
        Assert.Equal(Today.AddDays(1), day6.AvailableOn);

        var day7 = _policy.Evaluate(Today.AddDays(-7), Today);
        Assert.False(day7.InCooldown);
        Assert.Equal(0, day7.DaysLeft);
        Assert.Equal(Today, day7.AvailableOn);
        Assert.False(day7.NeverPosted);
    }

    [Test]
    public void Due_for_repost_from_day_14()
    {
        Assert.False(_policy.Evaluate(Today.AddDays(-13), Today).DueForRepost);
        Assert.True(_policy.Evaluate(Today.AddDays(-14), Today).DueForRepost);
    }

    [Test]
    public void Posted_today_and_future_dates()
    {
        var today = _policy.Evaluate(Today, Today);
        Assert.Equal(0, today.DaysSince);
        Assert.Equal(7, today.DaysLeft);

        var future = _policy.Evaluate(Today.AddDays(2), Today);
        Assert.Equal(0, future.DaysSince);
        Assert.True(future.InCooldown);
        Assert.Equal(9, future.DaysLeft);
    }

    [Test]
    public void Settings_change_the_rules()
    {
        var strict = CooldownPolicy.From(new AppSettings { CooldownDays = 10, RepostDueDays = 30 });
        Assert.True(strict.Evaluate(Today.AddDays(-8), Today).InCooldown);
        Assert.False(strict.Evaluate(Today.AddDays(-20), Today).DueForRepost);
    }

    [Test]
    public void LastPosted_is_the_latest_Posted_or_Pending_row_for_the_title()
    {
        PostLogEntry Row(string title, int daysAgo, PostStatus status) =>
            new("", Today.AddDays(-daysAgo), new TimeOnly(9, 0), "Lot", title, status, "APG", "", "Jan");
        var posts = new[]
        {
            Row("Verdant Hills Lot 7", 20, PostStatus.Posted),
            Row("verdant hills  lot 7", 2, PostStatus.Pending),
            Row("Verdant Hills Lot 7", 9, PostStatus.Posted),
            Row("Verdant Hills Lot 12", 1, PostStatus.Posted),
        };

        Assert.Equal(Today.AddDays(-2), CooldownPolicy.LastPosted(posts, "Verdant Hills Lot 7"));
        Assert.Equal(Today.AddDays(-1), CooldownPolicy.LastPosted(posts, "VERDANT HILLS LOT 12"));
        Assert.Null(CooldownPolicy.LastPosted(posts, "Verdant Hills Lot 3"));
    }
}
