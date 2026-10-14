package dev.emojiful.webgui.i18n;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LocaleRoutesTest {
    @Test
    void mapsEveryManifestLanguageVariantAndFallsBackToEnglish() throws Exception {
        LocaleRoutes routes = LocaleRoutes.load(getClass().getClassLoader());
        InputStream manifestResource = getClass().getClassLoader().getResourceAsStream(LocaleRoutes.MANIFEST_RESOURCE);
        assertNotNull(manifestResource, "generated runtime locale manifest should be on the classpath");
        int variantCount = 0;
        try (InputStream input = manifestResource;
             InputStreamReader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
            JsonArray manifest = JsonParser.parseReader(reader).getAsJsonArray();
            assertEquals(22, manifest.size(), "the runtime routes should include the first and second language scopes");
            for (var item : manifest) {
                JsonObject locale = item.getAsJsonObject();
                String route = locale.get("code").getAsString();
                for (var minecraftLanguage : locale.getAsJsonArray("minecraft")) {
                    assertEquals(route, routes.routeForMinecraftLanguage(minecraftLanguage.getAsString()));
                    variantCount++;
                }
            }
        }
        assertTrue(variantCount >= 22);
        assertEquals("en", routes.routeForMinecraftLanguage("unknown_language"));
        assertEquals("en", routes.routeForMinecraftLanguage(null));
        assertEquals("zh-hk", routes.routeForMinecraftLanguage("ZH-HK"));
    }

    @Test
    void appendsLocalePathWithoutLosingTheLocalhostPort() throws Exception {
        LocaleRoutes routes = LocaleRoutes.load(getClass().getClassLoader());

        URI localized = URI.create(routes.localizedUrl("http://127.0.0.1:8765/", "zh_hk"));
        assertEquals("http", localized.getScheme());
        assertEquals("127.0.0.1", localized.getHost());
        assertEquals(8765, localized.getPort());
        assertEquals("/zh-hk/", localized.getPath());
        assertEquals("http://127.0.0.1:8765/en/", routes.localizedUrl("http://127.0.0.1:8765", "unknown_language"));
    }
}
