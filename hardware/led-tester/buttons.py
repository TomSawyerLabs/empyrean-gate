import utime
from machine import Pin


class DebouncedButton:
    """Active-low button (pressed = pin pulled to GND) with a software
    debounce window. No hardware debounce (RC network) is present on
    these switches, so bounce is filtered here: once a transition is
    accepted, further transitions are ignored until debounce_ms passes.
    """

    def __init__(self, pin_num, debounce_ms=30):
        self._pin = Pin(pin_num, Pin.IN, Pin.PULL_UP)
        self._debounce_ms = debounce_ms
        self._last_change = 0
        self._stable_state = self._pin.value()
        self._pressed_flag = False
        self._pin.irq(trigger=Pin.IRQ_FALLING | Pin.IRQ_RISING, handler=self._on_change)

    def _on_change(self, pin):
        now = utime.ticks_ms()
        if utime.ticks_diff(now, self._last_change) < self._debounce_ms:
            return
        self._last_change = now
        state = self._pin.value()
        if state != self._stable_state:
            self._stable_state = state
            if state == 0:
                self._pressed_flag = True

    def take_press(self):
        if self._pressed_flag:
            self._pressed_flag = False
            return True
        return False
