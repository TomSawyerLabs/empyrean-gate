# WS2815B LED Test Box

MicroPython firmware for a Pimoroni Plasma Stick 2040 W driving a 378-LED
WS2815B strip test rig, with a 20x4 I2C character LCD, a KY-040 rotary
encoder, and a separate menu-cycle push button.

## Prerequisites

- Flash the board with **Pimoroni's MicroPython build** (not stock
  MicroPython) so the `plasma` and `pimoroni` modules are available:
  https://github.com/pimoroni/pimoroni-pico/releases
- Common ground between the WS2815B's 12V supply and the Plasma Stick.

## Wiring (GP = RP2040 GPIO number)

| Function | Pin |
|---|---|
| WS2815B data (via onboard level shifter) | GP15 |
| LCD I2C SDA | GP16 |
| LCD I2C SCL | GP17 |
| Menu-cycle push button (other leg to GND) | GP13 |
| Encoder CLK | GP2 |
| Encoder DT | GP5 |
| Encoder switch (other leg to GND) | GP14 |

Push button and encoder switch are wired to ground the pin when pressed,
read with the RP2040's internal pull-ups (active low) -- no external
resistors needed. Neither switch has hardware debounce, so both are
debounced in software (`buttons.py`, `DebouncedButton`, 30ms window).

## Deploying

Copy all `.py` files in this folder to the root of the Pico's flash
filesystem (e.g. with `mpremote` or Thonny), so `main.py` runs on boot:

```
mpremote cp config.py lcd.py rotary.py patterns.py menus.py main.py :
```

`config.json` is created automatically on first save in Menu 1 and
persists the configured first/last LED indices across power cycles.

## If the LCD shows nothing

PCF8574 I2C backpacks commonly use address `0x27` or `0x3F`. This driver
defaults to `0x27` (`lcd.py` -> `Lcd20x4.__init__`). If the screen stays
blank, run an I2C scan from the REPL and update the `addr` passed to
`Lcd20x4(...)` in `main.py`:

```python
from machine import Pin, I2C
i2c = I2C(0, sda=Pin(16), scl=Pin(17))
print(i2c.scan())
```

## Note on the `plasma` API

Pimoroni split `plasma` out of the old `pimoroni-pico` monorepo into its
own repo/firmware (https://github.com/pimoroni/plasma), and current
releases dropped the `plasma_stick`/`plasma2040` pin-name submodules --
each board's firmware build now already knows its own onboard LED data
pin, so `WS2812(...)` is constructed without `pio`/`sm`/`pin` args:
`plasma.WS2812(NUM_LEDS, color_order=plasma.COLOR_ORDER_RGB)`. If you're
on an older firmware build that still has `plasma_stick`, that's fine too
-- just don't mix the two calling conventions.

## If colors look wrong

`main.py` passes `color_order=plasma.COLOR_ORDER_RGB` to the `WS2812`
constructor. If red/green/blue appear swapped on your strip, try
`plasma.COLOR_ORDER_GRB` instead.

## LED numbering

Internally and in `config.json`, LEDs are indexed 0-377. The LCD displays
1-378 (LED index + 1) for readability -- e.g. physical LED 0 is reported
as "LED: 1" on screen.

## Menus

- **Menu 1 -- Strip Bounds**: configures and previews where the strip's
  real first/last LEDs are (strips often have the first couple LEDs
  hidden behind signage, and are often shorter than 378 LEDs due to
  damage). False-start LEDs and the 6 LEDs before the real last LED are
  solid red; the real first/last LEDs pulse green with white flashes; the
  body between them cycles as one solid color at a time -- red, green,
  blue, then the additive-mixed pairs (yellow, magenta, cyan), then white
  -- switching about once a second; anything past the real last LED up to
  378 is solid yellow. Rotate to pick First LED, Last LED, or Brightness
  (wraps at both ends), click to edit the selected field, rotate to dial
  it (live preview), click again to commit and save to flash. The
  menu-cycle button, instead of advancing menus while editing, **cancels**
  the in-progress edit -- it reverts the field to its last-saved value
  (discarding whatever you'd dialed in) and exits edit mode without
  writing to flash.
  Brightness (line 4, "Brightness: n%", `config["boundary_brightness"]`)
  only scales the cycling body color -- it does not affect the false-start
  red LEDs, the real first/last LED markers, the last-6 red LEDs, or the
  yellow dead zone, which always render at full brightness.
- **Menu 2 -- Single LED Test**: rotate the encoder to walk a single bright
  red LED to any index 0-377, to find its physical position on the strip.
  Movement wraps continuously -- rotating left past LED 1 lands on the
  last LED, and rotating right past the last LED lands back on LED 1. The
  encoder switch has no function here.
- **Menu 3 -- LED Pattern Test**: rotate the encoder to browse repeating
  color patterns applied across the whole strip (0-377), wrapping at both
  ends. Line 2 shows "Pattern: n", line 3 shows the pattern's color
  initials. Patterns: 1 = RGBW repeating, 2 = RG repeating, 3 = GR
  repeating, 4 = solid white. The encoder switch has no function here.
- **Menu 4 -- Twinkle Star**: ambient effect. Up to `NUM_LEDS // 10` LEDs
  (density-capped at roughly 1 per 10 LEDs) twinkle at a time, each with
  its own random hue, breathing and flashing the same way as Menu 1's
  boundary markers (`patterns.breathe_flash_hsv`). Every ~4s each
  twinkling LED jumps to a new random position and color
  (`patterns.Twinkler`), so different LEDs twinkle over time rather than a
  fixed set. All other LEDs stay off. Brightness control -- see below.
- **Menu 5 -- Adafruit Examples**: Adafruit NeoPixel strandtest effects.
  Rotate to browse, wrapping at both ends. Line 2 shows "Effect: n", line
  3 shows the effect name. Effects: 1 = Rainbow Cycle (one hue gradient
  sliding across the whole strip), 2 = Color Wipe Red, 3 = Color Wipe
  Green, 4 = Color Wipe Blue (each fills the strip one LED at a time,
  holds, then resets and wipes again), 5 = Theater Chase (marching
  every-third-LED dots, white), 6 = Rainbow (every LED the same cycling
  hue), 7 = Theater Chase Rainbow (theater chase with the chase color
  cycling through hues). Update speed for all of these is 1/8 of the
  initial tuning (`patterns.py`: `WIPE_WAIT_MS`, `CHASE_WAIT_MS`,
  `STRANDTEST_RAINBOW_SPEED`) since they updated too quickly. Brightness
  control -- see below.

Menus 4 and 5 both scope their LED range to `config["last_led"] + 1`
(re-read from Menu 1's saved setting), not the full 378 -- e.g. if Menu 1
has Last LED set to 300, only indices 0-299 are used by these two menus'
effects, and anything from 300 onward is forced off. Menu 4 re-reads this
on every `enter()`; Menu 5 re-reads it every frame.

### Brightness control (Menus 4 and 5)

Line 4 always shows "Brightness: n%", with a "*" prefix in place of the
leading space while brightness is being adjusted. Click the encoder
switch once to enter brightness-adjust mode -- rotating now changes
brightness (0-100%, live on line 4) instead of the menu's normal rotate
behavior. Click again to save the value to `config.json` and hand
rotation back to the menu's normal behavior. Menu 4 and Menu 5 each have
their own independent brightness (`config["twinkle_brightness"]` and
`config["strandtest_brightness"]`) -- adjusting one does not affect the
other. Each menu's `brightness_key` class attribute
(`menus.BrightnessAdjustableMenu`) points at its own config key; scaling
happens via `_scale_v` / `_scale_rgb`. Doesn't affect Menus 1-3.

### LCD backlight timeout (Menus 4 and 5)

Entering Menu 4 or Menu 5 turns the LCD backlight on and starts a 15s
countdown. Any encoder rotation or button press (menu-cycle button or
encoder switch) resets the countdown and turns the backlight back on if
it had timed out. If 15s pass with no activity while still in Menu 4 or
5, the backlight turns off (`main.py`: `BACKLIGHT_TIMEOUT_MS`,
`App._update_backlight` / `_register_activity` / `_set_backlight`).
Switching to Menu 1, 2, or 3 always turns the backlight back on and it
stays on regardless of inactivity -- the timeout only applies while
Menu 4 or 5 is active. Backlight toggling
(`lcd.Lcd20x4.backlight_on`/`backlight_off`) writes only the backlight
bit to the PCF8574 (enable pin left low), so it doesn't disturb the
currently displayed text.
