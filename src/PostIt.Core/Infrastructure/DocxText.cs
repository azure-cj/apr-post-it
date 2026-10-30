using System.IO.Compression;
using System.Text;
using System.Xml.Linq;

namespace PostIt.Core;

/// <summary>Reads the plain text of a Word .docx without Word: one line per paragraph.</summary>
internal static class DocxText
{
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    /// <summary>
    /// Paragraphs joined with "\n"; tabs as "\t" and line breaks as "\n".
    /// Throws <see cref="InvalidDataException"/> or <see cref="System.Xml.XmlException"/> for a damaged file.
    /// </summary>
    public static string Read(Stream docx)
    {
        using var zip = new ZipArchive(docx, ZipArchiveMode.Read, leaveOpen: true);
        var entry = zip.GetEntry("word/document.xml") ?? throw new InvalidDataException("word/document.xml is missing.");

        XDocument xml;
        using (var stream = entry.Open()) xml = XDocument.Load(stream);

        var paragraphs = xml.Descendants(W + "p").Select(ParagraphText);
        return string.Join("\n", paragraphs);
    }

    private static string ParagraphText(XElement paragraph)
    {
        var text = new StringBuilder();
        foreach (var e in paragraph.Descendants())
        {
            // Text boxes nest whole paragraphs inside a paragraph; those are read on their own.
            if (e.Ancestors(W + "p").First() != paragraph) continue;

            if (e.Name == W + "t") text.Append(e.Value);
            else if (e.Name == W + "tab") text.Append('\t');
            else if (e.Name == W + "br" || e.Name == W + "cr") text.Append('\n');
        }
        return text.ToString();
    }
}
