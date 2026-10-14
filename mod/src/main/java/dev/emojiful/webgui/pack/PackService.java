package dev.emojiful.webgui.pack;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

public final class PackService {
    private static final String METADATA_ENTRY = "emojiful-web-gui.json";
    private static final int MAX_METADATA_BYTES = 2 * 1024 * 1024;
    private final Path gameDirectory;

    public PackService(Path gameDirectory) {
        this.gameDirectory = gameDirectory.toAbsolutePath().normalize();
    }

    public Path getManagedPackDirectory() {
        return gameDirectory.resolve("config").resolve("emojiful-web-gui").resolve("packs");
    }

    public List<PackSummary> list() throws IOException {
        Path directory = getManagedPackDirectory();
        if (!isManagedDirectorySafe()) {
            return List.of();
        }
        List<PackSummary> result = new ArrayList<>();
        try (DirectoryStream<Path> entries = Files.newDirectoryStream(directory, "*.zip")) {
            for (Path file : entries) {
                if (Files.isSymbolicLink(file) || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
                    continue;
                }
                String filename = file.getFileName().toString();
                String expectedId = filename.substring(0, filename.length() - 4);
                if (!expectedId.matches("[a-z0-9_]{1,64}")) {
                    continue;
                }
                readManagedPack(file, expectedId).ifPresent(pack -> result.add(
                        new PackSummary(pack.id(), pack.name(), pack.emojis().size(), filename)));
            }
        }
        result.sort(Comparator.comparing(PackSummary::id));
        return List.copyOf(result);
    }

    public EmojiPack load(String id) throws IOException, PackNotFoundException {
        if (id == null || !id.matches("[a-z0-9_]{1,64}")) {
            throw new PackNotFoundException("Pack not found.");
        }
        if (!isManagedDirectorySafe()) {
            throw new PackNotFoundException("Pack not found.");
        }
        Path file = getManagedPackDirectory().resolve(id + ".zip");
        if (Files.isSymbolicLink(file) || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new PackNotFoundException("Pack not found.");
        }
        return readManagedPack(file, id).orElseThrow(() -> new PackNotFoundException("Pack not found."));
    }

    public synchronized String save(EmojiPack pack, boolean overwrite) throws IOException, PackValidationException, PackConflictException {
        if (pack == null || !pack.id().matches("[a-z0-9_]{1,64}")) {
            throw new PackValidationException("Pack is invalid.");
        }
        // Re-validate through the wire schema so callers outside HTTP receive the same guarantees.
        EmojiPack validated = PackJson.parseAndValidate(PackJson.toJson(pack).toString());
        Path directory = prepareDirectory();
        Path target = directory.resolve(validated.id() + ".zip");
        if (Files.isSymbolicLink(target)) {
            throw new PackConflictException("The target path is a symbolic link.");
        }
        boolean targetExists = Files.exists(target, LinkOption.NOFOLLOW_LINKS);
        if (targetExists) {
            if (!readManagedPack(target, validated.id()).isPresent()) {
                throw new PackConflictException("An unmanaged file already uses this pack ID.");
            }
            if (!overwrite) {
                throw new PackConflictException("A pack with this ID already exists.");
            }
        }

        Path temporary = directory.resolve("." + validated.id() + "." + UUID.randomUUID() + ".tmp");
        try {
            writeArchive(temporary, validated);
            if (Files.isSymbolicLink(target)) {
                throw new PackConflictException("The target path became a symbolic link.");
            }
            if (overwrite && targetExists) {
                try {
                    Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } catch (AtomicMoveNotSupportedException e) {
                    Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
                }
            } else {
                // A non-atomic no-replace move avoids provider-specific atomic replacement of a race-created target.
                Files.move(temporary, target);
            }
        } catch (java.nio.file.FileAlreadyExistsException e) {
            throw new PackConflictException("A file already uses this pack ID.");
        } finally {
            Files.deleteIfExists(temporary);
        }
        return target.getFileName().toString();
    }

    private boolean isManagedDirectorySafe() {
        Path config = gameDirectory.resolve("config");
        Path application = config.resolve("emojiful-web-gui");
        Path packs = application.resolve("packs");
        for (Path directory : List.of(config, application, packs)) {
            if (Files.isSymbolicLink(directory)
                    || (Files.exists(directory, LinkOption.NOFOLLOW_LINKS)
                    && !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS))) {
                return false;
            }
        }
        return Files.isDirectory(packs, LinkOption.NOFOLLOW_LINKS);
    }

    private Path prepareDirectory() throws IOException, PackConflictException {
        Path config = gameDirectory.resolve("config");
        Path application = config.resolve("emojiful-web-gui");
        Path packs = application.resolve("packs");
        ensureDirectory(config);
        ensureDirectory(application);
        ensureDirectory(packs);
        return packs;
    }

    private static void ensureDirectory(Path directory) throws IOException, PackConflictException {
        if (Files.isSymbolicLink(directory)) {
            throw new PackConflictException("Managed pack directories cannot be symbolic links.");
        }
        if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) {
            if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
                throw new PackConflictException("A managed pack directory path is occupied by a file.");
            }
        } else {
            Files.createDirectory(directory);
        }
    }

    private static java.util.Optional<EmojiPack> readManagedPack(Path file, String expectedId) {
        try (ZipFile zip = new ZipFile(file.toFile())) {
            ZipEntry metadata = zip.getEntry(METADATA_ENTRY);
            if (metadata == null || metadata.getSize() > MAX_METADATA_BYTES) {
                return java.util.Optional.empty();
            }
            try (InputStream input = zip.getInputStream(metadata)) {
                byte[] bytes = input.readNBytes(MAX_METADATA_BYTES + 1);
                if (bytes.length > MAX_METADATA_BYTES) {
                    return java.util.Optional.empty();
                }
                EmojiPack pack = PackJson.parseAndValidate(new String(bytes, StandardCharsets.UTF_8));
                return expectedId.equals(pack.id()) ? java.util.Optional.of(pack) : java.util.Optional.empty();
            }
        } catch (IOException | PackValidationException | RuntimeException e) {
            return java.util.Optional.empty();
        }
    }

    private static void writeArchive(Path destination, EmojiPack pack) throws IOException {
        try (OutputStream file = Files.newOutputStream(destination);
             ZipOutputStream zip = new ZipOutputStream(file, StandardCharsets.UTF_8)) {
            JsonObject mcmeta = new JsonObject();
            JsonObject packMetadata = new JsonObject();
            packMetadata.addProperty("pack_format", 15);
            packMetadata.addProperty("description", pack.description().isEmpty() ? pack.name() : pack.description());
            mcmeta.add("pack", packMetadata);
            putEntry(zip, "pack.mcmeta", mcmeta.toString());

            for (EmojiEntry emoji : pack.emojis()) {
                JsonObject recipe = new JsonObject();
                recipe.addProperty("type", "emojiful:emoji_recipe");
                recipe.addProperty("category", emoji.category());
                recipe.addProperty("name", emoji.name());
                recipe.addProperty("url", emoji.url());
                putEntry(zip, "data/" + pack.id() + "/recipes/" + emoji.name() + ".json", recipe.toString());
            }
            putEntry(zip, METADATA_ENTRY, PackJson.toJson(pack).toString());
        }
    }

    private static void putEntry(ZipOutputStream zip, String name, String contents) throws IOException {
        ZipEntry entry = new ZipEntry(name);
        entry.setTime(0L);
        zip.putNextEntry(entry);
        zip.write(contents.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }
}
