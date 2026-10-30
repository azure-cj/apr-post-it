using System.Globalization;

namespace PostIt.Core;

/// <summary>Small helpers that keep user-facing sentences consistent ("1 day", "Tue 3 Nov", "Jan").</summary>
internal static class Wording
{
    /// <summary>"1 day", "5 days".</summary>
    public static string Days(int n) => n == 1 ? "1 day" : $"{n} days";

    /// <summary>"today", "1 day ago", "5 days ago".</summary>
    public static string DaysAgo(int n) => n == 0 ? "today" : $"{Days(n)} ago";

    /// <summary>Formats a date in English regardless of the PC's regional settings, e.g. "ddd d MMM" → "Tue 3 Nov".</summary>
    public static string Date(DateOnly date, string format) => date.ToString(format, CultureInfo.InvariantCulture);

    /// <summary>"Jan Dela Cruz" → "Jan".</summary>
    public static string FirstName(string fullName)
    {
        var parts = fullName.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 0 ? fullName : parts[0];
    }

    /// <summary>Same person: trimmed, case-insensitive.</summary>
    public static bool SamePerson(string? a, string? b) =>
        string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
}
