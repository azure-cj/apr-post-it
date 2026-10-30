using System.Text.RegularExpressions;

namespace PostIt.Core;

/// <summary>
/// The checks shown before an intern copies the posting text. A <see cref="CheckStatus.Fail"/> blocks Copy;
/// a <see cref="CheckStatus.Warn"/> asks the intern to look again.
/// </summary>
public static class PrePostChecker
{
    private const RegexOptions Options = RegexOptions.CultureInvariant;

    // ₱4.2M · PHP 4,200,000 · P3.6 million · ₱180K / month
    private static readonly Regex CurrencyAmount = new(
        @"(?<![\p{L}\p{N}])(?:₱|PHP|Php|P)\s?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?(?i:million|thousand|mil|m|k)\b)?(?:\s*(?:/|per)\s*(?i:month|mo)\b)?",
        Options);

    private static readonly Regex PriceLine = new(@"^\s*price\s*:(?<value>.*\d.*)$", Options | RegexOptions.IgnoreCase | RegexOptions.Multiline);

    // PH mobiles (0917 000 0000, +63 917 000 0000) and landlines like (02) 8123 4567.
    private static readonly Regex ContactNumber = new(
        @"(?<!\d)(?:(?:\+?63|0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}|\(\d{2,4}\)\s?\d{3,4}[\s-]?\d{4})(?!\d)",
        Options);

    private static readonly Regex CommissionWording = new(
        @"\bcommissions?\b|\bcomm\.?\s*\d+(?:\.\d+)?\s*%?|\breferral\s+fees?\b|\bagent['’]?s?\s+(?:share|fee|cut)s?\b|\bincentives?\b" +
        @"|\bnet\s+to\s+owner\b|\d+(?:\.\d+)?\s*%\s*to\s+(?:the\s+)?agents?\b|\bfinder['’]?s?\s+fees?\b|\brebates?\b",
        Options | RegexOptions.IgnoreCase);

    /// <summary>Runs every check on the public part of the doc. Always returns the four checks in the same order.</summary>
    public static IReadOnlyList<CheckResult> Run(PostingText text)
    {
        var publicText = text.PublicText;
        return new[]
        {
            CheckPrice(publicText),
            CheckContacts(publicText),
            CheckCommission(publicText),
            text.HasInternalSection
                ? new CheckResult("Internal section hidden", CheckStatus.Pass, "Kept out of the copy")
                : new CheckResult("Internal section hidden", CheckStatus.Warn, "No internal marker found — check the whole text before posting"),
        };
    }

    private static CheckResult CheckPrice(string text)
    {
        const string name = "Price present";
        var amount = CurrencyAmount.Match(text);
        if (amount.Success) return new CheckResult(name, CheckStatus.Pass, amount.Value.Trim());

        var line = PriceLine.Match(text);
        return line.Success
            ? new CheckResult(name, CheckStatus.Pass, line.Groups["value"].Value.Trim())
            : new CheckResult(name, CheckStatus.Warn, "No price found in the public text");
    }

    private static CheckResult CheckContacts(string text)
    {
        const string name = "Contact numbers present";
        var distinct = ContactNumber.Matches(text)
            .Select(m => new string(m.Value.Where(char.IsDigit).ToArray()))
            .Distinct()
            .Count();
        return distinct > 0
            ? new CheckResult(name, CheckStatus.Pass, $"{distinct} found")
            : new CheckResult(name, CheckStatus.Warn, "No contact number found");
    }

    private static CheckResult CheckCommission(string text)
    {
        const string name = "No commission wording";
        var hit = CommissionWording.Match(text);
        return hit.Success
            ? new CheckResult(name, CheckStatus.Fail, $"Found \"{hit.Value.Trim()}\" — remove it before posting")
            : new CheckResult(name, CheckStatus.Pass, "Clean");
    }
}
