using System.Text.RegularExpressions;

namespace PostIt.Core;

/// <summary>
/// Splits a posting doc into the text that may be posted and the internal notes that must never be.
/// <list type="bullet">
/// <item>A leading block of <c>Category:</c> / <c>Type:</c> / <c>Location:</c> lines is metadata, not posting text.</item>
/// <item>The first line that looks like an internal marker (e.g. <c>=== INTERNAL — DO NOT POST ===</c>) starts the internal part.</item>
/// </list>
/// </summary>
public static class PostingTextParser
{
    private static readonly Regex MetadataLine = new(
        @"^\s*(?<key>category|type|location)\s*:\s*(?<value>.*?)\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex InternalMarker = new(
        @"^\s*[=\-#*_~>\[\(]*\s*(internal|for internal use|internal notes?|internal only|agent['’]?s?\s+notes?|do not post|not for posting|for agents only)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>Parses the raw text of a posting doc (any line endings, optional BOM).</summary>
    public static PostingText Parse(string raw)
    {
        var lines = (raw ?? "").TrimStart('﻿').Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');

        var (category, location, bodyStart) = ReadMetadata(lines);

        var markerAt = Array.FindIndex(lines, bodyStart, line => InternalMarker.IsMatch(line));
        var publicLines = lines[bodyStart..(markerAt < 0 ? lines.Length : markerAt)];
        var internalLines = markerAt < 0 ? Array.Empty<string>() : lines[(markerAt + 1)..];

        return new PostingText(Tidy(publicLines), Tidy(internalLines), markerAt >= 0, category, location);
    }

    /// <summary>Reads the metadata lines at the very top (blank lines between them allowed).</summary>
    private static (string? Category, string? Location, int BodyStart) ReadMetadata(string[] lines)
    {
        string? category = null, location = null;
        var bodyStart = 0;
        for (var i = 0; i < lines.Length; i++)
        {
            if (string.IsNullOrWhiteSpace(lines[i])) continue;
            var m = MetadataLine.Match(lines[i]);
            if (!m.Success) break;

            var value = m.Groups["value"].Value;
            if (value.Length > 0)
            {
                if (m.Groups["key"].Value.Equals("location", StringComparison.OrdinalIgnoreCase)) location ??= value;
                else category ??= value;
            }
            bodyStart = i + 1;
        }
        return (category, location, bodyStart);
    }

    /// <summary>Trims trailing spaces, drops leading/trailing blank lines and collapses runs of blank lines to one.</summary>
    private static string Tidy(IEnumerable<string> lines)
    {
        var kept = new List<string>();
        foreach (var line in lines.Select(l => l.TrimEnd()))
        {
            if (line.Length == 0 && (kept.Count == 0 || kept[^1].Length == 0)) continue;
            kept.Add(line);
        }
        if (kept.Count > 0 && kept[^1].Length == 0) kept.RemoveAt(kept.Count - 1);
        return string.Join("\n", kept);
    }
}
