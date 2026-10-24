#![cfg(test)]

#[derive(Clone)]
enum Value {
    Byte(Vec<u8>),
    Ascii(String),
    Short(Vec<u16>),
    Long(Vec<u32>),
    Rational(Vec<(u32, u32)>),
    SRational(Vec<(i32, i32)>),
    BlobOffset(usize),
    BlobLength(u32),
    IfdOffset(usize),
}

impl Value {
    fn encode(&self, blob_offsets: &[usize], ifd_offsets: &[usize]) -> (u16, u32, Vec<u8>) {
        match self {
            Self::Byte(values) => (1, values.len() as u32, values.clone()),
            Self::Ascii(value) => (2, value.len() as u32 + 1, [value.as_bytes(), &[0]].concat()),
            Self::Short(values) => (3, values.len() as u32, values.iter().flat_map(|v| v.to_le_bytes()).collect()),
            Self::Long(values) => (4, values.len() as u32, values.iter().flat_map(|v| v.to_le_bytes()).collect()),
            Self::Rational(values) => (5, values.len() as u32, values.iter().flat_map(|(n, d)| [n.to_le_bytes(), d.to_le_bytes()].concat()).collect()),
            Self::SRational(values) => (10, values.len() as u32, values.iter().flat_map(|(n, d)| [n.to_le_bytes(), d.to_le_bytes()].concat()).collect()),
            Self::BlobOffset(index) => (4, 1, (blob_offsets[*index] as u32).to_le_bytes().to_vec()),
            Self::BlobLength(length) => (4, 1, length.to_le_bytes().to_vec()),
            Self::IfdOffset(index) => (4, 1, (ifd_offsets[*index] as u32).to_le_bytes().to_vec()),
        }
    }
}

type Entry = (u16, Value);

fn build(ifds: Vec<Vec<Entry>>, blobs: Vec<Vec<u8>>) -> Vec<u8> {
    let mut ifds=ifds;
    for entries in &mut ifds { entries.sort_by_key(|(tag, _)| *tag); }
    let mut ifd_offsets = Vec::with_capacity(ifds.len());
    let mut position = 8usize;
    for entries in &ifds {
        ifd_offsets.push(position);
        position += 2 + entries.len() * 12 + 4;
    }
    let mut value_offsets = Vec::with_capacity(ifds.len());
    for entries in &ifds {
        let mut offsets = Vec::with_capacity(entries.len());
        for (_, value) in entries {
            let (_, _, bytes) = value.encode(&vec![0;blobs.len()], &vec![0;ifds.len()]);
            if bytes.len() > 4 {
                if position % 2 != 0 { position += 1; }
                offsets.push(Some(position));
                position += bytes.len();
            } else {
                offsets.push(None);
            }
        }
        value_offsets.push(offsets);
    }
    let mut blob_offsets = Vec::with_capacity(blobs.len());
    for blob in &blobs {
        if position % 2 != 0 { position += 1; }
        blob_offsets.push(position);
        position += blob.len();
    }
    let mut output = vec![0; position];
    output[0..4].copy_from_slice(b"II*\0");
    output[4..8].copy_from_slice(&(ifd_offsets[0] as u32).to_le_bytes());
    for (ifd_index, entries) in ifds.iter().enumerate() {
        let base = ifd_offsets[ifd_index];
        output[base..base + 2].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        for (entry_index, (tag, value)) in entries.iter().enumerate() {
            let at = base + 2 + entry_index * 12;
            let (kind, count, bytes) = value.encode(&blob_offsets, &ifd_offsets);
            output[at..at + 2].copy_from_slice(&tag.to_le_bytes());
            output[at + 2..at + 4].copy_from_slice(&kind.to_le_bytes());
            output[at + 4..at + 8].copy_from_slice(&count.to_le_bytes());
            if let Some(data_at) = value_offsets[ifd_index][entry_index] {
                output[at + 8..at + 12].copy_from_slice(&(data_at as u32).to_le_bytes());
                output[data_at..data_at + bytes.len()].copy_from_slice(&bytes);
            } else {
                output[at + 8..at + 8 + bytes.len()].copy_from_slice(&bytes);
            }
        }
    }
    for (blob, offset) in blobs.iter().zip(blob_offsets) {
        output[offset..offset + blob.len()].copy_from_slice(blob);
    }
    output
}

pub fn dng(unsupported_xtrans: bool, orientation: u16, preview_jpeg: &[u8]) -> Vec<u8> {
    let width = 8usize;
    let height = 6usize;
    let sensor: Vec<u8> = (0..height).flat_map(|y| (0..width).flat_map(move |x| {
        let sample = (350 + x * 97 + y * 131 + ((x * y * 19) % 101)) as u16;
        sample.to_le_bytes()
    })).collect();
    let jpeg_blob = 0usize;
    let raw_blob = 1usize;
    let thumbnail_blob = 2usize;
    let pattern = if unsupported_xtrans {
        vec![1, 0, 1, 1, 2, 1, 2, 1, 2, 0, 1, 0, 1, 0, 1, 1, 2, 1, 2, 1, 2, 1, 0, 1, 1, 0, 1, 0, 1, 2, 1, 2, 1, 1, 0, 1]
    } else { vec![0, 1, 1, 2] };
    let cfa_dimensions = if unsupported_xtrans { vec![6, 6] } else { vec![2, 2] };
    let thumbnail = vec![
        (254, Value::Long(vec![1])), (256, Value::Long(vec![2])), (257, Value::Long(vec![2])),
        (258, Value::Short(vec![8, 8, 8])), (259, Value::Short(vec![1])), (262, Value::Short(vec![2])),
        (271, Value::Ascii("Orion Fixture".into())), (272, Value::Ascii("Synthetic Bayer".into())),
        (273, Value::BlobOffset(thumbnail_blob)), (274, Value::Short(vec![orientation])),
        (277, Value::Short(vec![3])), (278, Value::Long(vec![2])), (279, Value::BlobLength(12)),
        (513, Value::BlobOffset(jpeg_blob)), (514, Value::BlobLength(preview_jpeg.len() as u32)),
        (330, Value::IfdOffset(1)), (50706, Value::Byte(vec![1, 4, 0, 0])),
        (50707, Value::Byte(vec![1, 1, 0, 0])), (50708, Value::Ascii("Orion Synthetic Bayer".into())),
        (50721, Value::SRational(vec![(7000, 10000), (1000, 10000), (1000, 10000), (2000, 10000), (8000, 10000), (1000, 10000), (500, 10000), (1000, 10000), (9000, 10000)])),
        (50728, Value::Rational(vec![(1, 1), (1, 1), (1, 1)])), (50778, Value::Short(vec![21])),
    ];
    let raw = vec![
        (254, Value::Long(vec![0])), (256, Value::Long(vec![width as u32])), (257, Value::Long(vec![height as u32])),
        (258, Value::Short(vec![16])), (259, Value::Short(vec![1])), (262, Value::Short(vec![32803])),
        (273, Value::BlobOffset(raw_blob)), (277, Value::Short(vec![1])), (278, Value::Long(vec![height as u32])),
        (279, Value::BlobLength(sensor.len() as u32)), (284, Value::Short(vec![1])), (33421, Value::Short(cfa_dimensions)),
        (33422, Value::Byte(pattern)), (50710, Value::Byte(vec![0, 1, 2])), (50711, Value::Short(vec![1])),
        (50713, Value::Short(vec![1, 1])), (50714, Value::Rational(vec![(0, 1)])), (50717, Value::Long(vec![4095])),
    ];
    build(vec![thumbnail, raw], vec![preview_jpeg.to_vec(), sensor, vec![128; 12]])
}
