package dev.emojiful.webgui.http;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.emojiful.webgui.pack.EmojiPack;
import dev.emojiful.webgui.pack.PackConflictException;
import dev.emojiful.webgui.pack.PackJson;
import dev.emojiful.webgui.pack.PackNotFoundException;
import dev.emojiful.webgui.pack.PackService;
import dev.emojiful.webgui.pack.PackSummary;
import dev.emojiful.webgui.pack.PackValidationException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.regex.Pattern;

public final class WebGuiHttpServer implements AutoCloseable {
    public static final int DEFAULT_PORT = 8765;
    private static final int MAX_REQUEST_BYTES = 2 * 1024 * 1024;
    private static final Pattern PACK_PATH = Pattern.compile("^/api/packs/([a-z0-9_]{1,64})$");
    private final PackService packService;
    private final String token;
    private final ClassLoader resources;
    private final Consumer<String> logger;
    private HttpServer server;
    private ExecutorService executor;
    private int port;

    public WebGuiHttpServer(PackService packService, ClassLoader resources, Consumer<String> logger) {
        this.packService = packService;
        this.resources = resources;
        this.logger = logger;
        byte[] tokenBytes = new byte[32];
        new SecureRandom().nextBytes(tokenBytes);
        this.token = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);
    }

    public synchronized void start(int requestedPort) throws IOException {
        if (server != null) {
            return;
        }
        if (requestedPort < 0 || requestedPort > 65535 || requestedPort == 53317) {
            throw new IllegalArgumentException("Port must be between 0 and 65535, except the reserved LocalSend port 53317.");
        }
        HttpServer created = null;
        for (int attempt = 0; attempt < 5; attempt++) {
            HttpServer candidate = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), requestedPort), 0);
            if (candidate.getAddress().getPort() != 53317) {
                created = candidate;
                break;
            }
            candidate.stop(0);
            if (requestedPort != 0) {
                break;
            }
        }
        if (created == null) {
            throw new IOException("Unable to select a loopback port without conflicting with LocalSend (53317).");
        }
        AtomicInteger threadNumber = new AtomicInteger();
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(runnable, "emojiful-web-gui-http-" + threadNumber.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
        ExecutorService createdExecutor = Executors.newFixedThreadPool(4, factory);
        created.createContext("/", this::handleSafely);
        created.setExecutor(createdExecutor);
        try {
            created.start();
            server = created;
            executor = createdExecutor;
            port = created.getAddress().getPort();
        } catch (RuntimeException e) {
            created.stop(0);
            createdExecutor.shutdownNow();
            throw e;
        }
    }

    public synchronized int getPort() {
        if (server == null) {
            throw new IllegalStateException("Server has not started.");
        }
        return port;
    }

    public String getUrl() {
        return "http://127.0.0.1:" + getPort() + "/";
    }

    private void handleSafely(HttpExchange exchange) {
        try {
            handle(exchange);
        } catch (IOException e) {
            logger.accept("Web GUI request failed: " + e.getMessage());
            try {
                sendJson(exchange, 500, error("Internal server error."));
            } catch (IOException ignored) {
                exchange.close();
            }
        } catch (RuntimeException e) {
            logger.accept("Web GUI request failed: " + e.getMessage());
            try {
                sendJson(exchange, 500, error("Internal server error."));
            } catch (IOException ignored) {
                exchange.close();
            }
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        if (!isAllowedRequest(exchange)) {
            sendJson(exchange, 403, error("Request origin is not allowed."));
            return;
        }

        if ("/__emojiful__/session.json".equals(path)) {
            if (!"GET".equals(exchange.getRequestMethod())) {
                methodNotAllowed(exchange, "GET");
                return;
            }
            JsonObject session = new JsonObject();
            session.addProperty("mode", "mod");
            session.addProperty("token", token);
            session.addProperty("gameVersion", "1.20.1");
            session.addProperty("loader", "Forge");
            session.addProperty("port", port);
            sendJson(exchange, 200, session, "no-store");
            return;
        }

        if (path.equals("/api/packs") || path.startsWith("/api/")) {
            if (!hasToken(exchange)) {
                sendJson(exchange, 401, error("A valid session token is required."));
                return;
            }
            handleApi(exchange, path);
            return;
        }
        serveAsset(exchange, path);
    }

    private void handleApi(HttpExchange exchange, String path) throws IOException {
        if (path.equals("/api/packs")) {
            if ("GET".equals(exchange.getRequestMethod())) {
                try {
                    JsonArray packs = new JsonArray();
                    for (PackSummary summary : packService.list()) {
                        JsonObject item = new JsonObject();
                        item.addProperty("id", summary.id());
                        item.addProperty("name", summary.name());
                        item.addProperty("emojiCount", summary.emojiCount());
                        item.addProperty("filename", summary.filename());
                        packs.add(item);
                    }
                    JsonObject response = new JsonObject();
                    response.add("packs", packs);
                    sendJson(exchange, 200, response);
                } catch (IOException e) {
                    sendJson(exchange, 500, error("Unable to read managed packs."));
                }
                return;
            }
            if ("POST".equals(exchange.getRequestMethod())) {
                handleSave(exchange);
                return;
            }
            methodNotAllowed(exchange, "GET, POST");
            return;
        }

        var match = PACK_PATH.matcher(path);
        if (match.matches()) {
            if (!"GET".equals(exchange.getRequestMethod())) {
                methodNotAllowed(exchange, "GET");
                return;
            }
            try {
                sendJson(exchange, 200, PackJson.toJson(packService.load(match.group(1))));
            } catch (PackNotFoundException e) {
                sendJson(exchange, 404, error(e.getMessage()));
            } catch (IOException e) {
                sendJson(exchange, 500, error("Unable to read the managed pack."));
            }
            return;
        }
        sendJson(exchange, 404, error("Not found."));
    }

    private void handleSave(HttpExchange exchange) throws IOException {
        String contentEncoding = singleHeader(exchange.getRequestHeaders(), "Content-Encoding");
        if (contentEncoding != null && !"identity".equalsIgnoreCase(contentEncoding)) {
            sendJson(exchange, 415, error("Compressed request bodies are not supported."));
            return;
        }
        String contentLength = singleHeader(exchange.getRequestHeaders(), "Content-Length");
        if (contentLength != null) {
            try {
                if (Long.parseLong(contentLength) > MAX_REQUEST_BYTES) {
                    sendJson(exchange, 413, error("Request body exceeds 2 MiB."));
                    return;
                }
            } catch (NumberFormatException e) {
                sendJson(exchange, 400, error("Content-Length is invalid."));
                return;
            }
        }
        byte[] body;
        try (InputStream input = exchange.getRequestBody(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > MAX_REQUEST_BYTES) {
                    sendJson(exchange, 413, error("Request body exceeds 2 MiB."));
                    return;
                }
                output.write(buffer, 0, count);
            }
            body = output.toByteArray();
        }
        try {
            JsonObject request = PackJson.parseJsonObject(new String(body, StandardCharsets.UTF_8));
            if (!request.keySet().equals(java.util.Set.of("pack", "overwrite")) || !request.get("pack").isJsonObject()
                    || !request.get("overwrite").isJsonPrimitive() || !request.getAsJsonPrimitive("overwrite").isBoolean()) {
                sendJson(exchange, 400, error("Body must contain exactly pack and boolean overwrite fields."));
                return;
            }
            EmojiPack pack = PackJson.parseAndValidate(request.getAsJsonObject("pack").toString());
            boolean overwrite = request.get("overwrite").getAsBoolean();
            String filename = packService.save(pack, overwrite);
            JsonObject response = new JsonObject();
            response.addProperty("filename", filename);
            response.addProperty("message", "Pack saved successfully.");
            sendJson(exchange, 200, response);
        } catch (PackValidationException e) {
            sendJson(exchange, 400, error(e.getMessage()));
        } catch (PackConflictException e) {
            sendJson(exchange, 409, error(e.getMessage()));
        } catch (IOException e) {
            sendJson(exchange, 500, error("Unable to save the pack."));
        } catch (RuntimeException e) {
            sendJson(exchange, 400, error("Request body must be a valid pack JSON object."));
        }
    }

    private boolean isAllowedRequest(HttpExchange exchange) {
        Headers headers = exchange.getRequestHeaders();
        if (hasMultipleValues(headers, "Host") || hasMultipleValues(headers, "Origin")
                || hasMultipleValues(headers, "Referer") || hasMultipleValues(headers, "Sec-Fetch-Site")) {
            return false;
        }
        String host = singleHeader(headers, "Host");
        if (host == null || !(host.equals("127.0.0.1:" + port) || host.equals("localhost:" + port))) {
            return false;
        }
        String fetchSite = singleHeader(headers, "Sec-Fetch-Site");
        if (fetchSite != null && "cross-site".equalsIgnoreCase(fetchSite)) {
            return false;
        }
        String origin = singleHeader(headers, "Origin");
        if (origin != null && !allowedOrigin(origin, host)) {
            return false;
        }
        String referer = singleHeader(headers, "Referer");
        return referer == null || allowedReferer(referer, host);
    }

    private boolean allowedOrigin(String value, String host) {
        try {
            URI uri = new URI(value);
            return "http".equalsIgnoreCase(uri.getScheme()) && uri.getRawUserInfo() == null
                    && uri.getRawQuery() == null && uri.getRawFragment() == null
                    && (uri.getRawPath() == null || uri.getRawPath().isEmpty())
                    && allowedAuthority(uri.getRawAuthority()) && uri.getRawAuthority().equals(host);
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private boolean allowedReferer(String value, String host) {
        try {
            URI uri = new URI(value);
            return "http".equalsIgnoreCase(uri.getScheme()) && uri.getRawUserInfo() == null
                    && allowedAuthority(uri.getRawAuthority()) && uri.getRawAuthority().equals(host);
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private boolean allowedAuthority(String authority) {
        return authority != null && (authority.equals("127.0.0.1:" + port) || authority.equals("localhost:" + port));
    }

    private boolean hasToken(HttpExchange exchange) {
        if (hasMultipleValues(exchange.getRequestHeaders(), "X-EWG-Token")) {
            return false;
        }
        String supplied = singleHeader(exchange.getRequestHeaders(), "X-EWG-Token");
        return supplied != null && MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8));
    }

    private static String singleHeader(Headers headers, String name) {
        List<String> values = headers.get(name);
        return values == null || values.size() != 1 ? null : values.get(0);
    }

    private static boolean hasMultipleValues(Headers headers, String name) {
        List<String> values = headers.get(name);
        return values != null && values.size() != 1;
    }

    private void serveAsset(HttpExchange exchange, String requestPath) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod())) {
            methodNotAllowed(exchange, "GET");
            return;
        }
        String resourcePath = assetPath(requestPath);
        if (resourcePath == null) {
            sendJson(exchange, 404, error("Not found."));
            return;
        }
        try (InputStream input = resources.getResourceAsStream("web/" + resourcePath)) {
            if (input == null) {
                sendJson(exchange, 404, error("Not found."));
                return;
            }
            byte[] bytes = input.readAllBytes();
            exchange.getResponseHeaders().set("Content-Type", contentType(resourcePath));
            addSecurityHeaders(exchange.getResponseHeaders());
            boolean htmlDocument = resourcePath.equals("index.html") || resourcePath.endsWith("/index.html");
            exchange.getResponseHeaders().set("Cache-Control", htmlDocument ? "no-cache" : "public, max-age=3600");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }

    private static String assetPath(String path) {
        if (path == null || !path.startsWith("/") || path.indexOf('\\') >= 0) {
            return null;
        }
        for (int i = 0; i < path.length(); i++) {
            if (Character.isISOControl(path.charAt(i))) {
                return null;
            }
        }
        String relative = path.substring(1);
        if (relative.isEmpty()) {
            return "index.html";
        }
        String[] segments = relative.split("/", -1);
        for (String segment : segments) {
            if (segment.equals(".") || segment.equals("..")) {
                return null;
            }
        }
        if (path.endsWith("/")) {
            relative += "index.html";
        }
        return relative;
    }

    private static String contentType(String path) {
        String lower = path.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private static JsonObject error(String message) {
        JsonObject result = new JsonObject();
        result.addProperty("error", message);
        return result;
    }

    private static void methodNotAllowed(HttpExchange exchange, String allowed) throws IOException {
        exchange.getResponseHeaders().set("Allow", allowed);
        sendJson(exchange, 405, error("Method not allowed."));
    }

    private static void sendJson(HttpExchange exchange, int status, JsonObject json) throws IOException {
        sendJson(exchange, status, json, "no-store");
    }

    private static void sendJson(HttpExchange exchange, int status, JsonObject json, String cacheControl) throws IOException {
        byte[] body = json.toString().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", cacheControl);
        addSecurityHeaders(exchange.getResponseHeaders());
        try {
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
        } finally {
            exchange.close();
        }
    }

    private static void addSecurityHeaders(Headers headers) {
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("X-Frame-Options", "DENY");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Cross-Origin-Resource-Policy", "same-origin");
        headers.set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: http: https:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    }

    @Override
    public synchronized void close() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }
}
