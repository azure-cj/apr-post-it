using System.Diagnostics;
using System.Reflection;

namespace PostIt.Tests;

// A tiny test framework so the solution needs no NuGet packages (xUnit etc. need nuget.org).
// Mark public methods in public classes with [Test]; they may return void or Task.
// Run:  dotnet run --project tests/PostIt.Tests [-- <filter text>]

[AttributeUsage(AttributeTargets.Method)]
public sealed class TestAttribute : Attribute { }

public sealed class AssertionException(string message) : Exception(message);

public static class Assert
{
    public static void True(bool condition, string? message = null)
    {
        if (!condition) throw new AssertionException(message ?? "Expected true but was false.");
    }

    public static void False(bool condition, string? message = null)
    {
        if (condition) throw new AssertionException(message ?? "Expected false but was true.");
    }

    public static void Equal<T>(T expected, T actual, string? message = null)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new AssertionException($"{message}{(message is null ? "" : ": ")}expected <{expected}> but was <{actual}>.");
    }

    public static void NotEqual<T>(T notExpected, T actual, string? message = null)
    {
        if (EqualityComparer<T>.Default.Equals(notExpected, actual))
            throw new AssertionException($"{message}{(message is null ? "" : ": ")}did not expect <{actual}>.");
    }

    public static void Null(object? value, string? message = null)
    {
        if (value is not null) throw new AssertionException(message ?? $"Expected null but was <{value}>.");
    }

    public static T NotNull<T>(T? value, string? message = null) where T : class
    {
        if (value is null) throw new AssertionException(message ?? "Expected a value but was null.");
        return value;
    }

    public static void Contains(string expectedSubstring, string? actual, string? message = null)
    {
        if (actual is null || !actual.Contains(expectedSubstring, StringComparison.OrdinalIgnoreCase))
            throw new AssertionException($"{message}{(message is null ? "" : ": ")}expected to contain \"{expectedSubstring}\" but was \"{actual}\".");
    }

    public static void DoesNotContain(string unexpected, string? actual, string? message = null)
    {
        if (actual is not null && actual.Contains(unexpected, StringComparison.OrdinalIgnoreCase))
            throw new AssertionException($"{message}{(message is null ? "" : ": ")}did not expect \"{unexpected}\" in \"{actual}\".");
    }

    public static void Count<T>(int expected, IEnumerable<T> items, string? message = null)
    {
        var n = items.Count();
        if (n != expected) throw new AssertionException($"{message}{(message is null ? "" : ": ")}expected {expected} items but found {n}.");
    }

    public static TException Throws<TException>(Action action) where TException : Exception
    {
        try { action(); }
        catch (TException ex) { return ex; }
        catch (Exception ex) { throw new AssertionException($"Expected {typeof(TException).Name} but got {ex.GetType().Name}: {ex.Message}"); }
        throw new AssertionException($"Expected {typeof(TException).Name} but nothing was thrown.");
    }

    public static async Task<TException> ThrowsAsync<TException>(Func<Task> action) where TException : Exception
    {
        try { await action(); }
        catch (TException ex) { return ex; }
        catch (Exception ex) { throw new AssertionException($"Expected {typeof(TException).Name} but got {ex.GetType().Name}: {ex.Message}"); }
        throw new AssertionException($"Expected {typeof(TException).Name} but nothing was thrown.");
    }
}

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var filter = args.Length > 0 ? args[0] : null;
        var tests = typeof(Program).Assembly.GetTypes()
            .Where(t => t.IsClass && t.IsPublic && !t.IsAbstract)
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance)
                .Where(m => m.GetCustomAttribute<TestAttribute>() is not null)
                .Select(m => (Type: t, Method: m)))
            .Where(x => filter is null || $"{x.Type.Name}.{x.Method.Name}".Contains(filter, StringComparison.OrdinalIgnoreCase))
            .OrderBy(x => x.Type.FullName).ThenBy(x => x.Method.Name)
            .ToList();

        int passed = 0, failed = 0;
        var sw = Stopwatch.StartNew();
        foreach (var (type, method) in tests)
        {
            var name = $"{type.Name}.{method.Name}";
            try
            {
                var instance = Activator.CreateInstance(type)!;
                var result = method.Invoke(instance, null);
                if (result is Task task) await task;
                if (instance is IDisposable d) d.Dispose();
                passed++;
                Console.WriteLine($"  PASS  {name}");
            }
            catch (Exception ex)
            {
                var inner = ex is TargetInvocationException tie && tie.InnerException is not null ? tie.InnerException : ex;
                failed++;
                Console.WriteLine($"  FAIL  {name}\n        {inner.GetType().Name}: {inner.Message}");
                if (inner is not AssertionException)
                    Console.WriteLine("        " + (inner.StackTrace ?? "").Split('\n').FirstOrDefault(l => l.Contains("PostIt"))?.Trim());
            }
        }

        Console.WriteLine($"\n{passed} passed, {failed} failed, {tests.Count} total ({sw.ElapsedMilliseconds} ms)");
        return failed == 0 ? 0 : 1;
    }
}
