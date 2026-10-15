//! Still image nodes carry their picture in the patch as a `data:image/...`
//! URL (editors store 256×256). The engine decodes it here into the RGBA cell
//! the patch shader samples (`image_at`). Anything else is resized to fill
//! the square, center-cropped, as video frames are.

use base64::Engine as _;
use empyrean_patch::abi::IMAGE_SIZE;

/// Decode a node's `media` into `IMAGE_SIZE`² RGBA bytes.
pub fn decode(data_url: &str) -> Result<Vec<u8>, String> {
    let (head, body) = data_url
        .split_once(";base64,")
        .ok_or("not a base64 data URL")?;
    if !head.starts_with("data:image/") {
        return Err("not an image data URL".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body.trim())
        .map_err(|e| format!("bad base64: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("can't decode: {e}"))?;
    let size = IMAGE_SIZE as u32;
    let img = if img.width() == size && img.height() == size {
        img
    } else {
        img.resize_to_fill(size, size, image::imageops::FilterType::Triangle)
    };
    Ok(img.to_rgba8().into_raw())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_data_url(w: u32, h: u32) -> String {
        let mut png = Vec::new();
        image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        )
    }

    #[test]
    fn decodes_to_one_square_cell() {
        for (w, h) in [(256, 256), (640, 360), (10, 30)] {
            let rgba = decode(&png_data_url(w, h)).unwrap();
            assert_eq!(rgba.len(), IMAGE_SIZE * IMAGE_SIZE * 4, "{w}x{h}");
            assert_eq!(&rgba[..4], &[10, 20, 30, 255]);
        }
    }

    #[test]
    fn rejects_what_is_not_an_image() {
        assert!(decode("https://example.com/a.png").is_err());
        assert!(decode("data:text/plain;base64,aGk=").is_err());
        assert!(decode("data:image/png;base64,bm90IGEgcG5n").is_err());
    }
}
