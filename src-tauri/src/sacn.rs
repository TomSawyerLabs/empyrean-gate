//! Minimal, allocation-free sACN (ANSI E1.31) sender. Hand-rolled: the packet format
//! is small, stable, and well specified; this avoids an external protocol dependency.
//!
//! Efficiency: getting frames from the GPU onto the wire is a primary feature, so all
//! packets are prebuilt once per configuration — headers, destinations, and slot
//! offsets — and each frame only (1) LUT-copies pixel bytes straight into the resident
//! packet buffers, (2) bumps sequence numbers, (3) calls send_to. Zero heap traffic in
//! the steady state.
//!
//! Universe layout: each spoke occupies `universes_per_spoke` consecutive universes
//! starting at `start_universe + spoke * universes_per_spoke`, `pixels_per_universe`
//! RGB pixels per universe, channel 1 = red of the spoke's outermost pixel.

use crate::config::{GeometryConfig, OutputConfig};
use crate::geometry;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};

const SACN_PORT: u16 = 5568;
const ACN_ID: [u8; 12] = *b"ASC-E1.17\0\0\0";
/// Offset of the sequence-number byte within a data packet.
const SEQ_OFFSET: usize = 111;
/// Offset of the first DMX slot (after the start code).
const SLOTS_OFFSET: usize = 126;

struct UniversePlan {
    /// Prebuilt packet: headers + start code; slots filled per frame.
    packet: Vec<u8>,
    /// Byte offset of this universe's pixel data within the frame RGB buffer.
    src_offset: usize,
    /// Number of pixel bytes carried by this universe.
    src_len: usize,
    unicast: Option<SocketAddrV4>,
    multicast: Option<SocketAddrV4>,
    sequence: u8,
}

pub struct SacnSender {
    socket: UdpSocket,
    cid: [u8; 16],
    source_name: [u8; 64],
    plan: Vec<UniversePlan>,
    gamma_lut: [u8; 256],
    lut_gamma: f32,
}

impl SacnSender {
    pub fn new() -> std::io::Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")?;

        // CID must be stable per source; derive one from a fixed tag + process id.
        let mut cid = *b"EmpyreanGate\0\0\0\0";
        cid[12..16].copy_from_slice(&std::process::id().to_le_bytes());

        let mut source_name = [0u8; 64];
        let name = b"Empyrean Gate";
        source_name[..name.len()].copy_from_slice(name);

        Ok(Self {
            socket,
            cid,
            source_name,
            plan: Vec::new(),
            gamma_lut: [0; 256],
            lut_gamma: 0.0,
        })
    }

    /// (Re)build packet templates and destinations. Call on config changes, not per frame.
    pub fn configure(&mut self, geo: &GeometryConfig, out: &OutputConfig) {
        self.plan.clear();
        let ppu = out.pixels_per_universe.max(1) as u32;
        let ups = geometry::universes_per_spoke(geo, out) as u32;

        for spoke in 0..geo.spokes {
            let unicast = geometry::controller_for_spoke(out, spoke)
                .and_then(|ip| ip.parse::<Ipv4Addr>().ok())
                .map(|ip| SocketAddrV4::new(ip, SACN_PORT));
            for u in 0..ups {
                let first_pixel = u * ppu;
                if first_pixel >= geo.pixels_per_spoke {
                    break;
                }
                let count = ppu.min(geo.pixels_per_spoke - first_pixel);
                let universe = out.start_universe + (spoke * ups + u) as u16;
                let multicast = out.multicast.then(|| {
                    SocketAddrV4::new(
                        Ipv4Addr::new(239, 255, (universe >> 8) as u8, (universe & 0xff) as u8),
                        SACN_PORT,
                    )
                });
                self.plan.push(UniversePlan {
                    packet: build_packet_template(
                        &self.cid,
                        &self.source_name,
                        out.priority,
                        universe,
                        (count * 3) as usize,
                    ),
                    src_offset: ((spoke * geo.pixels_per_spoke + first_pixel) * 3) as usize,
                    src_len: (count * 3) as usize,
                    unicast,
                    multicast,
                    sequence: 0,
                });
            }
        }

        if (self.lut_gamma - out.led_gamma).abs() > 1e-3 {
            for (i, v) in self.gamma_lut.iter_mut().enumerate() {
                let x = i as f32 / 255.0;
                *v = (x.powf(out.led_gamma) * 255.0 + 0.5) as u8;
            }
            self.lut_gamma = out.led_gamma;
        }
    }

    /// Send one full frame of perceptual RGB data (as produced by the engine).
    /// LED gamma is applied here, scattering directly into the resident packets;
    /// the preview shows the raw values.
    pub fn send_frame(&mut self, rgb: &[u8]) -> std::io::Result<usize> {
        let mut packets = 0;
        for plan in &mut self.plan {
            let Some(src) = rgb.get(plan.src_offset..plan.src_offset + plan.src_len) else {
                continue; // frame size changed mid-reconfigure; skip until re-plan
            };
            let dst = &mut plan.packet[SLOTS_OFFSET..SLOTS_OFFSET + plan.src_len];
            for (d, s) in dst.iter_mut().zip(src) {
                *d = self.gamma_lut[*s as usize];
            }
            plan.sequence = plan.sequence.wrapping_add(1);
            plan.packet[SEQ_OFFSET] = plan.sequence;

            if let Some(addr) = plan.unicast {
                self.socket.send_to(&plan.packet, addr)?;
                packets += 1;
            }
            if let Some(addr) = plan.multicast {
                self.socket.send_to(&plan.packet, addr)?;
                packets += 1;
            }
        }
        Ok(packets)
    }

    pub fn universe_count(&self) -> u16 {
        self.plan.len() as u16
    }
}

fn build_packet_template(
    cid: &[u8; 16],
    source_name: &[u8; 64],
    priority: u8,
    universe: u16,
    data_len: usize,
) -> Vec<u8> {
    debug_assert!(data_len <= 512);
    let property_count = 1 + data_len as u16; // start code + slots
    let total = SLOTS_OFFSET + data_len;
    let mut p = Vec::with_capacity(total);

    // --- Root layer ---
    p.extend_from_slice(&0x0010u16.to_be_bytes()); // preamble size
    p.extend_from_slice(&0x0000u16.to_be_bytes()); // post-amble size
    p.extend_from_slice(&ACN_ID);
    p.extend_from_slice(&flags_len(total - 16));
    p.extend_from_slice(&0x0000_0004u32.to_be_bytes()); // VECTOR_ROOT_E131_DATA
    p.extend_from_slice(cid);

    // --- Framing layer ---
    p.extend_from_slice(&flags_len(total - 38));
    p.extend_from_slice(&0x0000_0002u32.to_be_bytes()); // VECTOR_E131_DATA_PACKET
    p.extend_from_slice(source_name);
    p.push(priority);
    p.extend_from_slice(&0u16.to_be_bytes()); // sync address
    debug_assert_eq!(p.len(), SEQ_OFFSET);
    p.push(0); // sequence, rewritten per frame
    p.push(0); // options
    p.extend_from_slice(&universe.to_be_bytes());

    // --- DMP layer ---
    p.extend_from_slice(&flags_len(total - 115));
    p.push(0x02); // VECTOR_DMP_SET_PROPERTY
    p.push(0xa1); // address & data type
    p.extend_from_slice(&0u16.to_be_bytes()); // first property address
    p.extend_from_slice(&1u16.to_be_bytes()); // address increment
    p.extend_from_slice(&property_count.to_be_bytes());
    p.push(0x00); // DMX start code
    debug_assert_eq!(p.len(), SLOTS_OFFSET);
    p.resize(total, 0);
    p
}

fn flags_len(len: usize) -> [u8; 2] {
    (0x7000u16 | (len as u16 & 0x0fff)).to_be_bytes()
}
