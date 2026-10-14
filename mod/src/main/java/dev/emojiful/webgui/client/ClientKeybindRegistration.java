package dev.emojiful.webgui.client;

import dev.emojiful.webgui.EmojifulWebGuiMod;
import net.minecraft.client.KeyMapping;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import org.lwjgl.glfw.GLFW;

@Mod.EventBusSubscriber(modid = EmojifulWebGuiMod.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public final class ClientKeybindRegistration {
    static final KeyMapping OPEN_GUI = new KeyMapping("key.emojiful_web_gui.open", GLFW.GLFW_KEY_UNKNOWN,
            "key.categories.emojiful_web_gui");

    private ClientKeybindRegistration() {
    }

    @SubscribeEvent
    public static void registerKeybind(RegisterKeyMappingsEvent event) {
        event.register(OPEN_GUI);
    }
}
