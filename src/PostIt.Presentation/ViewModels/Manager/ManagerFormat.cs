using System.Globalization;
using PostIt.Core;

namespace PostIt.Presentation.ViewModels;

/// <summary>Display strings shared by the manager screens (English dates whatever the PC's region).</summary>
internal static class ManagerFormat
{
    /// <summary>"Thu 29 Oct 2026".</summary>
    public static string LongDate(DateOnly date) => date.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);

    /// <summary>"Thu 29 Oct".</summary>
    public static string ShortDate(DateOnly date) => date.ToString("ddd d MMM", CultureInfo.InvariantCulture);

    /// <summary>"29 Oct".</summary>
    public static string DayMonth(DateOnly date) => date.ToString("d MMM", CultureInfo.InvariantCulture);

    /// <summary>"Jan Dela Cruz" → "Jan".</summary>
    public static string FirstName(string? fullName)
    {
        var parts = (fullName ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 0 ? (fullName ?? "") : parts[0];
    }

    /// <summary>"1 property", "5 properties".</summary>
    public static string Count(int n, string one, string many) => n == 1 ? $"1 {one}" : $"{n} {many}";

    /// <summary>"1 day", "5 days".</summary>
    public static string Days(int n) => Count(n, "day", "days");

    /// <summary>"In cooldown until…" → "in cooldown until…" (for "Can't add: …").</summary>
    public static string LowerFirst(string? text) =>
        string.IsNullOrEmpty(text) ? "" : char.ToLowerInvariant(text[0]) + text[1..];

    /// <summary>"…" → "…" with the first letter in capitals.</summary>
    public static string UpperFirst(string? text) =>
        string.IsNullOrEmpty(text) ? "" : char.ToUpperInvariant(text[0]) + text[1..];

    /// <summary>Same person: trimmed, case-insensitive.</summary>
    public static bool SamePerson(string? a, string? b) =>
        string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Same property: compared the way the tracker matches names.</summary>
    public static bool SameProperty(string? a, string? b) =>
        PropertyNameMatcher.Normalize(a ?? "") == PropertyNameMatcher.Normalize(b ?? "");

    /// <summary>"Category · Location" without empty parts.</summary>
    public static string Join(params string?[] parts) =>
        string.Join(" · ", parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));
}
