from machine import Pin

_REST = 0b11


class RotaryEncoder:
    """Quadrature decoder for a KY-040 style encoder (CLK + DT).

    A KY-040 at rest reads CLK=1, DT=1. Rotating one detent walks the
    (CLK, DT) pair through the other three combinations and back to rest,
    in one order for clockwise and the reverse order for counter-clockwise.

    Rather than sampling a single instant (e.g. "read DT when CLK falls"),
    which is easily fooled by contact bounce mid-transition, this only
    commits a step when the pins return to the rest state, using whichever
    state was seen first on leaving rest to decide direction. Bounce that
    happens between the two intermediate states, without ever touching
    rest, can't register as a spurious step.

    If clockwise registers as decreasing instead of increasing on your
    unit, swap the two branches in _on_change that set _direction_hint.
    """

    def __init__(self, clk_pin, dt_pin):
        self._clk = Pin(clk_pin, Pin.IN, Pin.PULL_UP)
        self._dt = Pin(dt_pin, Pin.IN, Pin.PULL_UP)
        self._position = 0
        self._direction_hint = 0
        self._prev_state = self._read_state()
        self._clk.irq(trigger=Pin.IRQ_FALLING | Pin.IRQ_RISING, handler=self._on_change)
        self._dt.irq(trigger=Pin.IRQ_FALLING | Pin.IRQ_RISING, handler=self._on_change)

    def _read_state(self):
        return (self._clk.value() << 1) | self._dt.value()

    def _on_change(self, pin):
        state = self._read_state()
        if state == self._prev_state:
            return

        if self._prev_state == _REST:
            if state == 0b01:
                self._direction_hint = 1
            elif state == 0b10:
                self._direction_hint = -1
            else:
                self._direction_hint = 0
        elif state == _REST and self._direction_hint != 0:
            self._position += self._direction_hint
            self._direction_hint = 0

        self._prev_state = state

    def take_delta(self):
        d = self._position
        self._position = 0
        return d
