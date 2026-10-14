package dev.emojiful.webgui.i18n;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Resolves Minecraft language IDs to the static site's supported locale routes. */
public final class LocaleRoutes {
    public static final String MANIFEST_RESOURCE = "i18n/locales.json";
    public static final String DEFAULT_LOCALE = "en";
    private static final Pattern LOCALE_CODE = Pattern.compile("[a-z]{2}(?:-[a-z]{2})?");
    private static final Pattern MINECRAFT_CODE = Pattern.compile("[a-z]{2,3}_[a-z]{2,3}");

    private final Map<String, String> routesByMinecraftLanguage;

    private LocaleRoutes(Map<String, String> routesByMinecraftLanguage) {
        this.routesByMinecraftLanguage = Map.copyOf(routesByMinecraftLanguage);
    }

    public static LocaleRoutes load(ClassLoader classLoader) throws IOException {
        if (classLoader == null) {
            throw new IllegalArgumentException("classLoader is required");
        }
        try (InputStream input = classLoader.getResourceAsStream(MANIFEST_RESOURCE)) {
            if (input == null) {
                throw new IOException("Missing runtime locale manifest: " + MANIFEST_RESOURCE);
            }
            JsonElement root;
            try (InputStreamReader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
                root = JsonParser.parseReader(reader);
            } catch (RuntimeException e) {
                throw new IOException("Invalid runtime locale manifest.", e);
            }
            if (!root.isJsonArray()) {
                throw new IOException("Runtime locale manifest must contain an array.");
            }
            Map<String, String> routes = new HashMap<>();
            boolean hasEnglish = false;
            JsonArray locales = root.getAsJsonArray();
            for (int index = 0; index < locales.size(); index++) {
                JsonElement element = locales.get(index);
                if (!element.isJsonObject()) {
                    throw new IOException("Locale manifest entry " + index + " must be an object.");
                }
                JsonObject locale = element.getAsJsonObject();
                String code = requiredString(locale, "code", index);
                String htmlLang = requiredString(locale, "htmlLang", index);
                String label = requiredString(locale, "label", index);
                if (!LOCALE_CODE.matcher(code).matches() || htmlLang.isBlank() || label.isBlank()) {
                    throw new IOException("Invalid locale manifest entry " + index + ".");
                }
                if (!locale.has("minecraft") || !locale.get("minecraft").isJsonArray()
                        || locale.getAsJsonArray("minecraft").isEmpty()) {
                    throw new IOException("Locale manifest entry " + index + " requires Minecraft language IDs.");
                }
                hasEnglish |= DEFAULT_LOCALE.equals(code);
                for (JsonElement minecraftLanguage : locale.getAsJsonArray("minecraft")) {
                    if (!minecraftLanguage.isJsonPrimitive() || !minecraftLanguage.getAsJsonPrimitive().isString()) {
                        throw new IOException("Minecraft language IDs must be strings.");
                    }
                    String language = minecraftLanguage.getAsString().toLowerCase(Locale.ROOT);
                    if (!MINECRAFT_CODE.matcher(language).matches() || routes.putIfAbsent(language, code) != null) {
                        throw new IOException("Invalid or duplicate Minecraft language ID: " + language);
                    }
                }
            }
            if (!hasEnglish) {
                throw new IOException("Runtime locale manifest must include the English fallback route.");
            }
            return new LocaleRoutes(routes);
        }
    }

    /** Minimal fallback used only if a broken mod jar omitted its generated locale manifest. */
    public static LocaleRoutes englishFallback() {
        return new LocaleRoutes(Map.of("en_us", DEFAULT_LOCALE));
    }

    public String routeForMinecraftLanguage(String selectedLanguage) {
        if (selectedLanguage == null) {
            return DEFAULT_LOCALE;
        }
        String normalized = selectedLanguage.strip().replace('-', '_').toLowerCase(Locale.ROOT);
        return routesByMinecraftLanguage.getOrDefault(normalized, DEFAULT_LOCALE);
    }

    public String localizedUrl(String baseUrl, String selectedLanguage) {
        if (baseUrl == null) {
            return null;
        }
        return baseUrl + (baseUrl.endsWith("/") ? "" : "/")
                + routeForMinecraftLanguage(selectedLanguage) + "/";
    }

    private static String requiredString(JsonObject object, String property, int index) throws IOException {
        if (!object.has(property) || !object.get(property).isJsonPrimitive()
                || !object.getAsJsonPrimitive(property).isString()) {
            throw new IOException("Locale manifest entry " + index + " requires a string " + property + ".");
        }
        return object.get(property).getAsString();
    }
}
