import utime

MASK_RS = 0x01
MASK_E = 0x04
SHIFT_BACKLIGHT = 3
SHIFT_DATA = 4

LCD_CLR = 0x01
LCD_ENTRY_MODE = 0x04
LCD_ENTRY_INC = 0x02
LCD_ON_CTRL = 0x08
LCD_ON_DISPLAY = 0x04
LCD_FUNCTION = 0x20
LCD_FUNCTION_2LINES = 0x08

ROW_OFFSETS = (0x00, 0x40, 0x14, 0x54)


class Lcd20x4:
    """Driver for a 20x4 HD44780 character LCD behind a PCF8574 I2C backpack.

    Default I2C address for these backpacks is usually 0x27 or 0x3F -- if
    nothing shows up, run an i2c.scan() to find the actual address.
    """

    def __init__(self, i2c, addr=0x27, num_lines=4, num_columns=20):
        self.i2c = i2c
        self.addr = addr
        self.num_lines = num_lines
        self.num_columns = num_columns
        self.backlight = True

        utime.sleep_ms(20)
        self._write_init_nibble(0x03)
        utime.sleep_ms(5)
        self._write_init_nibble(0x03)
        utime.sleep_us(150)
        self._write_init_nibble(0x03)
        self._write_init_nibble(0x02)

        self._command(LCD_FUNCTION | LCD_FUNCTION_2LINES)
        self._command(LCD_ON_CTRL | LCD_ON_DISPLAY)
        self.clear()
        self._command(LCD_ENTRY_MODE | LCD_ENTRY_INC)

    def _i2c_write(self, data):
        self.i2c.writeto(self.addr, bytes([data]))

    def _pulse_enable(self, data):
        self._i2c_write(data | MASK_E)
        utime.sleep_us(1)
        self._i2c_write(data & ~MASK_E)
        utime.sleep_us(50)

    def _write_nibble(self, nibble, rs):
        bl = (1 << SHIFT_BACKLIGHT) if self.backlight else 0
        data = (nibble << SHIFT_DATA) | bl | (MASK_RS if rs else 0)
        self._i2c_write(data)
        self._pulse_enable(data)

    def _write_init_nibble(self, nibble):
        self._write_nibble(nibble, rs=0)

    def _command(self, cmd):
        self._write_nibble(cmd >> 4, rs=0)
        self._write_nibble(cmd & 0x0F, rs=0)
        if cmd == LCD_CLR:
            utime.sleep_ms(2)

    def _data(self, data):
        self._write_nibble(data >> 4, rs=1)
        self._write_nibble(data & 0x0F, rs=1)

    def clear(self):
        self._command(LCD_CLR)

    def backlight_on(self):
        self.backlight = True
        self._i2c_write(1 << SHIFT_BACKLIGHT)

    def backlight_off(self):
        self.backlight = False
        self._i2c_write(0)

    def move_to(self, col, row):
        self._command(0x80 | ((col & 0x3F) + ROW_OFFSETS[row]))

    def putstr(self, s):
        for ch in s:
            self._data(ord(ch))

    def write_line(self, row, text):
        self.move_to(0, row)
        text = text[: self.num_columns]
        text += " " * (self.num_columns - len(text))
        self.putstr(text)
