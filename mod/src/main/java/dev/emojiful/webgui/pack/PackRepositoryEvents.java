package dev.emojiful.webgui.pack;

import dev.emojiful.webgui.EmojifulWebGuiMod;
import net.minecraft.network.chat.Component;
import net.minecraft.server.packs.FilePackResources;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.repository.Pack;
import net.minecraft.server.packs.repository.PackSource;
import net.minecraftforge.event.AddPackFindersEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLPaths;
import org.slf4j.Logger;
import com.mojang.logging.LogUtils;

import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;

@Mod.EventBusSubscriber(modid = EmojifulWebGuiMod.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)
public final class PackRepositoryEvents {
    private static final Logger LOGGER = LogUtils.getLogger();

    private PackRepositoryEvents() {
    }

    @SubscribeEvent
    public static void addManagedPacks(AddPackFindersEvent event) {
        if (event.getPackType() != PackType.SERVER_DATA) {
            return;
        }
        event.addRepositorySource(packConsumer -> {
            Path directory = new PackService(FMLPaths.GAMEDIR.get()).getManagedPackDirectory();
            if (!Files.isDirectory(directory) || Files.isSymbolicLink(directory)) {
                return;
            }
            try (DirectoryStream<Path> files = Files.newDirectoryStream(directory, "*.zip")) {
                for (Path file : files) {
                    if (Files.isSymbolicLink(file) || !Files.isRegularFile(file)) {
                        continue;
                    }
                    String filename = file.getFileName().toString();
                    String packId = filename.substring(0, filename.length() - 4);
                    if (!packId.matches("[a-z0-9_]{1,64}")) {
                        continue;
                    }
                    try {
                        EmojiPack managed = new PackService(FMLPaths.GAMEDIR.get()).load(packId);
                        Pack pack = Pack.readMetaAndCreate(
                                EmojifulWebGuiMod.MOD_ID + ":" + packId,
                                Component.literal(managed.name()),
                                true,
                                name -> new FilePackResources(name, file.toFile(), false),
                                PackType.SERVER_DATA,
                                Pack.Position.TOP,
                                PackSource.BUILT_IN);
                        if (pack != null) {
                            packConsumer.accept(pack);
                        }
                    } catch (Exception e) {
                        LOGGER.warn("Skipping invalid managed Emojiful pack {}.", filename, e);
                    }
                }
            } catch (Exception e) {
                LOGGER.warn("Unable to scan managed Emojiful packs at {}.", directory, e);
            }
        });
    }
}
