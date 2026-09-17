using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.ImdbHeatmap.Services;

/// <summary>
/// Integration service with n00bcodr's Jellyfin.Plugin.JavaScriptInjector.
/// Dynamically registers client script and stylesheet loader into JavaScript Injector plugin.
/// </summary>
public static class JsInjectorIntegration
{
    private const string ScriptId = "3f8a9e7d-1c2b-4a5f-8e9d-0c1b2a3f4e5d-imdb-heatmap";
    private const string JavaScriptInjectorAssemblyName = "Jellyfin.Plugin.JavaScriptInjector";
    private const string JavaScriptInjectorInterfaceTypeName = "Jellyfin.Plugin.JavaScriptInjector.PluginInterface";

    /// <summary>
    /// Alias method to attempt registration with JavaScript Injector.
    /// </summary>
    /// <param name="logger">Optional logger instance.</param>
    public static void RegisterScript(ILogger? logger = null)
    {
        TryRegister(logger);
    }

    /// <summary>
    /// Attempts to register the client loader script with JavaScript Injector.
    /// </summary>
    /// <param name="logger">Optional logger instance.</param>
    /// <returns>True if registration succeeded; otherwise false.</returns>
    public static bool TryRegister(ILogger? logger = null)
    {
        return TrySetEnabled(logger, true);
    }

    /// <summary>
    /// Registers or unregisters the script with JavaScript Injector.
    /// </summary>
    /// <param name="logger">Optional logger instance.</param>
    /// <param name="enabled">Whether the script should be enabled.</param>
    /// <returns>True if registration succeeded; otherwise false.</returns>
    public static bool TrySetEnabled(ILogger? logger, bool enabled)
    {
        try
        {
            Plugin? plugin = Plugin.Instance;
            if (plugin is null)
            {
                logger?.LogWarning("[IMDb Heatmap] Plugin instance was not available for JavaScript Injector registration.");
                return false;
            }

            Assembly? javaScriptInjectorAssembly = AssemblyLoadContext.All
                .SelectMany(context => context.Assemblies)
                .Concat(AppDomain.CurrentDomain.GetAssemblies())
                .Distinct()
                .FirstOrDefault(assembly =>
                    assembly.FullName?.Contains(JavaScriptInjectorAssemblyName, StringComparison.OrdinalIgnoreCase) == true ||
                    assembly.FullName?.Contains("Jellyfin.Plugin.JSInjector", StringComparison.OrdinalIgnoreCase) == true ||
                    assembly.FullName?.Contains("JSInjector", StringComparison.OrdinalIgnoreCase) == true);

            if (javaScriptInjectorAssembly is null)
            {
                logger?.LogInformation("[IMDb Heatmap] JavaScript Injector plugin assembly was not found in AppDomain.");
                return false;
            }

            logger?.LogInformation("[IMDb Heatmap] Located JavaScript Injector assembly: {Assembly}", javaScriptInjectorAssembly.FullName);

            Type? pluginInterfaceType = javaScriptInjectorAssembly.GetType(JavaScriptInjectorInterfaceTypeName)
                ?? javaScriptInjectorAssembly.GetType("Jellyfin.Plugin.JSInjector.PluginInterface")
                ?? javaScriptInjectorAssembly.GetType("Jellyfin.Plugin.JavaScriptInjector.Services.JavaScriptRegistrationService")
                ?? javaScriptInjectorAssembly.GetType("Jellyfin.Plugin.JSInjector.Services.ScriptInjector");

            if (pluginInterfaceType is null)
            {
                logger?.LogWarning("[IMDb Heatmap] JavaScript Injector plugin interface type was not found.");
                return false;
            }

            MethodInfo? registerScriptMethod = pluginInterfaceType.GetMethod("RegisterScript")
                ?? pluginInterfaceType.GetMethod("AddScript");

            if (registerScriptMethod is null)
            {
                logger?.LogWarning("[IMDb Heatmap] RegisterScript method was not found on type {TypeName}.", pluginInterfaceType.FullName);
                return false;
            }

            JObject payload = new JObject
            {
                { "id", ScriptId },
                { "name", "IMDb Heatmap & Chart loader" },
                { "script", BuildLoaderScript() },
                { "enabled", enabled },
                { "requiresAuthentication", false },
                { "pluginId", plugin.Id.ToString() },
                { "pluginName", plugin.Name },
                { "pluginVersion", typeof(JsInjectorIntegration).Assembly.GetName().Version?.ToString() ?? "1.0.0.0" }
            };

            object? registerResult = registerScriptMethod.Invoke(null, [payload]);
            if (registerResult is not true)
            {
                logger?.LogWarning("[IMDb Heatmap] JavaScript Injector rejected the loader script registration. Result: {Result}", registerResult);
                return false;
            }

            logger?.LogInformation(
                "[IMDb Heatmap] Successfully {LoaderState} its JavaScript Injector loader script.",
                enabled ? "enabled" : "disabled");
            return true;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "[IMDb Heatmap] Failed to register with the JavaScript Injector plugin.");
            return false;
        }
    }

    private static string BuildLoaderScript()
    {
        return """
            (() => {
                'use strict';

                if (document.getElementById('jf-imdb-heatmap-js')
                    || document.querySelector('script[data-plugin="ImdbHeatmap"]')) {
                    return;
                }

                const css = document.createElement('link');
                css.id = 'jf-imdb-heatmap-css';
                css.rel = 'stylesheet';
                css.href = '../ImdbHeatmap/style.css';
                (document.head || document.documentElement).appendChild(css);

                const script = document.createElement('script');
                script.async = false;
                script.id = 'jf-imdb-heatmap-js';
                script.dataset.plugin = 'ImdbHeatmap';
                script.src = '../ImdbHeatmap/script.js';
                (document.head || document.documentElement).appendChild(script);
            })();
            """;
    }
}
