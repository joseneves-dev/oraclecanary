//! Reading Ed25519 precompile instruction data.
//!
//! Layout: `num_signatures u8 | padding u8 | num_signatures * offsets(14 bytes) | payload`, where
//! each offsets record is seven little-endian u16:
//! `signature_offset, signature_instruction_index, public_key_offset, public_key_instruction_index,
//! message_data_offset, message_data_size, message_instruction_index`.
//!
//! An instruction index of `u16::MAX` means "this same instruction". Any other value lets the
//! signature, key or message live in a different instruction of the transaction, which is how
//! offset tricks swap in an unverified message; entries like that are ignored here.

use anchor_lang::prelude::Pubkey;

pub const OFFSETS_START: usize = 2;
pub const OFFSETS_LEN: usize = 14;
pub const SIGNATURE_LEN: usize = 64;
pub const PUBKEY_LEN: usize = 32;
pub const CURRENT_INSTRUCTION: u16 = u16::MAX;

fn read_u16(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn slice(data: &[u8], offset: u16, len: usize) -> Option<&[u8]> {
    let start = offset as usize;
    data.get(start..start.checked_add(len)?)
}

/// Returns the (public key, message) of every signature in this Ed25519 instruction whose
/// signature, public key and message all come from the instruction itself.
pub fn self_contained_entries(data: &[u8]) -> Vec<(Pubkey, &[u8])> {
    let mut out = Vec::new();
    let Some(&count) = data.first() else { return out };
    for i in 0..count as usize {
        let base = OFFSETS_START + i * OFFSETS_LEN;
        let (Some(sig_off), Some(sig_ix), Some(pk_off), Some(pk_ix), Some(msg_off), Some(msg_len), Some(msg_ix)) = (
            read_u16(data, base),
            read_u16(data, base + 2),
            read_u16(data, base + 4),
            read_u16(data, base + 6),
            read_u16(data, base + 8),
            read_u16(data, base + 10),
            read_u16(data, base + 12),
        ) else {
            break;
        };
        if sig_ix != CURRENT_INSTRUCTION || pk_ix != CURRENT_INSTRUCTION || msg_ix != CURRENT_INSTRUCTION {
            continue;
        }
        let (Some(_), Some(pk), Some(msg)) = (
            slice(data, sig_off, SIGNATURE_LEN),
            slice(data, pk_off, PUBKEY_LEN),
            slice(data, msg_off, msg_len as usize),
        ) else {
            continue;
        };
        let Ok(pk) = <[u8; PUBKEY_LEN]>::try_from(pk) else { continue };
        out.push((Pubkey::new_from_array(pk), msg));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn single(pk: [u8; 32], msg: &[u8], indexes: [u16; 3]) -> Vec<u8> {
        let pk_off = (OFFSETS_START + OFFSETS_LEN) as u16;
        let sig_off = pk_off + PUBKEY_LEN as u16;
        let msg_off = sig_off + SIGNATURE_LEN as u16;
        let mut d = vec![1u8, 0];
        for v in [sig_off, indexes[0], pk_off, indexes[1], msg_off, msg.len() as u16, indexes[2]] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(&pk);
        d.extend_from_slice(&[7u8; SIGNATURE_LEN]);
        d.extend_from_slice(msg);
        d
    }

    #[test]
    fn reads_self_contained_entry() {
        let d = single([9; 32], b"hello", [u16::MAX; 3]);
        let got = self_contained_entries(&d);
        assert_eq!(got, vec![(Pubkey::new_from_array([9; 32]), &b"hello"[..])]);
    }

    #[test]
    fn ignores_entries_pointing_at_other_instructions() {
        for idx in [[0, u16::MAX, u16::MAX], [u16::MAX, 0, u16::MAX], [u16::MAX, u16::MAX, 1]] {
            assert!(self_contained_entries(&single([9; 32], b"hello", idx)).is_empty());
        }
    }

    #[test]
    fn ignores_out_of_bounds_and_truncated_data() {
        let mut d = single([9; 32], b"hello", [u16::MAX; 3]);
        d.truncate(d.len() - 1);
        assert!(self_contained_entries(&d).is_empty());
        assert!(self_contained_entries(&[]).is_empty());
        assert!(self_contained_entries(&[3, 0, 1]).is_empty());
    }
}
