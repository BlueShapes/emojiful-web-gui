package dev.emojiful.webgui;

import com.mojang.logging.LogUtils;
import dev.emojiful.webgui.http.WebGuiHttpServer;
import dev.emojiful.webgui.i18n.LocaleRoutes;
import dev.emojiful.webgui.pack.PackService;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.fml.loading.FMLPaths;
import org.slf4j.Logger;

import java.io.IOException;

@Mod(EmojifulWebGuiMod.MOD_ID)
public final class EmojifulWebGuiMod {
    public static final String MOD_ID = "emojiful_web_gui";
    private static final Logger LOGGER = LogUtils.getLogger();
    private static volatile WebGuiHttpServer httpServer;
    private static volatile LocaleRoutes localeRoutes;

    public EmojifulWebGuiMod() {
        FMLJavaModLoadingContext.get().getModEventBus().addListener(this::commonSetup);
    }

    public static String getGuiUrl(String minecraftLanguage) {
        WebGuiHttpServer current = httpServer;
        return current == null ? null : getLocaleRoutes().localizedUrl(current.getUrl(), minecraftLanguage);
    }

    private static LocaleRoutes getLocaleRoutes() {
        LocaleRoutes current = localeRoutes;
        if (current != null) {
            return current;
        }
        synchronized (EmojifulWebGuiMod.class) {
            current = localeRoutes;
            if (current == null) {
                try {
                    current = LocaleRoutes.load(EmojifulWebGuiMod.class.getClassLoader());
                } catch (IOException e) {
                    LOGGER.warn("Unable to load generated web GUI language routes; using English fallback.", e);
                    current = LocaleRoutes.englishFallback();
                }
                localeRoutes = current;
            }
        }
        return current;
    }

    private void commonSetup(FMLCommonSetupEvent event) {
        event.enqueueWork(() -> {
            if (httpServer != null) {
                return;
            }
            int requestedPort;
            try {
                requestedPort = Integer.parseInt(System.getProperty("emojiful.webgui.port",
                        Integer.toString(WebGuiHttpServer.DEFAULT_PORT)));
                if (requestedPort < 0 || requestedPort > 65535) {
                    throw new NumberFormatException("Port out of range");
                }
            } catch (NumberFormatException e) {
                LOGGER.warn("Invalid emojiful.webgui.port value; expected 0–65535. Web GUI server was not started.");
                return;
            }

            WebGuiHttpServer created = new WebGuiHttpServer(
                    new PackService(FMLPaths.GAMEDIR.get()),
                    EmojifulWebGuiMod.class.getClassLoader(),
                    message -> LOGGER.warn("{}", message));
            try {
                created.start(requestedPort);
                httpServer = created;
                Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                    created.close();
                    LOGGER.info("Emojiful Web GUI server stopped.");
                }, "emojiful-web-gui-shutdown"));
                LOGGER.info("Emojiful Web GUI is available at {}", created.getUrl());
            } catch (Exception e) {
                created.close();
                LOGGER.warn("Unable to start the local Emojiful Web GUI server; the game will continue without it.", e);
            }
        });
    }
}
