using System.IO;
using System.Windows;
using System.Windows.Threading;
using PostIt.App.Services;
using PostIt.Core;
using PostIt.Core.Google;
using PostIt.Presentation;

namespace PostIt.App;

/// <summary>Composition root: builds the storage adapters, services and the shell, then shows the window.</summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += OnUnhandledException;

        try
        {
            var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "APG.PostIt");
            Directory.CreateDirectory(dataFolder);

            var settings = new JsonSettingsStore(dataFolder);
            var clock = new SystemClock();

            // First run: copy the bundled PROTOTYPE sample folders + a tracker with history, and point settings at them.
            var sample = new SampleDataSeeder(settings, clock, Path.Combine(AppContext.BaseDirectory, "SampleData"));
            sample.EnsureSeeded();

            // The only place that knows whether this is the real thing or the
            // prototype. Settings carry a web app link and a key, so Google;
            // otherwise local folders and the bundled sample data. Everything
            // above this line is identical either way.
            var script = new ScriptClient(() =>
                (settings.Current.ScriptUrl, settings.Current.ScriptKey));

            IPropertyRepository properties;
            ITrackerRepository tracker;
            if (settings.Current.UsingGoogle)
            {
                properties = new ScriptPropertyRepository(script);
                tracker = new ScriptTrackerRepository(script);
            }
            else
            {
                properties = new FolderPropertyRepository(settings);
                tracker = new CsvTrackerRepository(settings);
            }

            var core = new CoreServices(
                new PostingService(properties, tracker, settings, clock),
                new AssignmentService(properties, tracker, settings, clock),
                new TrackerService(properties, tracker, settings, clock),
                settings,
                sample,
                clock);

            var shell = new ShellViewModel(core, new WpfUiServices(), new BackendConnection(script));
            var window = new MainWindow { DataContext = shell };
            MainWindow = window;
            window.Show();
            shell.Start();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"APG Post-It could not start.\n\n{ex.Message}", "APG Post-It", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private void OnUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        var message = e.Exception is UserFacingException ? e.Exception.Message : $"Unexpected error: {e.Exception.Message}";
        if (MainWindow?.DataContext is INotifier notifier) notifier.Notify(message, ToastKind.Error);
        else MessageBox.Show(message, "APG Post-It", MessageBoxButton.OK, MessageBoxImage.Warning);
        e.Handled = true;
    }
}
