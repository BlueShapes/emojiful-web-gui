package dev.emojiful.webgui.client;

import dev.emojiful.webgui.EmojifulWebGuiMod;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.Style;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.ClientPlayerNetworkEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

@Mod.EventBusSubscriber(modid = EmojifulWebGuiMod.MOD_ID, bus = Mod.EventBusSubscriber.Bus.FORGE, value = Dist.CLIENT)
public final class ClientKeybindEvents {
    private static boolean announcementPending;

    private ClientKeybindEvents() {
    }

    @SubscribeEvent
    public static void onLoggingIn(ClientPlayerNetworkEvent.LoggingIn event) {
        // Wait until the login packet finishes setting up the player and chat HUD.
        announcementPending = true;
    }

    @SubscribeEvent
    public static void onLoggingOut(ClientPlayerNetworkEvent.LoggingOut event) {
        announcementPending = false;
    }

    @SubscribeEvent
    public static void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) {
            return;
        }
        boolean requestedByKey = ClientKeybindRegistration.OPEN_GUI.consumeClick();
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.player == null || minecraft.level == null) {
            return;
        }
        // Show the automatic hint once the loading screen has closed, so it does not fade during loading.
        if ((announcementPending && minecraft.screen == null) || requestedByKey) {
            announcementPending = false;
            showGuiLink(minecraft);
        }
    }

    private static void showGuiLink(Minecraft minecraft) {
        String url = EmojifulWebGuiMod.getGuiUrl(minecraft.getLanguageManager().getSelected());
        if (url == null) {
            minecraft.player.displayClientMessage(Component.translatable("chat.emojiful_web_gui.unavailable")
                    .withStyle(ChatFormatting.RED), false);
            return;
        }
        Component link = Component.literal(url).setStyle(Style.EMPTY.withColor(ChatFormatting.AQUA).withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.OPEN_URL, url))
                .withHoverEvent(new HoverEvent(HoverEvent.Action.SHOW_TEXT,
                        Component.translatable("chat.emojiful_web_gui.open"))));
        minecraft.player.displayClientMessage(Component.translatable("chat.emojiful_web_gui.available", link), false);
    }
}
