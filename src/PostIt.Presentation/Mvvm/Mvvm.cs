using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;

namespace PostIt.Presentation.Mvvm;

// Minimal MVVM toolkit (no NuGet). Commands re-evaluate CanExecute automatically:
// every property change on a ViewModelBase raises CanExecuteChanged on the commands it created.

public abstract class ObservableObject : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        OnPropertyChanged(name);
        return true;
    }

    /// <summary>Raise change notifications for computed properties.</summary>
    protected void Raise(params string[] names)
    {
        foreach (var n in names) OnPropertyChanged(n);
    }

    protected virtual void OnPropertyChanged(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

public interface IRefreshableCommand : ICommand
{
    void RaiseCanExecuteChanged();
}

public sealed class RelayCommand(Action execute, Func<bool>? canExecute = null) : IRefreshableCommand
{
    public event EventHandler? CanExecuteChanged;
    public bool CanExecute(object? parameter) => canExecute?.Invoke() ?? true;
    public void Execute(object? parameter) { if (CanExecute(parameter)) execute(); }
    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}

public sealed class RelayCommand<T>(Action<T?> execute, Func<T?, bool>? canExecute = null) : IRefreshableCommand
{
    public event EventHandler? CanExecuteChanged;
    public bool CanExecute(object? parameter) => canExecute?.Invoke(Cast(parameter)) ?? true;
    public void Execute(object? parameter) { if (CanExecute(parameter)) execute(Cast(parameter)); }
    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);

    private static T? Cast(object? p)
    {
        if (p is T t) return t;
        if (p is null) return default;
        var target = Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T);
        if (target.IsEnum && p is string s) return (T)Enum.Parse(target, s);
        return (T)Convert.ChangeType(p, target);
    }
}

/// <summary>Async command: disabled while running; exceptions go to <paramref name="onError"/>.</summary>
public sealed class AsyncRelayCommand(Func<Task> execute, Func<bool>? canExecute = null, Action<Exception>? onError = null)
    : ObservableObject, IRefreshableCommand
{
    private bool _isRunning;
    public event EventHandler? CanExecuteChanged;

    public bool IsRunning
    {
        get => _isRunning;
        private set { if (Set(ref _isRunning, value)) RaiseCanExecuteChanged(); }
    }

    public bool CanExecute(object? parameter) => !IsRunning && (canExecute?.Invoke() ?? true);
    public async void Execute(object? parameter) => await ExecuteAsync();

    public async Task ExecuteAsync()
    {
        if (!CanExecute(null)) return;
        IsRunning = true;
        try { await execute(); }
        catch (Exception ex) when (onError is not null) { onError(ex); }
        finally { IsRunning = false; }
    }

    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}

public sealed class AsyncRelayCommand<T>(Func<T?, Task> execute, Func<T?, bool>? canExecute = null, Action<Exception>? onError = null)
    : ObservableObject, IRefreshableCommand
{
    private bool _isRunning;
    public event EventHandler? CanExecuteChanged;

    public bool IsRunning
    {
        get => _isRunning;
        private set { if (Set(ref _isRunning, value)) RaiseCanExecuteChanged(); }
    }

    public bool CanExecute(object? parameter) => !IsRunning && (canExecute?.Invoke(parameter is T t ? t : default) ?? true);
    public async void Execute(object? parameter) => await ExecuteAsync(parameter is T t ? t : default);

    public async Task ExecuteAsync(T? parameter)
    {
        if (!CanExecute(parameter)) return;
        IsRunning = true;
        try { await execute(parameter); }
        catch (Exception ex) when (onError is not null) { onError(ex); }
        finally { IsRunning = false; }
    }

    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// Base for every view-model. Create commands with <see cref="Command"/> / <see cref="AsyncCommand"/>
/// so their CanExecute is refreshed on every property change — no manual RaiseCanExecuteChanged needed.
/// </summary>
public abstract class ViewModelBase : ObservableObject
{
    private readonly List<IRefreshableCommand> _commands = new();
    private bool _isBusy;

    public bool IsBusy { get => _isBusy; protected set => Set(ref _isBusy, value); }

    /// <summary>Where async command failures are reported. The shell sets this for pages.</summary>
    protected virtual void OnError(Exception ex) { }

    // Sync commands are guarded too: a failing host call (clipboard busy, folder gone) becomes an
    // OnError toast instead of an unhandled exception on the UI thread.
    protected RelayCommand Command(Action execute, Func<bool>? canExecute = null) =>
        Track(new RelayCommand(() => { try { execute(); } catch (Exception ex) { OnError(ex); } }, canExecute));

    protected RelayCommand<T> Command<T>(Action<T?> execute, Func<T?, bool>? canExecute = null) =>
        Track(new RelayCommand<T>(p => { try { execute(p); } catch (Exception ex) { OnError(ex); } }, canExecute));

    protected AsyncRelayCommand AsyncCommand(Func<Task> execute, Func<bool>? canExecute = null) =>
        Track(new AsyncRelayCommand(execute, canExecute, OnError));

    protected AsyncRelayCommand<T> AsyncCommand<T>(Func<T?, Task> execute, Func<T?, bool>? canExecute = null) =>
        Track(new AsyncRelayCommand<T>(execute, canExecute, OnError));

    private TCommand Track<TCommand>(TCommand command) where TCommand : IRefreshableCommand
    {
        _commands.Add(command);
        return command;
    }

    public void RefreshCommands()
    {
        foreach (var c in _commands) c.RaiseCanExecuteChanged();
    }

    protected override void OnPropertyChanged(string? name)
    {
        base.OnPropertyChanged(name);
        RefreshCommands();
    }

    /// <summary>Runs <paramref name="work"/> with IsBusy=true; failures go to OnError.</summary>
    protected async Task RunBusyAsync(Func<Task> work)
    {
        IsBusy = true;
        try { await work(); }
        catch (Exception ex) { OnError(ex); }
        finally { IsBusy = false; }
    }
}
