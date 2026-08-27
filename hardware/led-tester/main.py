import utime
from machine import Pin, I2C
import plasma

from lcd import Lcd20x4
from rotary import RotaryEncoder
from buttons import DebouncedButton
import config as cfgmod
from config import NUM_LEDS
from menus import (
    BoundaryConfigMenu,
    LedLocatorMenu,
    PatternTestMenu,
    TwinkleStarMenu,
    StrandtestMenu,
)

PIN_I2C_SDA = 16
PIN_I2C_SCL = 17
PIN_MENU_BUTTON = 13
PIN_ENCODER_CLK = 2
PIN_ENCODER_DT = 5
PIN_ENCODER_SW = 14

# Menus 4 and 5 (0-indexed: 3, 4) turn the LCD backlight off after this
# many ms with no encoder/button activity. Menus 1-3 keep it on always.
BACKLIGHT_TIMEOUT_MS = 15000
BACKLIGHT_TIMEOUT_MENU_INDICES = (3, 4)


class App:
    def __init__(self):
        self.config = cfgmod.load()

        self.strip = plasma.WS2812(NUM_LEDS, color_order=plasma.COLOR_ORDER_RGB)
        self.strip.start()

        i2c = I2C(0, sda=Pin(PIN_I2C_SDA), scl=Pin(PIN_I2C_SCL), freq=400000)
        self.lcd = Lcd20x4(i2c)

        self.encoder = RotaryEncoder(PIN_ENCODER_CLK, PIN_ENCODER_DT)
        self.encoder_button = DebouncedButton(PIN_ENCODER_SW)
        self.menu_button = DebouncedButton(PIN_MENU_BUTTON)

        self.menus = [
            BoundaryConfigMenu(self),
            LedLocatorMenu(self),
            PatternTestMenu(self),
            TwinkleStarMenu(self),
            StrandtestMenu(self),
        ]
        self.menu_index = 0
        self.backlight_on = True
        self.last_activity_ms = 0

    def run(self):
        self._enter_current_menu()

        while True:
            now = utime.ticks_ms()
            menu = self.menus[self.menu_index]

            delta = self.encoder.take_delta()
            encoder_clicked = self.encoder_button.take_press()
            menu_clicked = self.menu_button.take_press()

            if delta or encoder_clicked or menu_clicked:
                self._register_activity(now)

            if delta:
                menu.on_rotate(delta)

            if encoder_clicked:
                menu.on_encoder_click()

            if menu_clicked:
                if not menu.on_button_press():
                    self._next_menu()
                    menu = self.menus[self.menu_index]

            menu.update(now)
            self._update_backlight(now)
            utime.sleep_ms(15)

    def _next_menu(self):
        self.menu_index = (self.menu_index + 1) % len(self.menus)
        self._enter_current_menu()

    def _enter_current_menu(self):
        # Clear first so a menu that doesn't use all 4 rows doesn't leave
        # the previous menu's leftover text on the unused rows.
        self.lcd.clear()
        menu = self.menus[self.menu_index]
        menu.enter()
        self.lcd.write_line(0, menu.name)
        self._set_backlight(True)
        self.last_activity_ms = utime.ticks_ms()

    def _register_activity(self, now):
        self.last_activity_ms = now
        if not self.backlight_on:
            self._set_backlight(True)

    def _update_backlight(self, now):
        if self.menu_index not in BACKLIGHT_TIMEOUT_MENU_INDICES:
            return
        if self.backlight_on and utime.ticks_diff(now, self.last_activity_ms) >= BACKLIGHT_TIMEOUT_MS:
            self._set_backlight(False)

    def _set_backlight(self, on):
        self.backlight_on = on
        if on:
            self.lcd.backlight_on()
        else:
            self.lcd.backlight_off()


App().run()
