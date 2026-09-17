using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.ImdbHeatmap.Services;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.ImdbHeatmap;

/// <summary>
/// Hosted background service that runs at Jellyfin startup after services are initialized.
/// </summary>
public class ServerEntryPoint : IHostedService
{
    private readonly ILogger<ServerEntryPoint> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="ServerEntryPoint"/> class.
    /// </summary>
    /// <param name="logger">Instance of <see cref="ILogger{ServerEntryPoint}"/>.</param>
    public ServerEntryPoint(ILogger<ServerEntryPoint> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("[IMDb Heatmap] Server startup completed. Registering with JavaScript Injector...");
        JsInjectorIntegration.TryRegister(_logger);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }
}
