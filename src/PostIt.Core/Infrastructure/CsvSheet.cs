using System.Text;

namespace PostIt.Core;

/// <summary>
/// One tab of the tracker as a CSV file (RFC 4180): a header row plus data rows. Every row keeps its exact
/// original text until it is changed, so rows the app can't understand are written back untouched.
/// Saving goes through a temp file in the same folder and replaces the original in one step.
/// </summary>
internal sealed class CsvSheet
{
    private static readonly Encoding Utf8WithBom = new UTF8Encoding(encoderShouldEmitUTF8Identifier: true);

    private CsvSheet(CsvRow header, List<CsvRow> rows) => (Header, Rows) = (header, rows);

    /// <summary>Sheet row 1.</summary>
    public CsvRow Header { get; }

    /// <summary>Data rows; <c>Rows[i]</c> is sheet row <c>i + 2</c>.</summary>
    public List<CsvRow> Rows { get; }

    /// <summary>An empty sheet with just a header.</summary>
    public static CsvSheet Empty(IReadOnlyList<string> header) => new(CsvRow.From(header), new List<CsvRow>());

    /// <summary>Parses CSV text. An empty text gives <paramref name="defaultHeader"/>.</summary>
    public static CsvSheet Parse(string text, IReadOnlyList<string> defaultHeader)
    {
        var records = ReadRecords(text.TrimStart('﻿')).ToList();
        return records.Count == 0 ? Empty(defaultHeader) : new CsvSheet(records[0], records.Skip(1).ToList());
    }

    /// <summary>The file as text, CRLF line endings (what Excel writes).</summary>
    public string ToText()
    {
        var text = new StringBuilder();
        foreach (var row in Rows.Prepend(Header)) text.Append(row.Raw).Append("\r\n");
        return text.ToString();
    }

    /// <summary>Position of the column named <paramref name="name"/> in this file's header (case-insensitive), else <paramref name="fallback"/>.</summary>
    public int Column(string name, int fallback)
    {
        for (var i = 0; i < Header.Fields.Count; i++)
            if (string.Equals(Header.Fields[i].Trim(), name, StringComparison.OrdinalIgnoreCase)) return i;
        return fallback;
    }

    /// <summary>Appends a row after the last non-blank row.</summary>
    public void Append(CsvRow row)
    {
        while (Rows.Count > 0 && Rows[^1].IsBlank) Rows.RemoveAt(Rows.Count - 1);
        Rows.Add(row);
    }

    // ---------------------------------------------------------------- files

    /// <summary>Reads <paramref name="path"/>; a missing file is an empty sheet.</summary>
    public static CsvSheet Load(string path, IReadOnlyList<string> defaultHeader)
    {
        if (!File.Exists(path)) return Empty(defaultHeader);
        var text = WithFile(path, () =>
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            return TextFile.Read(stream);
        });
        return Parse(text, defaultHeader);
    }

    /// <summary>Writes the sheet (UTF-8 with BOM, so Excel shows ₱ and ñ) via a temp file that replaces the original.</summary>
    public void Save(string path)
    {
        var folder = Path.GetDirectoryName(Path.GetFullPath(path))!;
        var temp = Path.Combine(folder, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            WithFile(path, () =>
            {
                File.WriteAllText(temp, ToText(), Utf8WithBom);
                if (File.Exists(path)) File.Replace(temp, path, destinationBackupFileName: null);
                else File.Move(temp, path);
                return true;
            });
        }
        finally
        {
            try { File.Delete(temp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    /// <summary>Runs a file operation, retrying briefly (Drive sync holds files for a moment) and turning locks into plain English.</summary>
    private static T WithFile<T>(string path, Func<T> operation)
    {
        var name = Path.GetFileName(path);
        for (var attempt = 1; ; attempt++)
        {
            try { return operation(); }
            catch (IOException ex) when (ex is not FileNotFoundException and not DirectoryNotFoundException)
            {
                if (attempt < 3) { Thread.Sleep(100); continue; }
                throw new UserFacingException($"{name} is open in another program (Excel?). Close it and try again.", ex);
            }
            catch (UnauthorizedAccessException ex)
            {
                throw new UserFacingException($"{name} can't be changed. It may be read-only, or you may not have access to the tracker folder.", ex);
            }
        }
    }

    // ---------------------------------------------------------------- parsing

    /// <summary>Splits text into records. Quoted fields may hold commas, quotes ("") and line breaks.</summary>
    private static IEnumerable<CsvRow> ReadRecords(string text)
    {
        var pos = 0;
        while (pos < text.Length)
        {
            var start = pos;
            var fields = new List<string>();
            var field = new StringBuilder();
            bool inQuotes = false, atFieldStart = true;
            var end = text.Length;

            while (pos < text.Length)
            {
                var c = text[pos];
                if (inQuotes)
                {
                    if (c == '"' && pos + 1 < text.Length && text[pos + 1] == '"') { field.Append('"'); pos += 2; }
                    else if (c == '"') { inQuotes = false; pos++; }
                    else { field.Append(c); pos++; }
                    continue;
                }
                if (c is '\r' or '\n')
                {
                    end = pos;
                    pos += c == '\r' && pos + 1 < text.Length && text[pos + 1] == '\n' ? 2 : 1;
                    break;
                }
                pos++;
                if (c == ',') { fields.Add(field.ToString()); field.Clear(); atFieldStart = true; continue; }
                if (c == '"' && atFieldStart) inQuotes = true;
                else field.Append(c); // a stray quote inside an unquoted field is kept as text, like Excel does
                atFieldStart = false;
            }

            if (inQuotes)
            {
                // Unclosed quote: don't swallow the rest of the file. Keep this line as an unreadable row and carry on.
                var lineBreak = text.IndexOfAny(new[] { '\r', '\n' }, start);
                end = lineBreak < 0 ? text.Length : lineBreak;
                pos = end;
                if (pos < text.Length) pos += text[pos] == '\r' && pos + 1 < text.Length && text[pos + 1] == '\n' ? 2 : 1;
                yield return new CsvRow(text[start..end], Array.Empty<string>());
                continue;
            }

            fields.Add(field.ToString());
            yield return new CsvRow(text[start..end], fields);
        }
    }
}

/// <summary>One CSV record: its exact text and its fields.</summary>
internal sealed class CsvRow
{
    /// <summary>A row read from a file. <paramref name="fields"/> is empty when the text could not be split.</summary>
    public CsvRow(string raw, IReadOnlyList<string> fields) => (Raw, Fields) = (raw, fields);

    /// <summary>The record exactly as it appears in the file (without its line break).</summary>
    public string Raw { get; }

    public IReadOnlyList<string> Fields { get; }

    /// <summary>True for an empty line or a row of empty cells.</summary>
    public bool IsBlank => Fields.All(string.IsNullOrWhiteSpace) && Raw.Trim(' ', ',', '\t').Length == 0;

    /// <summary>A new row holding <paramref name="fields"/>, quoted where needed.</summary>
    public static CsvRow From(IEnumerable<string> fields)
    {
        var list = fields.ToList();
        return new CsvRow(string.Join(",", list.Select(Quote)), list);
    }

    /// <summary>The trimmed value of a column ("" when the row is shorter).</summary>
    public string Get(int column) => column >= 0 && column < Fields.Count ? Fields[column].Trim() : "";

    /// <summary>A copy with the given columns set; other columns (e.g. ones added in Excel) are kept.</summary>
    public CsvRow With(params (int Column, string Value)[] values)
    {
        var width = Math.Max(Fields.Count, values.Max(v => v.Column) + 1);
        var fields = Enumerable.Range(0, width).Select(i => i < Fields.Count ? Fields[i] : "").ToArray();
        foreach (var (column, value) in values) fields[column] = value;
        return From(fields);
    }

    private static string Quote(string field) =>
        field.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0 || field != field.Trim()
            ? "\"" + field.Replace("\"", "\"\"") + "\""
            : field;
}
