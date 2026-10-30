namespace PostIt.Core;

/// <summary>
/// The repost rules: a property posted less than <see cref="CooldownDays"/> ago may not be posted again,
/// and one not posted for <see cref="RepostDueDays"/> or more is due for a repost.
/// </summary>
public sealed class CooldownPolicy(int cooldownDays, int repostDueDays)
{
    /// <summary>Days after a post during which the property may not be posted again (default 7).</summary>
    public int CooldownDays { get; } = cooldownDays;

    /// <summary>Days without a post after which the property is due for a repost (default 14).</summary>
    public int RepostDueDays { get; } = repostDueDays;

    /// <summary>The policy configured in <paramref name="settings"/>.</summary>
    public static CooldownPolicy From(AppSettings settings) => new(settings.CooldownDays, settings.RepostDueDays);

    /// <summary>Applies the rules to a property last posted on <paramref name="lastPosted"/>, as of <paramref name="asOf"/>.</summary>
    public CooldownState Evaluate(DateOnly? lastPosted, DateOnly asOf)
    {
        if (lastPosted is not DateOnly last) return CooldownState.Never;

        var daysSince = Math.Max(0, asOf.DayNumber - last.DayNumber);
        var availableOn = last.AddDays(CooldownDays);
        return new CooldownState(
            LastPosted: last,
            DaysSince: daysSince,
            InCooldown: daysSince < CooldownDays,
            DaysLeft: Math.Max(0, availableOn.DayNumber - asOf.DayNumber),
            AvailableOn: availableOn,
            DueForRepost: daysSince >= RepostDueDays,
            NeverPosted: false);
    }

    /// <summary>Latest Date among Posted/Pending rows whose Title matches <paramref name="title"/> (case/space-insensitive).</summary>
    public static DateOnly? LastPosted(IEnumerable<PostLogEntry> posts, string title)
    {
        var key = PropertyNameMatcher.Normalize(title);
        DateOnly? latest = null;
        foreach (var post in posts)
        {
            if (!CountsAsPosted(post) || PropertyNameMatcher.Normalize(post.Title) != key) continue;
            if (latest is null || post.Date > latest) latest = post.Date;
        }
        return latest;
    }

    /// <summary>Both live and awaiting-approval posts start the cooldown.</summary>
    internal static bool CountsAsPosted(PostLogEntry post) => post.Status is PostStatus.Posted or PostStatus.Pending;
}
