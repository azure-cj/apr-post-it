using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace PostIt.Core;

/// <summary>
/// Matches property names the way people type them: case, punctuation, accents, "&amp;" and the usual
/// abbreviations (Blk, Lt, Ph, Bldg) don't matter, and small typos get a suggestion — but never one
/// with a different lot/unit number.
/// </summary>
public static class PropertyNameMatcher
{
    /// <summary>A suggestion needs at least this score (0..1).</summary>
    private const double SuggestionThreshold = 0.75;

    private static readonly Dictionary<string, string> Abbreviations = new()
    {
        ["blk"] = "block", ["lt"] = "lot", ["ph"] = "phase", ["bldg"] = "building",
    };

    private static readonly Regex DigitRun = new(@"\d+", RegexOptions.CultureInvariant);

    /// <summary>"Sunrise Homes Blk. 3, Lt 9" → "sunrise homes block 3 lot 9".</summary>
    public static string Normalize(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";

        var text = RemoveAccents(name.ToLowerInvariant()).Replace("&", " and ").Replace("'", "").Replace("’", "");
        var spaced = new StringBuilder(text.Length);
        foreach (var c in text) spaced.Append(char.IsLetterOrDigit(c) ? c : ' ');

        var tokens = spaced.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => Abbreviations.TryGetValue(t, out var full) ? full : t);
        return string.Join(' ', tokens);
    }

    /// <summary>Exact (normalized) match, else best fuzzy suggestion, else NotFound.</summary>
    public static (PasteMatchKind Kind, string? Name) Match(string typed, IEnumerable<string> names)
    {
        var target = Normalize(typed);
        if (target.Length == 0) return (PasteMatchKind.NotFound, null);

        var candidates = names.Select(n => (Name: n, Key: Normalize(n))).ToList();
        foreach (var c in candidates)
            if (c.Key == target) return (PasteMatchKind.Exact, c.Name);

        string? best = null;
        var bestScore = 0.0;
        foreach (var c in candidates)
        {
            var score = Similarity(target, c.Key);
            if (score > bestScore) (best, bestScore) = (c.Name, score);
        }
        return bestScore >= SuggestionThreshold ? (PasteMatchKind.Suggestion, best) : (PasteMatchKind.NotFound, null);
    }

    /// <summary>0..1 similarity of two normalised names; numbers must agree or the score is cut.</summary>
    private static double Similarity(string typed, string candidate)
    {
        var maxLength = Math.Max(typed.Length, candidate.Length);
        var score = maxLength == 0 ? 1.0 : 1.0 - (double)Levenshtein(typed, candidate) / maxLength;

        var candidateTokens = candidate.Split(' ').ToHashSet();
        if (typed.Split(' ').All(candidateTokens.Contains)) score = Math.Max(score, 0.9);

        if (!Numbers(typed).SequenceEqual(Numbers(candidate))) score *= 0.6;
        return score;
    }

    private static IEnumerable<string> Numbers(string s) => DigitRun.Matches(s).Select(m => m.Value.TrimStart('0'));

    private static int Levenshtein(string a, string b)
    {
        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++) previous[j] = j;

        for (var i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + cost);
            }
            (previous, current) = (current, previous);
        }
        return previous[b.Length];
    }

    private static string RemoveAccents(string s)
    {
        var decomposed = s.Normalize(NormalizationForm.FormD);
        var kept = decomposed.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark);
        return new string(kept.ToArray()).Normalize(NormalizationForm.FormC);
    }
}
