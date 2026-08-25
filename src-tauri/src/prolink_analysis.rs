//! Rekordbox ANLZ song-structure parsing used by the PRO DJ LINK runtime.
//!
//! PSSI is exported by rekordbox 6+ when phrase analysis is enabled. Players
//! expose the tag through dbserver's generic ANLZ request, so parsing happens
//! once on track load rather than in the render loop.

use crate::protocol::{ProDjLinkActivePhrase, ProDjLinkPhraseAnalysis, ProDjLinkPhraseInfo};

const BASE_MASK: [u8; 19] = [
    0xcb, 0xe1, 0xee, 0xfa, 0xe5, 0xee, 0xad, 0xee, 0xe9, 0xd2, 0xe9, 0xeb, 0xe1, 0xe9, 0xf3, 0xe8,
    0xe9, 0xf4, 0xe1,
];
const BODY_HEADER_SIZE: usize = 0x0c;
const ENTRY_SIZE: usize = 24;

fn u16be(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn u32be(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn phrase_kind(mood: &str, raw: u16) -> &'static str {
    match (mood, raw) {
        ("high", 1) | ("mid", 1) | ("low", 1) => "intro",
        ("high", 2) => "up",
        ("high", 3) => "down",
        ("high", 5) => "chorus",
        ("high", 6) => "outro",
        ("mid", 2) => "verse1",
        ("mid", 3) => "verse2",
        ("mid", 4) => "verse3",
        ("mid", 5) => "verse4",
        ("mid", 6) => "verse5",
        ("mid", 7) => "verse6",
        ("low", 2) => "verse1a",
        ("low", 3) => "verse1b",
        ("low", 4) => "verse1c",
        ("low", 5) => "verse2a",
        ("low", 6) => "verse2b",
        ("low", 7) => "verse2c",
        ("mid" | "low", 8) => "bridge",
        ("mid" | "low", 9) => "chorus",
        ("mid" | "low", 10) => "outro",
        _ => "default",
    }
}

fn bank_name(raw: u8) -> &'static str {
    match raw {
        0 => "default",
        1 => "cool",
        2 => "natural",
        3 => "hot",
        4 => "subtle",
        5 => "warm",
        6 => "vivid",
        7 => "club1",
        8 => "club2",
        _ => "unknown",
    }
}

/// Parse a complete PSSI section (including its ANLZ section header) or a
/// bare PSSI body. Unknown phrase kinds are preserved through `raw_kind`.
pub fn parse_pssi_tag(tag: &[u8]) -> Option<ProDjLinkPhraseAnalysis> {
    let body = if tag.starts_with(b"PSSI") {
        let header_len = u32be(tag, 4)? as usize;
        let tag_len = u32be(tag, 8)? as usize;
        if header_len < 12 || tag_len < header_len || tag_len > tag.len() {
            return None;
        }
        &tag[header_len..tag_len]
    } else {
        tag
    };
    if body.len() < BODY_HEADER_SIZE {
        return None;
    }
    let count = (body.len() - BODY_HEADER_SIZE) / ENTRY_SIZE;
    let clear: Vec<u8> = body
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ BASE_MASK[index % BASE_MASK.len()].wrapping_add(count as u8))
        .collect();
    // Some rekordbox generations leave the entry-size word inconsistent;
    // the section length is authoritative and already bounds every entry.
    let mood = match u16be(&clear, 4)? {
        1 => "high",
        2 => "mid",
        3 => "low",
        _ => return None,
    };
    let end_beat = u32::from(u16be(&clear, 6)?);
    let bank = bank_name(*clear.get(10)?).to_owned();
    let mut phrases = Vec::with_capacity(count);
    for index in 0..count {
        let base = BODY_HEADER_SIZE + index * ENTRY_SIZE;
        let raw_kind = u16be(&clear, base + 4)?;
        let fill_in = *clear.get(base + 0x14)? != 0;
        phrases.push(ProDjLinkPhraseInfo {
            phrase_number: u16be(&clear, base)?,
            start_beat: u32::from(u16be(&clear, base + 2)?),
            end_beat: 0,
            start_ms: 0,
            end_ms: 0,
            kind: phrase_kind(mood, raw_kind).to_owned(),
            raw_kind,
            fill_in,
            fill_in_beat: fill_in.then(|| u32::from(u16be(&clear, base + 0x16).unwrap_or(0))),
        });
    }
    for index in 0..phrases.len() {
        phrases[index].end_beat = phrases
            .get(index + 1)
            .map_or(end_beat, |next| next.start_beat.saturating_sub(1));
    }
    Some(ProDjLinkPhraseAnalysis {
        mood: mood.to_owned(),
        bank,
        end_beat,
        phrases,
    })
}

pub fn active_phrase(
    analysis: &ProDjLinkPhraseAnalysis,
    beat_number: u64,
    beat_phase: f32,
) -> Option<ProDjLinkActivePhrase> {
    let beat = u32::try_from(beat_number).ok()?;
    let phrase = analysis
        .phrases
        .iter()
        .find(|phrase| beat >= phrase.start_beat && beat <= phrase.end_beat)?;
    let length = phrase
        .end_beat
        .saturating_sub(phrase.start_beat)
        .saturating_add(1)
        .max(1) as f32;
    let elapsed = beat.saturating_sub(phrase.start_beat) as f32 + beat_phase.clamp(0.0, 0.999_999);
    Some(ProDjLinkActivePhrase {
        phrase_number: phrase.phrase_number,
        kind: phrase.kind.clone(),
        mood: analysis.mood.clone(),
        bank: analysis.bank.clone(),
        start_beat: phrase.start_beat,
        end_beat: phrase.end_beat,
        progress: (elapsed / length).clamp(0.0, 1.0),
        beats_remaining: (length - elapsed).max(0.0),
        fill_in_active: phrase
            .fill_in_beat
            .is_some_and(|fill_beat| beat >= fill_beat),
    })
}

pub fn phrase_kind_code(kind: &str) -> f32 {
    match kind {
        "intro" => 1.0,
        "up" => 2.0,
        "down" => 3.0,
        "chorus" => 4.0,
        "outro" => 5.0,
        kind if kind.starts_with("verse") => 6.0,
        "bridge" => 7.0,
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_be_bytes());
    }

    #[test]
    fn parses_obfuscated_high_mood_phrases() {
        let count = 3usize;
        let mut clear = vec![0u8; BODY_HEADER_SIZE + count * ENTRY_SIZE];
        clear[0..4].copy_from_slice(&(ENTRY_SIZE as u32).to_be_bytes());
        put_u16(&mut clear, 4, 1);
        put_u16(&mut clear, 6, 97);
        clear[10] = 7;
        for (index, (beat, kind)) in [(1, 1), (33, 2), (65, 5)].into_iter().enumerate() {
            let base = BODY_HEADER_SIZE + index * ENTRY_SIZE;
            put_u16(&mut clear, base, index as u16 + 1);
            put_u16(&mut clear, base + 2, beat);
            put_u16(&mut clear, base + 4, kind);
        }
        let body: Vec<u8> = clear
            .iter()
            .enumerate()
            .map(|(index, byte)| {
                byte ^ BASE_MASK[index % BASE_MASK.len()].wrapping_add(count as u8)
            })
            .collect();
        let parsed = parse_pssi_tag(&body).expect("PSSI");
        assert_eq!(parsed.mood, "high");
        assert_eq!(parsed.bank, "club1");
        assert_eq!(parsed.phrases[1].kind, "up");
        assert_eq!(parsed.phrases[1].end_beat, 64);
        assert_eq!(parsed.phrases[2].kind, "chorus");
        assert_eq!(parsed.phrases[2].end_beat, 97);
    }

    #[test]
    fn resolves_live_phrase_and_progress_from_deck_beat() {
        let analysis = ProDjLinkPhraseAnalysis {
            mood: "high".into(),
            bank: "club1".into(),
            end_beat: 64,
            phrases: vec![ProDjLinkPhraseInfo {
                phrase_number: 2,
                start_beat: 33,
                end_beat: 64,
                kind: "up".into(),
                fill_in: true,
                fill_in_beat: Some(61),
                ..Default::default()
            }],
        };
        let phrase = active_phrase(&analysis, 49, 0.0).expect("active phrase");
        assert_eq!(phrase.kind, "up");
        assert!((phrase.progress - 0.5).abs() < f32::EPSILON);
        assert!(!phrase.fill_in_active);
        assert!(active_phrase(&analysis, 61, 0.0).unwrap().fill_in_active);
    }
}
