import ujson

NUM_LEDS = 378
CONFIG_PATH = "config.json"

DEFAULTS = {
    "first_led": 2,
    "last_led": NUM_LEDS - 1,
    "boundary_brightness": 100,
    "twinkle_brightness": 100,
    "strandtest_brightness": 100,
}


def load():
    try:
        with open(CONFIG_PATH) as f:
            data = ujson.load(f)
    except (OSError, ValueError):
        data = {}
    cfg = dict(DEFAULTS)
    cfg.update(data)
    return cfg


def save(cfg):
    with open(CONFIG_PATH, "w") as f:
        ujson.dump(cfg, f)
