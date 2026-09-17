using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.ImdbHeatmap.Configuration;

/// <summary>
/// Plugin configuration for IMDb Heatmap &amp; Chart.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PluginConfiguration"/> class.
    /// </summary>
    public PluginConfiguration()
    {
        EnableHeatmap = true;
        EnableChart = true;
        DatasetBaseUrl = "https://cdn.jsdelivr.net/gh/ya0903/imdb-episode-dataset@main/data/shows";
        CacheTtlHours = 24;
        InvertGridDefault = false;
        Language = "auto";
    }

    /// <summary>
    /// Gets or sets a value indicating whether the IMDb Heatmap grid should be displayed.
    /// </summary>
    public bool EnableHeatmap { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the IMDb rating chart should be displayed.
    /// </summary>
    public bool EnableChart { get; set; }

    /// <summary>
    /// Gets or sets the base URL for fetching IMDb episode rating datasets.
    /// </summary>
    public string DatasetBaseUrl { get; set; }

    /// <summary>
    /// Gets or sets the client-side dataset cache TTL in hours.
    /// </summary>
    public int CacheTtlHours { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether grid axes should be inverted by default.
    /// </summary>
    public bool InvertGridDefault { get; set; }

    /// <summary>
    /// Gets or sets the language setting ("auto", "en", "fr").
    /// </summary>
    public string Language { get; set; }
}
