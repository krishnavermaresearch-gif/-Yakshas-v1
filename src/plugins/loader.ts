import { logInfo, logWarn } from "../logger.js";
import type { PhonePlugin } from "./plugin-types.js";

// ─── Built-in plugins (imported statically for reliability) ──────────────────
import { whatsappPlugin } from "./whatsapp/index.js";
import { instagramPlugin } from "./instagram/index.js";
import { gmailPlugin } from "./gmail/index.js";

/** All built-in plugins. */
const BUILTIN_PLUGINS: PhonePlugin[] = [
    whatsappPlugin,
    instagramPlugin,
    gmailPlugin,
];

/**
 * Load all available plugins.
 * Currently uses static imports; can be extended to load from a plugins directory.
 */
export async function loadPlugins(): Promise<PhonePlugin[]> {
    const loaded: PhonePlugin[] = [];

    for (const plugin of BUILTIN_PLUGINS) {
        try {
            loaded.push(plugin);
            logInfo(`Plugin loaded: ${plugin.name} (${plugin.appPackage}) — ${plugin.tools.length} tools`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logWarn(`Failed to load plugin ${plugin.name}: ${msg}`);
        }
    }

    return loaded;
}

export { type PhonePlugin } from "./plugin-types.js";
