using System;
using System.IO;
using System.Net.Mime;
using System.Reflection;
using Jellyfin.Plugin.ImdbHeatmap.Configuration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.ImdbHeatmap.Controllers;

/// <summary>
/// API Controller for IMDb Heatmap &amp; Chart resources and configuration.
/// </summary>
[ApiController]
[Route("ImdbHeatmap")]
public class ImdbHeatmapController : ControllerBase
{
    /// <summary>
    /// Serves the client-side JavaScript for embedding IMDb Heatmap &amp; Chart into Jellyfin Web.
    /// </summary>
    /// <returns>JavaScript file content.</returns>
    [HttpGet("script.js")]
    [Produces("application/javascript")]
    [AllowAnonymous]
    public ActionResult GetClientScript()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var scriptNames = new[]
        {
            "Jellyfin.Plugin.ImdbHeatmap.Configuration.Common.common.js",
            "Jellyfin.Plugin.ImdbHeatmap.Configuration.Heatmap.heatmap.js",
            "Jellyfin.Plugin.ImdbHeatmap.Configuration.Chart.chart.js"
        };

        var builder = new System.Text.StringBuilder();
        foreach (var resourceName in scriptNames)
        {
            using var stream = assembly.GetManifestResourceStream(resourceName);
            if (stream != null)
            {
                using var reader = new StreamReader(stream);
                builder.AppendLine(reader.ReadToEnd());
                builder.AppendLine(";");
            }
        }

        var jsContent = builder.ToString();
        if (string.IsNullOrWhiteSpace(jsContent))
        {
            return NotFound("Client script resources not found.");
        }

        return Content(jsContent, "application/javascript");
    }

    /// <summary>
    /// Serves the stylesheet for IMDb Heatmap &amp; Chart.
    /// </summary>
    /// <returns>CSS stylesheet file content.</returns>
    [HttpGet("style.css")]
    [Produces("text/css")]
    [AllowAnonymous]
    public ActionResult GetStylesheet()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var styleNames = new[]
        {
            "Jellyfin.Plugin.ImdbHeatmap.Configuration.Common.common.css",
            "Jellyfin.Plugin.ImdbHeatmap.Configuration.Heatmap.heatmap.css",
            "Jellyfin.Plugin.ImdbHeatmap.Configuration.Chart.chart.css"
        };

        var builder = new System.Text.StringBuilder();
        foreach (var resourceName in styleNames)
        {
            using var stream = assembly.GetManifestResourceStream(resourceName);
            if (stream != null)
            {
                using var reader = new StreamReader(stream);
                builder.AppendLine(reader.ReadToEnd());
            }
        }

        var cssContent = builder.ToString();
        if (string.IsNullOrWhiteSpace(cssContent))
        {
            return NotFound("Stylesheet resources not found.");
        }

        return Content(cssContent, "text/css");
    }

    /// <summary>
    /// Gets current plugin configuration.
    /// </summary>
    /// <returns>The plugin configuration instance.</returns>
    [HttpGet("Config")]
    [Produces(MediaTypeNames.Application.Json)]
    [AllowAnonymous]
    public ActionResult<PluginConfiguration> GetConfig()
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        return Ok(config);
    }

    /// <summary>
    /// Gets translations dictionary for requested language code (e.g., 'en', 'fr').
    /// </summary>
    /// <param name="lang">Optional requested language code.</param>
    /// <returns>JSON object with localization key-values.</returns>
    [HttpGet("Translations")]
    [Produces(MediaTypeNames.Application.Json)]
    [AllowAnonymous]
    public ActionResult GetTranslations([FromQuery] string? lang)
    {
        var configLang = Plugin.Instance?.Configuration?.Language ?? "auto";
        var requestedLang = (string.IsNullOrWhiteSpace(lang) || lang.Equals("auto", StringComparison.OrdinalIgnoreCase))
            ? configLang
            : lang;

        requestedLang = requestedLang.ToLowerInvariant();
        if (requestedLang.StartsWith("fr", StringComparison.OrdinalIgnoreCase))
        {
            requestedLang = "fr";
        }
        else
        {
            requestedLang = "en";
        }

        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = $"Jellyfin.Plugin.ImdbHeatmap.Localization.{requestedLang}.json";

        using var stream = assembly.GetManifestResourceStream(resourceName);
        if (stream == null)
        {
            resourceName = "Jellyfin.Plugin.ImdbHeatmap.Localization.en.json";
            using var fallbackStream = assembly.GetManifestResourceStream(resourceName);
            if (fallbackStream == null)
            {
                return NotFound("Localization file not found.");
            }

            using var fallbackReader = new StreamReader(fallbackStream);
            return Content(fallbackReader.ReadToEnd(), MediaTypeNames.Application.Json);
        }

        using var reader = new StreamReader(stream);
        return Content(reader.ReadToEnd(), MediaTypeNames.Application.Json);
    }
}
