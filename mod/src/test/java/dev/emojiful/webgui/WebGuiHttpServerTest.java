package dev.emojiful.webgui;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.emojiful.webgui.http.WebGuiHttpServer;
import dev.emojiful.webgui.pack.PackService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import static org.junit.jupiter.api.Assertions.*;

class WebGuiHttpServerTest {
    @TempDir
    Path gameDirectory;

    private WebGuiHttpServer server;

    @BeforeEach
    void startServer() throws Exception {
        server = new WebGuiHttpServer(new PackService(gameDirectory), getClass().getClassLoader(), ignored -> { });
        server.start(0);
    }

    @AfterEach
    void stopServer() {
        server.close();
    }

    @Test
    void servesSameOriginSessionAndStaticAssetsWithTypes() throws Exception {
        Response session = request("GET", "/__emojiful__/session.json", Map.of("Origin", origin()), "");
        assertEquals(200, session.status());
        JsonObject sessionJson = JsonParser.parseString(session.body()).getAsJsonObject();
        assertEquals("mod", sessionJson.get("mode").getAsString());
        assertEquals("1.20.1", sessionJson.get("gameVersion").getAsString());
        assertEquals("Forge", sessionJson.get("loader").getAsString());
        assertEquals(server.getPort(), sessionJson.get("port").getAsInt());
        assertFalse(sessionJson.get("token").getAsString().isBlank());
        assertEquals("no-store", session.header("cache-control"));

        Response html = request("GET", "/", Map.of(), "");
        assertEquals(200, html.status());
        assertTrue(html.header("content-type").startsWith("text/html; charset=utf-8"));
        assertTrue(html.body().contains("test gui"));
        Response script = request("GET", "/app.js", Map.of(), "");
        assertEquals(200, script.status());
        assertTrue(script.header("content-type").startsWith("text/javascript; charset=utf-8"));
        assertEquals(404, request("GET", "/missing.js", Map.of(), "").status());
        assertEquals(404, request("GET", "/../secret", Map.of(), "").status());
    }

    @Test
    void servesDistinctLocalizedHtmlRoutesWithoutCachingTheirDocuments() throws Exception {
        Response japanese = request("GET", "/ja/", Map.of(), "");
        Response english = request("GET", "/en/", Map.of(), "");
        Response hongKongChinese = request("GET", "/zh-hk/", Map.of(), "");

        assertEquals(200, japanese.status());
        assertEquals(200, english.status());
        assertEquals(200, hongKongChinese.status());
        assertTrue(japanese.body().contains("fixture-locale-ja"));
        assertTrue(english.body().contains("fixture-locale-en"));
        assertTrue(hongKongChinese.body().contains("fixture-locale-zh-hk"));
        assertFalse(japanese.body().equals(english.body()));
        assertEquals("no-cache", japanese.header("cache-control"));
        assertEquals("no-cache", english.header("cache-control"));
        assertEquals("no-cache", hongKongChinese.header("cache-control"));
    }

    @Test
    void servesSelfHostedLegacyEngineAndLicenseAssetsWithoutAlteringCompressedBytes() throws Exception {
        Response manifestResponse = request("GET", "/legacy-engine/generated/manifest.json", Map.of(), "");
        assertEquals(200, manifestResponse.status());
        assertTrue(manifestResponse.header("content-type").startsWith("application/json"));
        JsonObject manifest = JsonParser.parseString(manifestResponse.body()).getAsJsonObject();
        assertEquals("ffmpeg-core.js", manifest.get("core").getAsString());
        assertEquals("ffmpeg-core.wasm.gz", manifest.get("wasm").getAsString());
        assertTrue(manifest.get("sha256").getAsString().matches("[a-f0-9]{64}"));

        Response script = request("GET", "/legacy-engine/generated/ffmpeg-core.js", Map.of(), "");
        assertEquals(200, script.status());
        assertTrue(script.header("content-type").startsWith("text/javascript"));
        assertTrue(script.body().contains("export default createFFmpegCore"));
        String policy = script.header("content-security-policy");
        assertNotNull(policy);
        assertTrue(directive(policy, "script-src").contains("'wasm-unsafe-eval'"));
        assertFalse(directive(policy, "script-src").contains("'unsafe-eval'"));
        assertEquals("worker-src 'self'", directive(policy, "worker-src"));
        assertTrue(directive(policy, "img-src").contains("blob:"));

        Response compressed = request("GET", "/legacy-engine/generated/ffmpeg-core.wasm.gz",
                Map.of("Accept-Encoding", "identity"), "");
        assertEquals(200, compressed.status());
        assertEquals("application/octet-stream", compressed.header("content-type"));
        assertNull(compressed.header("content-encoding"));
        assertEquals(manifest.get("compressedBytes").getAsInt(), compressed.bodyBytes().length);
        assertTrue(compressed.bodyBytes().length <= 25 * 1024 * 1024);
        try (InputStream original = getClass().getClassLoader()
                .getResourceAsStream("web/legacy-engine/generated/ffmpeg-core.wasm.gz")) {
            assertNotNull(original);
            assertArrayEquals(original.readAllBytes(), compressed.bodyBytes());
        }

        Response sources = request("GET", "/legacy-engine/SOURCES.md", Map.of(), "");
        assertEquals(200, sources.status());
        assertTrue(sources.body().contains("https://github.com/ffmpegwasm/ffmpeg.wasm/"));
        assertTrue(sources.body().contains(manifest.get("version").getAsString()));
        for (String license : new String[]{"COPYING.GPL-2.0.txt", "COPYING.GPL-3.0.txt"}) {
            Response response = request("GET", "/legacy-engine/" + license, Map.of(), "");
            assertEquals(200, response.status(), license);
            assertTrue(response.body().contains("GNU GENERAL PUBLIC LICENSE"), license);
        }
    }

    @Test
    void rejectsRebindingAndCrossSiteRequestsOnApiAndAssets() throws Exception {
        assertEquals(403, request("GET", "/", Map.of("Host", "attacker.test:" + server.getPort()), "").status());
        assertEquals(403, request("GET", "/__emojiful__/session.json",
                Map.of("Origin", "http://attacker.test:" + server.getPort()), "").status());
        assertEquals(403, request("GET", "/__emojiful__/session.json",
                Map.of("Host", "127.0.0.1:" + server.getPort(), "Origin", "http://localhost:" + server.getPort()), "").status());
        assertEquals(403, request("GET", "/__emojiful__/session.json",
                Map.of("Referer", "http://attacker.test/page"), "").status());
        assertEquals(403, request("GET", "/app.js", Map.of("Sec-Fetch-Site", "cross-site"), "").status());

        Response session = request("GET", "/__emojiful__/session.json",
                Map.of("Host", "localhost:" + server.getPort(), "Origin", "http://localhost:" + server.getPort()), "");
        assertEquals(200, session.status());
        assertEquals(401, request("GET", "/api/packs", Map.of(), "").status());
        assertEquals(401, request("GET", "/api/packs", Map.of("X-EWG-Token", "wrong"), "").status());
        assertEquals(403, request("GET", "/api/packs", Map.of("Sec-Fetch-Site", "cross-site"), "").status());

        String token = JsonParser.parseString(session.body()).getAsJsonObject().get("token").getAsString();
        Response list = apiRequest("GET", "/api/packs", token, "");
        assertEquals(200, list.status());
        assertEquals(0, JsonParser.parseString(list.body()).getAsJsonObject().getAsJsonArray("packs").size());
    }

    @Test
    void savesManagedArchiveListsItAndRequiresExplicitManagedOverwrite() throws Exception {
        String token = sessionToken();
        String pack = packJson("cats", "Cats", "comfy", "https://cdn.example.test/comfy.png");
        Response created = apiRequest("POST", "/api/packs", token, "{\"pack\":" + pack + ",\"overwrite\":false}");
        assertEquals(200, created.status(), created.body());
        assertEquals("cats.zip", JsonParser.parseString(created.body()).getAsJsonObject().get("filename").getAsString());

        Path archive = gameDirectory.resolve("config/emojiful-web-gui/packs/cats.zip");
        assertTrue(java.nio.file.Files.isRegularFile(archive));
        try (ZipFile zip = new ZipFile(archive.toFile())) {
            assertNotNull(zip.getEntry("pack.mcmeta"));
            JsonObject recipe = readJson(zip, "data/cats/recipes/comfy.json");
            assertEquals("emojiful:emoji_recipe", recipe.get("type").getAsString());
            assertEquals("comfy", recipe.get("name").getAsString());
            assertEquals("Discord", recipe.get("category").getAsString());
            assertEquals("https://cdn.example.test/comfy.png", recipe.get("url").getAsString());
            assertEquals("cats", readJson(zip, "emojiful-web-gui.json").get("id").getAsString());
        }

        Response conflict = apiRequest("POST", "/api/packs", token,
                "{\"pack\":" + packJson("cats", "Cats Updated", "happy", "https://cdn.example.test/happy.png") + ",\"overwrite\":false}");
        assertEquals(409, conflict.status());
        Response updated = apiRequest("POST", "/api/packs", token,
                "{\"pack\":" + packJson("cats", "Cats Updated", "happy", "https://cdn.example.test/happy.png") + ",\"overwrite\":true}");
        assertEquals(200, updated.status());
        assertEquals("Cats Updated", JsonParser.parseString(apiRequest("GET", "/api/packs/cats", token, "").body())
                .getAsJsonObject().get("name").getAsString());
        JsonObject listing = JsonParser.parseString(apiRequest("GET", "/api/packs", token, "").body()).getAsJsonObject();
        assertEquals("cats.zip", listing.getAsJsonArray("packs").get(0).getAsJsonObject().get("filename").getAsString());
        assertEquals(404, apiRequest("GET", "/api/packs/missing", token, "").status());
    }

    @Test
    void rejectsInvalidPacksOversizedBodiesAndUnknownApiRoutes() throws Exception {
        String token = sessionToken();
        String traversal = "{\"schemaVersion\":1,\"id\":\"../outside\",\"name\":\"x\",\"description\":\"\",\"emojis\":[{\"name\":\"x\",\"url\":\"https://example.test/x.png\",\"category\":\"a\"}]}";
        assertEquals(400, apiRequest("POST", "/api/packs", token, "{\"pack\":" + traversal + ",\"overwrite\":false}").status());

        String credentials = packJson("safe", "Safe", "x", "https://user:secret@example.test/x.png");
        assertEquals(400, apiRequest("POST", "/api/packs", token, "{\"pack\":" + credentials + ",\"overwrite\":false}").status());
        String controls = packJson("safe", "Bad\\nName", "x", "https://example.test/x.png");
        assertEquals(400, apiRequest("POST", "/api/packs", token, "{\"pack\":" + controls + ",\"overwrite\":false}").status());
        String duplicateNames = "{\"schemaVersion\":1,\"id\":\"safe\",\"name\":\"Safe\",\"description\":\"\",\"emojis\":["
                + "{\"name\":\"same\",\"url\":\"https://example.test/one.png\",\"category\":\"A\"},"
                + "{\"name\":\"same\",\"url\":\"https://example.test/two.png\",\"category\":\"A\"}]}";
        assertEquals(400, apiRequest("POST", "/api/packs", token,
                "{\"pack\":" + duplicateNames + ",\"overwrite\":false}").status());
        String prefix = "https://example.test/";
        String longUrl = prefix + "a".repeat(2048 - prefix.length());
        StringBuilder oversizedPack = new StringBuilder("{\"schemaVersion\":1,\"id\":\"large\",\"name\":\"Large\",\"description\":\"\",\"emojis\":[");
        for (int i = 0; i < 780; i++) {
            if (i > 0) oversizedPack.append(',');
            oversizedPack.append("{\"name\":\"emoji_").append(i).append("\",\"url\":\"")
                    .append(longUrl).append("\",\"category\":\"A\"}");
        }
        oversizedPack.append("]}");
        assertTrue(oversizedPack.toString().getBytes(StandardCharsets.UTF_8).length < 2 * 1024 * 1024);
        assertEquals(400, apiRequest("POST", "/api/packs", token,
                "{\"pack\":" + oversizedPack + ",\"overwrite\":false}").status());
        assertEquals(404, apiRequest("GET", "/api/nope", token, "").status());

        Map<String, String> headers = authHeaders(token);
        headers.put("Content-Length", Integer.toString(2 * 1024 * 1024 + 1));
        assertEquals(413, request("POST", "/api/packs", headers, "").status());
    }

    @Test
    void doesNotReplaceUnmanagedZipEvenWhenOverwriteWasRequested() throws Exception {
        String token = sessionToken();
        Path directory = gameDirectory.resolve("config/emojiful-web-gui/packs");
        java.nio.file.Files.createDirectories(directory);
        Path unmanaged = directory.resolve("external.zip");
        java.nio.file.Files.writeString(unmanaged, "keep this file", StandardCharsets.UTF_8);
        String pack = packJson("external", "External", "x", "https://example.test/x.png");
        Response response = apiRequest("POST", "/api/packs", token, "{\"pack\":" + pack + ",\"overwrite\":true}");
        assertEquals(409, response.status());
        assertEquals("keep this file", java.nio.file.Files.readString(unmanaged));
    }

    @Test
    void concurrentNoOverwriteInstallsNeverReplaceOneAnother() throws Exception {
        String token = sessionToken();
        String firstBody = "{\"pack\":" + packJson("racing", "First", "first", "https://example.test/first.png") + ",\"overwrite\":false}";
        String secondBody = "{\"pack\":" + packJson("racing", "Second", "second", "https://example.test/second.png") + ",\"overwrite\":false}";
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Response> first = executor.submit(() -> {
                ready.countDown();
                start.await();
                return apiRequest("POST", "/api/packs", token, firstBody);
            });
            Future<Response> second = executor.submit(() -> {
                ready.countDown();
                start.await();
                return apiRequest("POST", "/api/packs", token, secondBody);
            });
            ready.await();
            start.countDown();
            int firstStatus = first.get().status();
            int secondStatus = second.get().status();
            assertEquals(1, (firstStatus == 200 ? 1 : 0) + (secondStatus == 200 ? 1 : 0));
            assertEquals(1, (firstStatus == 409 ? 1 : 0) + (secondStatus == 409 ? 1 : 0));
        } finally {
            executor.shutdownNow();
        }
        String installedName = JsonParser.parseString(apiRequest("GET", "/api/packs/racing", token, "").body())
                .getAsJsonObject().get("name").getAsString();
        assertTrue(installedName.equals("First") || installedName.equals("Second"));
    }

    @Test
    void neverBindsToTheLocalSendPort() {
        assertNotEquals(53317, server.getPort());
        WebGuiHttpServer conflicting = new WebGuiHttpServer(new PackService(gameDirectory), getClass().getClassLoader(), ignored -> { });
        assertThrows(IllegalArgumentException.class, () -> conflicting.start(53317));
    }

    private String sessionToken() throws Exception {
        Response response = request("GET", "/__emojiful__/session.json", Map.of(), "");
        return JsonParser.parseString(response.body()).getAsJsonObject().get("token").getAsString();
    }

    private Response apiRequest(String method, String path, String token, String body) throws Exception {
        Map<String, String> headers = authHeaders(token);
        headers.put("Origin", origin());
        headers.put("Sec-Fetch-Site", "same-origin");
        return request(method, path, headers, body);
    }

    private Map<String, String> authHeaders(String token) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("X-EWG-Token", token);
        return headers;
    }

    private String origin() {
        return "http://127.0.0.1:" + server.getPort();
    }

    private Response request(String method, String path, Map<String, String> headers, String body) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", server.getPort())) {
            socket.setSoTimeout(3000);
            OutputStream output = socket.getOutputStream();
            StringBuilder request = new StringBuilder(method).append(' ').append(path).append(" HTTP/1.1\r\n");
            if (!headers.containsKey("Host")) {
                request.append("Host: 127.0.0.1:").append(server.getPort()).append("\r\n");
            }
            request.append("Connection: close\r\n");
            headers.forEach((name, value) -> request.append(name).append(": ").append(value).append("\r\n"));
            byte[] bodyBytes = body.getBytes(StandardCharsets.UTF_8);
            if (!body.isEmpty() && !headers.containsKey("Content-Length")) {
                request.append("Content-Length: ").append(bodyBytes.length).append("\r\n");
                request.append("Content-Type: application/json\r\n");
            }
            request.append("\r\n");
            output.write(request.toString().getBytes(StandardCharsets.ISO_8859_1));
            output.write(bodyBytes);
            output.flush();
            socket.shutdownOutput();
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            try (InputStream input = socket.getInputStream()) {
                input.transferTo(response);
            }
            byte[] responseBytes = response.toByteArray();
            String raw = new String(responseBytes, StandardCharsets.ISO_8859_1);
            int split = raw.indexOf("\r\n\r\n");
            String[] lines = raw.substring(0, split).split("\r\n");
            int status = Integer.parseInt(lines[0].split(" ")[1]);
            Map<String, String> responseHeaders = new LinkedHashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon > 0) responseHeaders.put(lines[i].substring(0, colon).toLowerCase(), lines[i].substring(colon + 1).trim());
            }
            byte[] responseBody = Arrays.copyOfRange(responseBytes, split + 4, responseBytes.length);
            return new Response(status, responseHeaders, new String(responseBody, StandardCharsets.UTF_8), responseBody);
        }
    }

    private static String directive(String policy, String name) {
        for (String value : policy.split(";")) {
            String trimmed = value.trim();
            if (trimmed.startsWith(name + " ")) return trimmed;
        }
        return "";
    }

    private static JsonObject readJson(ZipFile zip, String entryName) throws Exception {
        ZipEntry entry = zip.getEntry(entryName);
        assertNotNull(entry, entryName);
        try (InputStream input = zip.getInputStream(entry)) {
            return JsonParser.parseString(new String(input.readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject();
        }
    }

    private static String packJson(String id, String displayName, String emojiName, String url) {
        return "{\"schemaVersion\":1,\"id\":\"" + id + "\",\"name\":\"" + displayName
                + "\",\"description\":\"\",\"emojis\":[{\"name\":\"" + emojiName + "\",\"url\":\"" + url
                + "\",\"category\":\"Discord\"}]}";
    }

    private record Response(int status, Map<String, String> headers, String body, byte[] bodyBytes) {
        String header(String name) {
            return headers.get(name);
        }
    }
}
