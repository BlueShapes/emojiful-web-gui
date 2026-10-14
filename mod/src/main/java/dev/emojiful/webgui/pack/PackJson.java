package dev.emojiful.webgui.pack;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.JsonSyntaxException;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;

import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public final class PackJson {
    public static final int MAX_NORMALIZED_PACK_BYTES = 1_572_864;
    private static final Set<String> PACK_FIELDS = Set.of("schemaVersion", "id", "name", "description", "emojis");
    private static final Set<String> EMOJI_FIELDS = Set.of("name", "url", "category");

    private PackJson() {
    }

    public static EmojiPack parseAndValidate(String json) throws PackValidationException {
        JsonObject root = parseJsonObject(json);
        requireExactFields(root, PACK_FIELDS, "Pack");
        int schemaVersion = integer(root, "schemaVersion");
        if (schemaVersion != 1) {
            throw new PackValidationException("schemaVersion must be 1.");
        }
        String id = string(root, "id").strip();
        String name = string(root, "name").strip();
        String description = string(root, "description").strip();
        if (!id.matches("[a-z0-9_]{1,64}")) {
            throw new PackValidationException("id must contain 1–64 lowercase letters, digits, or underscores.");
        }
        checkText(name, 100, "name", false);
        checkText(description, 1000, "description", true);

        if (!root.get("emojis").isJsonArray()) {
            throw new PackValidationException("emojis must be an array.");
        }
        JsonArray array = root.getAsJsonArray("emojis");
        if (array.size() < 1 || array.size() > 2000) {
            throw new PackValidationException("emojis must contain between 1 and 2000 entries.");
        }
        List<EmojiEntry> emojis = new ArrayList<>(array.size());
        Set<String> names = new java.util.HashSet<>();
        for (int i = 0; i < array.size(); i++) {
            if (!array.get(i).isJsonObject()) {
                throw new PackValidationException("emojis[" + i + "] must be an object.");
            }
            JsonObject emoji = array.get(i).getAsJsonObject();
            requireExactFields(emoji, EMOJI_FIELDS, "emojis[" + i + "]");
            String emojiName = string(emoji, "name").strip();
            String url = string(emoji, "url").strip();
            String category = string(emoji, "category").strip();
            if (!emojiName.matches("[a-z0-9_][a-z0-9_-]{0,63}")) {
                throw new PackValidationException("emojis[" + i + "].name has an invalid format.");
            }
            if (!names.add(emojiName)) {
                throw new PackValidationException("Emoji names must be unique.");
            }
            checkText(category, 80, "emojis[" + i + "].category", false);
            validateUrl(url, i);
            emojis.add(new EmojiEntry(emojiName, url, category));
        }
        EmojiPack pack = new EmojiPack(schemaVersion, id, name, description, emojis);
        if (toJson(pack).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_NORMALIZED_PACK_BYTES) {
            throw new PackValidationException("Pack JSON exceeds the 1.5 MiB normalized size limit.");
        }
        return pack;
    }

    public static JsonObject parseJsonObject(String json) throws PackValidationException {
        try (JsonReader reader = new JsonReader(new StringReader(json))) {
            reader.setLenient(false);
            JsonElement root = readStrictValue(reader, 0);
            if (reader.peek() != JsonToken.END_DOCUMENT || !root.isJsonObject()) {
                throw new JsonSyntaxException("Root must be a single JSON object.");
            }
            return root.getAsJsonObject();
        } catch (IOException | RuntimeException e) {
            throw new PackValidationException("Request body must be a strict JSON object.");
        }
    }

    private static JsonElement readStrictValue(JsonReader reader, int depth) throws IOException {
        if (depth > 64) {
            throw new JsonSyntaxException("JSON nesting is too deep.");
        }
        return switch (reader.peek()) {
            case BEGIN_OBJECT -> {
                JsonObject object = new JsonObject();
                reader.beginObject();
                while (reader.hasNext()) {
                    String name = reader.nextName();
                    if (object.has(name)) {
                        throw new JsonSyntaxException("Duplicate JSON field.");
                    }
                    object.add(name, readStrictValue(reader, depth + 1));
                }
                reader.endObject();
                yield object;
            }
            case BEGIN_ARRAY -> {
                JsonArray array = new JsonArray();
                reader.beginArray();
                while (reader.hasNext()) {
                    array.add(readStrictValue(reader, depth + 1));
                }
                reader.endArray();
                yield array;
            }
            case STRING -> new JsonPrimitive(reader.nextString());
            case NUMBER -> new JsonPrimitive(new BigDecimal(reader.nextString()));
            case BOOLEAN -> new JsonPrimitive(reader.nextBoolean());
            case NULL -> {
                reader.nextNull();
                yield JsonNull.INSTANCE;
            }
            default -> throw new JsonSyntaxException("Invalid JSON value.");
        };
    }

    public static JsonObject toJson(EmojiPack pack) {
        JsonObject root = new JsonObject();
        root.addProperty("schemaVersion", pack.schemaVersion());
        root.addProperty("id", pack.id());
        root.addProperty("name", pack.name());
        root.addProperty("description", pack.description());
        JsonArray emojis = new JsonArray();
        for (EmojiEntry entry : pack.emojis()) {
            JsonObject emoji = new JsonObject();
            emoji.addProperty("name", entry.name());
            emoji.addProperty("url", entry.url());
            emoji.addProperty("category", entry.category());
            emojis.add(emoji);
        }
        root.add("emojis", emojis);
        return root;
    }

    private static void validateUrl(String url, int index) throws PackValidationException {
        if (url.length() > 2048 || url.isEmpty()) {
            throw new PackValidationException("emojis[" + index + "].url must be between 1 and 2048 characters.");
        }
        for (int i = 0; i < url.length(); i++) {
            char c = url.charAt(i);
            if (Character.isWhitespace(c) || Character.isISOControl(c)) {
                throw new PackValidationException("emojis[" + index + "].url cannot contain whitespace or control characters.");
            }
        }
        try {
            java.net.URI uri = new java.net.URI(url);
            String scheme = uri.getScheme();
            if (!uri.isAbsolute() || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getPort() > 65535
                    || !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
                throw new PackValidationException("emojis[" + index + "].url must be an absolute HTTP or HTTPS URL without credentials.");
            }
        } catch (java.net.URISyntaxException e) {
            throw new PackValidationException("emojis[" + index + "].url is invalid.");
        }
    }

    private static void checkText(String value, int maxCodePoints, String field, boolean emptyAllowed)
            throws PackValidationException {
        int length = value.length();
        if (hasControlCharacters(value) || (!emptyAllowed && value.isBlank()) || length > maxCodePoints) {
            throw new PackValidationException(field + (emptyAllowed ? " must be at most " : " must be non-empty and at most ")
                    + maxCodePoints + " characters and cannot contain control characters.");
        }
    }

    private static boolean hasControlCharacters(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (Character.isISOControl(value.charAt(i))) {
                return true;
            }
        }
        return false;
    }

    private static void requireExactFields(JsonObject object, Set<String> expected, String label)
            throws PackValidationException {
        if (!object.keySet().equals(expected)) {
            throw new PackValidationException(label + " contains missing or unknown fields.");
        }
    }

    private static String string(JsonObject object, String key) throws PackValidationException {
        if (!object.has(key) || !object.get(key).isJsonPrimitive() || !object.getAsJsonPrimitive(key).isString()) {
            throw new PackValidationException(key + " must be a string.");
        }
        return object.get(key).getAsString();
    }

    private static int integer(JsonObject object, String key) throws PackValidationException {
        if (!object.has(key) || !object.get(key).isJsonPrimitive() || !object.getAsJsonPrimitive(key).isNumber()) {
            throw new PackValidationException(key + " must be an integer.");
        }
        try {
            String value = object.get(key).getAsString();
            if (!value.matches("-?[0-9]+")) {
                throw new NumberFormatException();
            }
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            throw new PackValidationException(key + " must be an integer.");
        }
    }
}
