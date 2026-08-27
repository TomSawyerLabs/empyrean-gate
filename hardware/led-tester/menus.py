from config import NUM_LEDS, save as save_config
from patterns import (
    breathe_flash_hsv,
    body_color,
    Twinkler,
    color_wipe_rgb,
    theater_chase_rgb,
    rainbow_hsv,
    rainbow_cycle_hue,
    theater_chase_rainbow_hsv,
)

RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)
WHITE = (255, 255, 255)
YELLOW = (255, 255, 0)
OFF = (0, 0, 0)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


class Menu:
    name = "Menu"

    def __init__(self, app):
        self.app = app

    def enter(self):
        pass

    def update(self, now_ms):
        pass

    def on_rotate(self, delta):
        pass

    def on_encoder_click(self):
        pass

    def on_button_press(self):
        """Return True if this menu consumed the button press (acted as
        'back'), so the app should not advance to the next menu."""
        return False


class BoundaryConfigMenu(Menu):
    name = "1:Strip Bounds"

    FIELD_FIRST = 0
    FIELD_LAST = 1
    FIELD_BRIGHTNESS = 2
    NUM_FIELDS = 3
    FIELD_KEYS = ("first_led", "last_led", "boundary_brightness")

    def __init__(self, app):
        super().__init__(app)
        self.field = self.FIELD_FIRST
        self.editing = False
        self.edit_original = None

    def enter(self):
        self.field = self.FIELD_FIRST
        self.editing = False
        self.edit_original = None
        self._draw_labels()

    def on_rotate(self, delta):
        cfg = self.app.config
        if not self.editing:
            step = 1 if delta > 0 else -1
            self.field = (self.field + step) % self.NUM_FIELDS
        elif self.field == self.FIELD_FIRST:
            cfg["first_led"] = clamp(cfg["first_led"] + delta, 0, cfg["last_led"] - 1)
        elif self.field == self.FIELD_LAST:
            cfg["last_led"] = clamp(cfg["last_led"] + delta, cfg["first_led"] + 1, NUM_LEDS - 1)
        else:
            cfg["boundary_brightness"] = clamp(cfg["boundary_brightness"] + delta, 0, 100)
        self._draw_labels()

    def on_encoder_click(self):
        cfg = self.app.config
        key = self.FIELD_KEYS[self.field]
        if not self.editing:
            self.editing = True
            self.edit_original = cfg[key]
        else:
            self.editing = False
            self.edit_original = None
            save_config(cfg)
        self._draw_labels()

    def on_button_press(self):
        if self.editing:
            key = self.FIELD_KEYS[self.field]
            self.app.config[key] = self.edit_original
            self.editing = False
            self.edit_original = None
            self._draw_labels()
            return True
        return False

    def _draw_labels(self):
        cfg = self.app.config
        active_mark = "*" if self.editing else ">"
        first_mark = active_mark if self.field == self.FIELD_FIRST else " "
        last_mark = active_mark if self.field == self.FIELD_LAST else " "
        brightness_mark = active_mark if self.field == self.FIELD_BRIGHTNESS else " "
        self.app.lcd.write_line(1, "{}First LED: {}".format(first_mark, cfg["first_led"] + 1))
        self.app.lcd.write_line(2, "{}Last LED: {}".format(last_mark, cfg["last_led"] + 1))
        self.app.lcd.write_line(3, "{}Brightness: {}%".format(brightness_mark, cfg["boundary_brightness"]))

    def update(self, now_ms):
        cfg = self.app.config
        first = cfg["first_led"]
        last = cfg["last_led"]
        strip = self.app.strip
        b = cfg["boundary_brightness"] / 100.0
        raw_body = body_color(now_ms)
        body_rgb = (int(raw_body[0] * b), int(raw_body[1] * b), int(raw_body[2] * b))
        for i in range(NUM_LEDS):
            if i < first:
                strip.set_rgb(i, *RED)
            elif i == first or i == last:
                strip.set_hsv(i, *breathe_flash_hsv(now_ms))
            elif last - 6 <= i < last:
                strip.set_rgb(i, *RED)
            elif i > last:
                strip.set_rgb(i, *YELLOW)
            else:
                strip.set_rgb(i, *body_rgb)


class LedLocatorMenu(Menu):
    name = "2:Single LED Test"

    def __init__(self, app):
        super().__init__(app)
        self.index = 0

    def enter(self):
        self.index = 0
        self._draw()
        self._render()

    def on_rotate(self, delta):
        self.index = (self.index + delta) % NUM_LEDS
        self._draw()
        self._render()

    def _draw(self):
        self.app.lcd.write_line(1, "LED: {}".format(self.index + 1))

    def _render(self):
        strip = self.app.strip
        for i in range(NUM_LEDS):
            strip.set_rgb(i, *(RED if i == self.index else OFF))


class PatternTestMenu(Menu):
    name = "3:LED Pattern Test"

    PATTERNS = (
        ("RGBW", (RED, GREEN, BLUE, WHITE)),
        ("RG", (RED, GREEN)),
        ("GR", (GREEN, RED)),
        ("W", (WHITE,)),
    )

    def __init__(self, app):
        super().__init__(app)
        self.pattern_index = 0

    def enter(self):
        self.pattern_index = 0
        self._draw()
        self._render()

    def on_rotate(self, delta):
        self.pattern_index = (self.pattern_index + delta) % len(self.PATTERNS)
        self._draw()
        self._render()

    def _draw(self):
        label, _ = self.PATTERNS[self.pattern_index]
        self.app.lcd.write_line(1, "Pattern: {}".format(self.pattern_index + 1))
        self.app.lcd.write_line(2, label)

    def _render(self):
        _, colors = self.PATTERNS[self.pattern_index]
        strip = self.app.strip
        for i in range(NUM_LEDS):
            strip.set_rgb(i, *colors[i % len(colors)])


class BrightnessAdjustableMenu(Menu):
    """Adds a 'click encoder switch to adjust brightness' mode: one click
    enters brightness-adjust (rotation now changes brightness instead of
    the menu's normal rotate behavior, live on line 4 with a "*" marker),
    a second click saves it to flash and hands rotation back to the
    menu's normal behavior (_on_rotate_normal).

    Subclasses set `brightness_key` to their own config key, so each
    menu's brightness is independent (not shared).
    """

    brightness_key = None

    def __init__(self, app):
        super().__init__(app)
        self.adjusting_brightness = False

    def enter(self):
        self.adjusting_brightness = False
        self._draw_brightness()

    def on_rotate(self, delta):
        if self.adjusting_brightness:
            cfg = self.app.config
            cfg[self.brightness_key] = clamp(cfg[self.brightness_key] + delta, 0, 100)
            self._draw_brightness()
        else:
            self._on_rotate_normal(delta)

    def on_encoder_click(self):
        if self.adjusting_brightness:
            self.adjusting_brightness = False
            save_config(self.app.config)
        else:
            self.adjusting_brightness = True
        self._draw_brightness()

    def _on_rotate_normal(self, delta):
        pass

    def _draw_brightness(self):
        mark = "*" if self.adjusting_brightness else " "
        pct = self.app.config[self.brightness_key]
        self.app.lcd.write_line(3, "{}Brightness: {}%".format(mark, pct))

    def _scale_v(self, v):
        return v * (self.app.config[self.brightness_key] / 100.0)

    def _scale_rgb(self, color):
        b = self.app.config[self.brightness_key] / 100.0
        return int(color[0] * b), int(color[1] * b), int(color[2] * b)


class TwinkleStarMenu(BrightnessAdjustableMenu):
    """Only uses LEDs 0..(last_led saved in Menu 1), not the full strip --
    re-read on every enter() since that's the only place Menu 1's config
    can have changed since we were last here."""

    name = "4:Twinkle Star"
    brightness_key = "twinkle_brightness"

    def __init__(self, app):
        super().__init__(app)
        self.twinkler = None

    def enter(self):
        super().enter()
        active = self.app.config["last_led"] + 1
        self.twinkler = Twinkler(active, max(1, active // 10))

    def update(self, now_ms):
        strip = self.app.strip
        for i in range(NUM_LEDS):
            strip.set_rgb(i, *OFF)
        for index, (h, s, v) in self.twinkler.colors(now_ms):
            strip.set_hsv(index, h, s, self._scale_v(v))


class StrandtestMenu(BrightnessAdjustableMenu):
    """Adafruit NeoPixel strandtest effects: colorWipe (R/G/B),
    theaterChase, rainbow, rainbowCycle, theaterChaseRainbow."""

    name = "5:Adafruit Examples"
    brightness_key = "strandtest_brightness"

    def __init__(self, app):
        super().__init__(app)
        self.effect_index = 0
        self.effects = (
            ("Rainbow Cycle", self._rainbow_cycle),
            ("Wipe Red", self._wipe_red),
            ("Wipe Green", self._wipe_green),
            ("Wipe Blue", self._wipe_blue),
            ("Theater Chase", self._chase),
            ("Rainbow", self._rainbow),
            ("Chase Rainbow", self._chase_rainbow),
        )

    def enter(self):
        super().enter()
        self.effect_index = 0
        self._draw()

    def _on_rotate_normal(self, delta):
        self.effect_index = (self.effect_index + delta) % len(self.effects)
        self._draw()

    def _draw(self):
        label, _ = self.effects[self.effect_index]
        self.app.lcd.write_line(1, "Effect: {}".format(self.effect_index + 1))
        self.app.lcd.write_line(2, label)

    def update(self, now_ms):
        active = self.app.config["last_led"] + 1
        _, render = self.effects[self.effect_index]
        render(now_ms, active)

    def _wipe_red(self, now_ms, active):
        self._wipe(now_ms, RED, active)

    def _wipe_green(self, now_ms, active):
        self._wipe(now_ms, GREEN, active)

    def _wipe_blue(self, now_ms, active):
        self._wipe(now_ms, BLUE, active)

    def _wipe(self, now_ms, color, active):
        strip = self.app.strip
        for i in range(NUM_LEDS):
            if i < active:
                strip.set_rgb(i, *self._scale_rgb(color_wipe_rgb(i, now_ms, color, active)))
            else:
                strip.set_rgb(i, *OFF)

    def _chase(self, now_ms, active):
        strip = self.app.strip
        for i in range(NUM_LEDS):
            if i < active:
                strip.set_rgb(i, *self._scale_rgb(theater_chase_rgb(i, now_ms, WHITE)))
            else:
                strip.set_rgb(i, *OFF)

    def _rainbow(self, now_ms, active):
        strip = self.app.strip
        h, s, v = rainbow_hsv(now_ms)
        v = self._scale_v(v)
        for i in range(NUM_LEDS):
            if i < active:
                strip.set_hsv(i, h, s, v)
            else:
                strip.set_rgb(i, *OFF)

    def _rainbow_cycle(self, now_ms, active):
        strip = self.app.strip
        v = self._scale_v(1.0)
        for i in range(NUM_LEDS):
            if i < active:
                strip.set_hsv(i, rainbow_cycle_hue(i, now_ms, active), 1.0, v)
            else:
                strip.set_rgb(i, *OFF)

    def _chase_rainbow(self, now_ms, active):
        strip = self.app.strip
        for i in range(NUM_LEDS):
            if i >= active:
                strip.set_rgb(i, *OFF)
                continue
            hsv = theater_chase_rainbow_hsv(i, now_ms)
            if hsv is None:
                strip.set_rgb(i, *OFF)
            else:
                h, s, v = hsv
                strip.set_hsv(i, h, s, self._scale_v(v))
