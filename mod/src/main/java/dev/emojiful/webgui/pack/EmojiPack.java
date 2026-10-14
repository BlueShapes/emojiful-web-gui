package dev.emojiful.webgui.pack;

import java.util.List;

public record EmojiPack(int schemaVersion, String id, String name, String description, List<EmojiEntry> emojis) {
    public EmojiPack {
        emojis = List.copyOf(emojis);
    }
}
