//! The byte protocol between the engine and its DOOM child process
//! (plans/doom.md). Child → parent: fixed-size frames on stdout. Parent →
//! child: two-byte key events on stdin. Deliberately dumb — no lengths to
//! trust, no versions to negotiate; both ends are the same binary.

/// DOOM's native framebuffer. The C side is compiled with
/// `DOOMGENERIC_RESX/RESY` set to exactly this so no upscale happens.
pub const WIDTH: usize = 320;
pub const HEIGHT: usize = 200;

/// Leads every frame. A parser that loses sync (it cannot, on a pipe both ends
/// write whole frames to, but belt and braces) can scan for it.
pub const FRAME_MAGIC: [u8; 4] = *b"DGF1";
/// `RawStats` on the wire: this many little-endian i32s.
pub const STATS_WORDS: usize = 15;
pub const STATS_BYTES: usize = STATS_WORDS * 4;
/// 256 × RGB.
pub const PALETTE_BYTES: usize = 768;
pub const PIXELS: usize = WIDTH * HEIGHT;
/// Magic + stats + palette + one 8-bit index per pixel.
pub const FRAME_BYTES: usize = FRAME_MAGIC.len() + STATS_BYTES + PALETTE_BYTES + PIXELS;

/// What `shim.c`'s `dg_stats` fills — field for field, all i32, same order.
/// `ammo`/`max_ammo` are -1 for weapons that use none (fist, chainsaw).
#[repr(C)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RawStats {
    pub health: i32,
    pub armor: i32,
    pub ammo: i32,
    pub max_ammo: i32,
    /// `weapontype_t`: 0 fist, 1 pistol, 2 shotgun, 3 chaingun, 4 rockets,
    /// 5 plasma, 6 BFG, 7 chainsaw, 8 super shotgun.
    pub weapon: i32,
    pub kills: i32,
    pub total_kills: i32,
    pub items: i32,
    pub secrets: i32,
    pub episode: i32,
    pub map: i32,
    /// `gamestate_t`: 0 level, 1 intermission, 2 finale, 3 demo screen.
    pub state: i32,
    pub menu: i32,
    pub paused: i32,
    /// Tics (35/s) into the current map.
    pub leveltime: i32,
}

impl RawStats {
    pub fn to_le_bytes(&self) -> [u8; STATS_BYTES] {
        let words = [
            self.health,
            self.armor,
            self.ammo,
            self.max_ammo,
            self.weapon,
            self.kills,
            self.total_kills,
            self.items,
            self.secrets,
            self.episode,
            self.map,
            self.state,
            self.menu,
            self.paused,
            self.leveltime,
        ];
        let mut out = [0u8; STATS_BYTES];
        for (i, w) in words.iter().enumerate() {
            out[i * 4..i * 4 + 4].copy_from_slice(&w.to_le_bytes());
        }
        out
    }

    /// `bytes` must be at least `STATS_BYTES` long.
    pub fn from_le_bytes(bytes: &[u8]) -> Self {
        let word = |i: usize| {
            i32::from_le_bytes([bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]])
        };
        Self {
            health: word(0),
            armor: word(1),
            ammo: word(2),
            max_ammo: word(3),
            weapon: word(4),
            kills: word(5),
            total_kills: word(6),
            items: word(7),
            secrets: word(8),
            episode: word(9),
            map: word(10),
            state: word(11),
            menu: word(12),
            paused: word(13),
            leveltime: word(14),
        }
    }
}

/// One decoded frame, borrowing the wire buffer.
pub struct FrameView<'a> {
    pub stats: RawStats,
    /// 768 bytes, R G B per palette index.
    pub palette: &'a [u8],
    /// `PIXELS` palette indices, row-major, top row first.
    pub pixels: &'a [u8],
}

/// Split a wire frame. `None` if it is not exactly one frame with the magic.
pub fn parse_frame(buf: &[u8]) -> Option<FrameView<'_>> {
    if buf.len() != FRAME_BYTES || buf[..4] != FRAME_MAGIC {
        return None;
    }
    let stats_end = 4 + STATS_BYTES;
    let palette_end = stats_end + PALETTE_BYTES;
    Some(FrameView {
        stats: RawStats::from_le_bytes(&buf[4..stats_end]),
        palette: &buf[stats_end..palette_end],
        pixels: &buf[palette_end..],
    })
}

/// Lay a frame out for the wire into `out` (resized to `FRAME_BYTES`).
pub fn encode_frame(stats: &RawStats, palette: &[u8], pixels: &[u8], out: &mut Vec<u8>) {
    debug_assert_eq!(palette.len(), PALETTE_BYTES);
    debug_assert_eq!(pixels.len(), PIXELS);
    out.clear();
    out.reserve(FRAME_BYTES);
    out.extend_from_slice(&FRAME_MAGIC);
    out.extend_from_slice(&stats.to_le_bytes());
    out.extend_from_slice(palette);
    out.extend_from_slice(pixels);
}

/// Apply a palette: indexed pixels → packed RGB (`r | g<<8 | b<<16`, the
/// layout the gate shader's `game_unpack` reads). `out` is resized to fit.
pub fn apply_palette(palette: &[u8], pixels: &[u8], out: &mut Vec<u32>) {
    let mut lut = [0u32; 256];
    for (i, slot) in lut.iter_mut().enumerate() {
        let r = palette[i * 3] as u32;
        let g = palette[i * 3 + 1] as u32;
        let b = palette[i * 3 + 2] as u32;
        *slot = r | (g << 8) | (b << 16);
    }
    out.clear();
    out.extend(pixels.iter().map(|&p| lut[p as usize]));
}

/// A key event for the child: DOOM key code (`doomkeys.h`) and pressed flag.
pub fn encode_key(code: u8, down: bool) -> [u8; 2] {
    [u8::from(down), code]
}

pub fn decode_key(bytes: [u8; 2]) -> (bool, u8) {
    (bytes[0] != 0, bytes[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_round_trip_little_endian() {
        let stats = RawStats {
            health: 100,
            armor: -3,
            ammo: 50,
            max_ammo: 200,
            weapon: 1,
            kills: 7,
            total_kills: 30,
            items: 2,
            secrets: 1,
            episode: 1,
            map: 3,
            state: 0,
            menu: 1,
            paused: 0,
            leveltime: 35 * 61,
        };
        let bytes = stats.to_le_bytes();
        assert_eq!(bytes[..4], 100i32.to_le_bytes());
        assert_eq!(RawStats::from_le_bytes(&bytes), stats);
    }

    #[test]
    fn frame_round_trip_and_size() {
        let stats = RawStats { health: 42, ..Default::default() };
        let palette: Vec<u8> = (0..PALETTE_BYTES).map(|i| (i % 251) as u8).collect();
        let pixels: Vec<u8> = (0..PIXELS).map(|i| (i % 256) as u8).collect();
        let mut wire = Vec::new();
        encode_frame(&stats, &palette, &pixels, &mut wire);
        assert_eq!(wire.len(), FRAME_BYTES);
        let view = parse_frame(&wire).expect("valid frame");
        assert_eq!(view.stats, stats);
        assert_eq!(view.palette, &palette[..]);
        assert_eq!(view.pixels, &pixels[..]);
        // Wrong magic and wrong size are both rejected.
        let mut bad = wire.clone();
        bad[0] = b'X';
        assert!(parse_frame(&bad).is_none());
        assert!(parse_frame(&wire[..FRAME_BYTES - 1]).is_none());
    }

    #[test]
    fn palette_packs_red_in_the_low_byte() {
        let mut palette = vec![0u8; PALETTE_BYTES];
        palette[3] = 255; // index 1 = pure red
        palette[6 + 1] = 255; // index 2 = pure green
        palette[9 + 2] = 255; // index 3 = pure blue
        let mut out = Vec::new();
        apply_palette(&palette, &[0, 1, 2, 3], &mut out);
        assert_eq!(out, vec![0, 255, 255 << 8, 255 << 16]);
    }

    #[test]
    fn key_events_round_trip() {
        assert_eq!(decode_key(encode_key(0xad, true)), (true, 0xad));
        assert_eq!(decode_key(encode_key(27, false)), (false, 27));
    }
}
