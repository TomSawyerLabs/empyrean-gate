import random
from math import sin, pi

GREEN_HUE = 1.0 / 3.0

BREATHE_PERIOD_MS = 2000
FLASH_CYCLE_MS = 3000
FLASH_WINDOW_MS = 120

# Primary colors, then additive-mixed pairs, then all three mixed (white).
BODY_COLORS = (
    (255, 0, 0),
    (0, 255, 0),
    (0, 0, 255),
    (255, 255, 0),
    (255, 0, 255),
    (0, 255, 255),
    (255, 255, 255),
)
BODY_COLOR_PERIOD_MS = 1000

# Adafruit NeoPixel strandtest-style effects. Speed is 1/8 of the
# initial tuning (30ms/100ms/0.0008) -- they updated too quickly.
WIPE_WAIT_MS = 240
WIPE_PAUSE_STEPS = 10
CHASE_WAIT_MS = 800
STRANDTEST_RAINBOW_SPEED = 0.0001


def breathe_flash_hsv(t_ms, hue=GREEN_HUE):
    """Continuous green breathe, with two quick full-brightness white
    flashes overlaid once per flash cycle. Returns (h, s, v)."""
    pos = t_ms % FLASH_CYCLE_MS
    if pos < FLASH_WINDOW_MS or FLASH_WINDOW_MS * 2 <= pos < FLASH_WINDOW_MS * 3:
        return 0.0, 0.0, 1.0
    phase = (t_ms % BREATHE_PERIOD_MS) / BREATHE_PERIOD_MS
    v = (sin(phase * 2 * pi - pi / 2) + 1) / 2
    v = 0.05 + v * 0.95
    return hue, 1.0, v


def body_color(t_ms):
    """Solid color cycling through the primaries and their additive
    mixes (red, green, blue, yellow, magenta, cyan, white), switching
    roughly once per second."""
    idx = (t_ms // BODY_COLOR_PERIOD_MS) % len(BODY_COLORS)
    return BODY_COLORS[idx]


def color_wipe_rgb(index, t_ms, color, num_leds, wait_ms=WIPE_WAIT_MS, pause_steps=WIPE_PAUSE_STEPS):
    """Adafruit strandtest colorWipe: fill the strip one LED at a time,
    hold briefly at full, then reset off and wipe again."""
    cycle_len = num_leds + pause_steps
    phase = (t_ms // wait_ms) % cycle_len
    lit = min(phase, num_leds)
    return color if index < lit else (0, 0, 0)


def theater_chase_rgb(index, t_ms, color, wait_ms=CHASE_WAIT_MS):
    """Adafruit strandtest theaterChase: every third LED lit, marching."""
    phase = (t_ms // wait_ms) % 3
    return color if (index % 3) == phase else (0, 0, 0)


def rainbow_hsv(t_ms, speed=STRANDTEST_RAINBOW_SPEED):
    """Adafruit strandtest rainbow: every LED the same cycling hue."""
    return (t_ms * speed) % 1.0, 1.0, 1.0


def rainbow_cycle_hue(index, t_ms, num_leds, speed=STRANDTEST_RAINBOW_SPEED):
    """Adafruit strandtest rainbowCycle: one hue gradient across the
    whole strip, sliding over time."""
    return (t_ms * speed + index / num_leds) % 1.0


def theater_chase_rainbow_hsv(index, t_ms, wait_ms=CHASE_WAIT_MS, speed=STRANDTEST_RAINBOW_SPEED):
    """Adafruit strandtest theaterChaseRainbow: theaterChase with the
    chase color cycling through hues. Returns None for unlit LEDs."""
    phase = (t_ms // wait_ms) % 3
    if (index % 3) != phase:
        return None
    return (t_ms * speed) % 1.0, 1.0, 1.0


def rand_below(n):
    """Uniform random int in [0, n). Uses only getrandbits, since
    randint/choice require a MicroPython build option that isn't
    guaranteed to be enabled."""
    bits = 0
    v = n
    while v:
        bits += 1
        v >>= 1
    while True:
        r = random.getrandbits(bits)
        if r < n:
            return r


class Twinkler:
    """A sparse, density-capped set of independently-timed breathe+flash
    twinkles (see breathe_flash_hsv), each at a random LED with a random
    hue. Each slot periodically jumps to a new random LED and hue, so
    different LEDs twinkle over time rather than a fixed set forever.
    """

    RESPAWN_MS = 4000

    def __init__(self, num_leds, max_active):
        self.num_leds = num_leds
        self.slots = [self._new_slot(0) for _ in range(max_active)]

    def _new_slot(self, now_ms):
        return [rand_below(self.num_leds), random.getrandbits(8) / 255.0, now_ms]

    def colors(self, now_ms):
        """Return [(led_index, (h, s, v)), ...] for the active twinkles."""
        out = []
        for slot in self.slots:
            if now_ms - slot[2] >= self.RESPAWN_MS:
                slot[0], slot[1], slot[2] = self._new_slot(now_ms)
            index, hue, start = slot
            out.append((index, breathe_flash_hsv(now_ms - start, hue)))
        return out
