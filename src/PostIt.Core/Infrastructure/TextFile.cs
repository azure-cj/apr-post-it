using System.Text;

namespace PostIt.Core;

/// <summary>Decodes text files the way people actually save them on Windows.</summary>
internal static class TextFile
{
    private static readonly Encoding StrictUtf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>UTF-8 with or without BOM (UTF-16 when it has a BOM); falls back to Latin-1 for files saved as "ANSI".</summary>
    public static string Decode(byte[] bytes)
    {
        try
        {
            using var reader = new StreamReader(new MemoryStream(bytes), StrictUtf8, detectEncodingFromByteOrderMarks: true);
            return reader.ReadToEnd();
        }
        catch (DecoderFallbackException)
        {
            return Encoding.Latin1.GetString(bytes);
        }
    }

    /// <summary>Reads the whole stream and decodes it with <see cref="Decode"/>.</summary>
    public static string Read(Stream stream)
    {
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return Decode(buffer.ToArray());
    }
}
